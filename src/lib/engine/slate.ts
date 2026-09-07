/**
 * Slate assembly.
 *
 * Resolves which competitions are live right now, pulls their odds within a
 * quota budget, and runs the edge engine over everything it gets back.
 *
 * The quota budget is the important part. The Odds API charges
 * `markets x regions` per competition, so a careless "fetch all five sports,
 * all markets, all regions" costs 30+ credits per refresh and would drain a
 * 500-credit month in about a day of casual use. This module spends
 * deliberately and reports exactly what it spent.
 */

import { oddsApi, QuotaExhaustedError, type OddsApiEvent, type Region } from "../providers/oddsapi";
import { EnvMissingError } from "../env";
import { SPORTS, type SportId } from "../sports/registry";
import { scanEvents, DEFAULT_ENGINE_CONFIG, type EngineConfig, type Opportunity } from "./edge";
import { cacheKey, readCachedSlate, writeCachedSlate, DEFAULT_TTL_SECONDS } from "./slate-cache";

export interface SlateRequest {
  sports: SportId[];
  regions?: Region[];
  markets?: string[];
  /** Hard ceiling on credits this refresh may spend. */
  creditBudget?: number;
  config?: EngineConfig;
  /** Seconds a cached slate stays usable. 0 forces a fresh fetch. */
  ttlSeconds?: number;
}

export interface SlateCompetition {
  key: string;
  title: string;
  sportId: SportId;
  eventCount: number;
}

export interface SlateResult {
  opportunities: Opportunity[];
  events: OddsApiEvent[];
  competitions: SlateCompetition[];
  creditsSpent: number;
  quota: ReturnType<typeof oddsApi.getQuota>;
  /** Non-fatal problems worth showing rather than swallowing. */
  errors: { scope: string; message: string }[];
  /** True when no API key is configured, so the UI can route to setup. */
  needsSetup: boolean;
  /** Seconds since these prices were fetched. 0 means this request bought them. */
  ageSeconds: number;
  /** True when the slate came from the shared cache and cost nothing. */
  fromCache: boolean;
}

/**
 * Build the slate.
 *
 * Never throws for expected conditions (missing key, exhausted quota, one sport
 * failing). Those are states the UI needs to render, not crashes -- a terminal
 * that goes blank because one league 404'd is useless.
 */
export async function buildSlate(request: SlateRequest): Promise<SlateResult> {
  const {
    sports,
    regions = ["us", "eu"],
    markets = ["h2h", "totals"],
    creditBudget = 40,
    config = DEFAULT_ENGINE_CONFIG,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  } = request;

  /*
   * Serve from the shared cache before spending anything.
   *
   * This check is what keeps the board usable on a 500/month quota: without it
   * every page view re-bought the slate, because the client's in-memory cache
   * does not survive between serverless invocations.
   */
  const key = cacheKey(sports, regions, markets);
  if (ttlSeconds > 0) {
    const cached = await readCachedSlate(key, ttlSeconds);
    if (cached) {
      return {
        opportunities: scanEvents(cached.events, config),
        events: cached.events,
        competitions: [],
        creditsSpent: 0,
        quota: oddsApi.getQuota(),
        errors: [],
        needsSetup: false,
        ageSeconds: Math.round(cached.ageSeconds),
        fromCache: true,
      };
    }
  }

  const errors: SlateResult["errors"] = [];
  const events: OddsApiEvent[] = [];
  const competitions: SlateCompetition[] = [];
  let creditsSpent = 0;

  let catalogue;
  try {
    catalogue = await oddsApi.listSports();
  } catch (err) {
    if (err instanceof EnvMissingError) {
      return {
        opportunities: [],
        events: [],
        competitions: [],
        creditsSpent: 0,
        quota: oddsApi.getQuota(),
        errors: [{ scope: "setup", message: err.message }],
        needsSetup: true,
        ageSeconds: 0,
        fromCache: false,
      };
    }
    return {
      opportunities: [],
      events: [],
      competitions: [],
      creditsSpent: 0,
      quota: oddsApi.getQuota(),
      errors: [{ scope: "catalogue", message: (err as Error).message }],
      needsSetup: false,
      ageSeconds: 0,
      fromCache: false,
    };
  }

  const perCall = Math.max(1, markets.length * regions.length);

  for (const sportId of sports) {
    const spec = SPORTS[sportId];
    // Competitions are resolved at runtime, never hardcoded: tennis keys are
    // tournament-scoped and disappear off-season, and soccer leagues rotate.
    const live = catalogue.filter(
      (s) => spec.keyPrefixes.some((p) => s.key.startsWith(p)) && !s.has_outrights,
    );

    if (live.length === 0) {
      errors.push({
        scope: spec.label,
        message: `No ${spec.label} competitions are in season right now.`,
      });
      continue;
    }

    for (const comp of live) {
      if (creditsSpent + perCall > creditBudget) {
        errors.push({
          scope: spec.label,
          message: `Credit budget reached (${creditBudget}); skipped ${comp.title} and anything after it.`,
        });
        break;
      }

      try {
        const fetched = await oddsApi.getOdds({
          sportKey: comp.key,
          regions,
          markets,
        });
        creditsSpent += perCall;
        if (fetched.length > 0) {
          events.push(...fetched);
          competitions.push({
            key: comp.key,
            title: comp.title,
            sportId,
            eventCount: fetched.length,
          });
        }
      } catch (err) {
        if (err instanceof QuotaExhaustedError) {
          errors.push({ scope: "quota", message: err.message });
          // Nothing further will succeed this refresh.
          return await finish();
        }
        errors.push({ scope: comp.title, message: (err as Error).message });
      }
    }
  }

  return await finish();

  async function finish(): Promise<SlateResult> {
    // Store what was bought so the next viewer inside the window pays nothing.
    if (events.length > 0 && ttlSeconds > 0) {
      await writeCachedSlate(key, events, creditsSpent);
    }
    return {
      opportunities: scanEvents(events, config),
      events,
      competitions,
      creditsSpent,
      quota: oddsApi.getQuota(),
      errors,
      needsSetup: false,
      ageSeconds: 0,
      fromCache: false,
    };
  }
}
