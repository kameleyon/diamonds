/**
 * The Odds API (v4) client.
 *
 * Quota is the binding constraint, not latency. The API bills
 * `markets x regions` credits per request, so pulling h2h+spreads+totals across
 * two regions costs 6 credits per call, not 1. The free tier is 500/month. Five
 * sports polled carelessly will exhaust a month's quota in an afternoon.
 *
 * So this client:
 *   - tracks remaining quota from response headers on every call
 *   - caches responses in memory with a TTL tuned to how fast lines actually move
 *   - refuses to fire once quota is exhausted rather than failing per-request
 *   - reports the credit cost of a call before making it
 */

import { requireEnv } from "../env";

const BASE = "https://api.the-odds-api.com/v4";

export type Region = "us" | "us2" | "uk" | "eu" | "au";

export interface OddsApiOutcome {
  name: string;
  price: number;
  /** Handicap or total line, present on spreads/totals/props. */
  point?: number;
  /** Player name on player prop markets. */
  description?: string;
}

export interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string | null;
  away_team: string | null;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsApiSport {
  key: string;
  group: string;
  title: string;
  description: string;
  active: boolean;
  has_outrights: boolean;
}

export interface OddsApiScore {
  id: string;
  sport_key: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
  last_update: string | null;
}

export interface Quota {
  remaining: number | null;
  used: number | null;
  /** Credits consumed by the most recent call. */
  lastCost: number | null;
  checkedAt: Date | null;
}

export class OddsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "OddsApiError";
  }
}

export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * Cache lifetimes, chosen from how fast each resource actually changes.
 * Getting these wrong is what burns quota: the sport catalogue changes weekly,
 * but re-fetching it on every page load would cost hundreds of credits a month.
 */
const TTL = {
  sports: 6 * 60 * 60 * 1000, // catalogue changes at most weekly
  odds: 60 * 1000, // lines move on a minute scale near kickoff
  scores: 5 * 60 * 1000,
  events: 10 * 60 * 1000,
} as const;

class OddsApiClient {
  private cache = new Map<string, CacheEntry>();
  private quota: Quota = { remaining: null, used: null, lastCost: null, checkedAt: null };

  getQuota(): Quota {
    return { ...this.quota };
  }

  /** Credits a call will cost, so callers can decide before spending. */
  estimateCost(markets: string[], regions: Region[]): number {
    return Math.max(1, markets.length * regions.length);
  }

  private cached<T>(key: string): T | undefined {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    if (hit) this.cache.delete(key);
    return undefined;
  }

  private store(key: string, value: unknown, ttl: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttl });
  }

  private async request<T>(path: string, params: Record<string, string>, ttl: number): Promise<T> {
    const apiKey = requireEnv("ODDS_API_KEY");
    const qs = new URLSearchParams({ ...params, apiKey });
    const cacheKey = `${path}?${new URLSearchParams(params).toString()}`;

    const hit = this.cached<T>(cacheKey);
    if (hit !== undefined) return hit;

    // Refuse rather than spend the last credits on a call we know will fail.
    if (this.quota.remaining !== null && this.quota.remaining <= 0) {
      throw new QuotaExhaustedError(
        `The Odds API quota is exhausted (${this.quota.used ?? "?"} used). ` +
          `It resets monthly; upgrade the plan or wait for the reset.`,
      );
    }

    const res = await fetch(`${BASE}${path}?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      // We do our own caching with quota-aware TTLs; Next's fetch cache would
      // hide the quota headers we depend on.
      cache: "no-store",
    });

    const remaining = res.headers.get("x-requests-remaining");
    const used = res.headers.get("x-requests-used");
    const cost = res.headers.get("x-requests-last");
    this.quota = {
      remaining: remaining !== null ? Number(remaining) : this.quota.remaining,
      used: used !== null ? Number(used) : this.quota.used,
      lastCost: cost !== null ? Number(cost) : null,
      checkedAt: new Date(),
    };

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 401) {
        throw new OddsApiError("The Odds API rejected the key (401). Check ODDS_API_KEY.", 401, body);
      }
      if (res.status === 429) {
        throw new QuotaExhaustedError("The Odds API returned 429: quota or rate limit exceeded.");
      }
      throw new OddsApiError(`The Odds API returned ${res.status}: ${body.slice(0, 300)}`, res.status, body);
    }

    const json = (await res.json()) as T;
    this.store(cacheKey, json, ttl);
    return json;
  }

  /** Full catalogue of sports/competitions currently offered. */
  async listSports(includeInactive = false): Promise<OddsApiSport[]> {
    const all = await this.request<OddsApiSport[]>("/sports/", {}, TTL.sports);
    return includeInactive ? all : all.filter((s) => s.active);
  }

  /**
   * Odds for every upcoming event in one competition.
   *
   * Keep `markets` and `regions` as tight as the question allows -- this is
   * where quota is spent.
   */
  async getOdds(params: {
    sportKey: string;
    regions?: Region[];
    markets?: string[];
    oddsFormat?: "decimal" | "american";
    bookmakers?: string[];
  }): Promise<OddsApiEvent[]> {
    const {
      sportKey,
      regions = ["us"],
      markets = ["h2h"],
      oddsFormat = "decimal",
      bookmakers,
    } = params;

    const query: Record<string, string> = {
      regions: regions.join(","),
      markets: markets.join(","),
      oddsFormat,
      dateFormat: "iso",
    };
    if (bookmakers?.length) query.bookmakers = bookmakers.join(",");

    return this.request<OddsApiEvent[]>(`/sports/${sportKey}/odds/`, query, TTL.odds);
  }

  /**
   * Player props, which are only available per-event and cost credits per event.
   * Pull these selectively -- never in a loop across a full slate.
   */
  async getEventOdds(params: {
    sportKey: string;
    eventId: string;
    markets: string[];
    regions?: Region[];
    oddsFormat?: "decimal" | "american";
  }): Promise<OddsApiEvent> {
    const { sportKey, eventId, markets, regions = ["us"], oddsFormat = "decimal" } = params;
    return this.request<OddsApiEvent>(
      `/sports/${sportKey}/events/${eventId}/odds/`,
      {
        regions: regions.join(","),
        markets: markets.join(","),
        oddsFormat,
        dateFormat: "iso",
      },
      TTL.odds,
    );
  }

  /** Recent and live scores, used to settle bets and update ratings. */
  async getScores(sportKey: string, daysFrom = 3): Promise<OddsApiScore[]> {
    return this.request<OddsApiScore[]>(
      `/sports/${sportKey}/scores/`,
      { daysFrom: String(daysFrom), dateFormat: "iso" },
      TTL.scores,
    );
  }

  /** Event list without odds. Free of market/region multipliers, so cheap. */
  async getEvents(sportKey: string): Promise<OddsApiEvent[]> {
    return this.request<OddsApiEvent[]>(`/sports/${sportKey}/events/`, { dateFormat: "iso" }, TTL.events);
  }

  /** Drop cached responses. Used by the manual refresh control in the UI. */
  clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Module-level singleton so the cache and quota counter are shared across all
 * server-side callers within a process.
 */
export const oddsApi = new OddsApiClient();
