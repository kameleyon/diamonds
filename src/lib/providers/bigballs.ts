/**
 * Big Balls Sports Data client (https://api.bigballsdata.com).
 *
 * This is the RESULTS source. It is what makes the rating models fittable at
 * all -- The Odds API's scores endpoint reaches back only a few days, which is
 * nowhere near enough history to fit anything.
 *
 * It is deliberately NOT the odds source on the current plan: bookmaker odds,
 * historical snapshots and closing lines all sit behind the Edge plan and
 * return 403. Odds continue to come from The Odds API.
 *
 * Two API quirks are handled here because both are silent traps:
 *
 *   1. RESPONSE SHAPE VARIES BY QUERY. `?sport=football&league=epl` returns a
 *      *scores projection* -- `{data:{scores:{value:[{match_id, home, away}]}}}`
 *      with no team names -- while `?sport=american_football&league=nfl`
 *      returns full match objects. Code that assumed `data` was always an array
 *      would silently see zero results for soccer rather than fail.
 *
 *   2. PLAN LIMITS COME BACK AS 403 WITH A MACHINE-READABLE CODE. A request for
 *      two seasons back returns `history_not_included`, not an empty list.
 *      Treating that as "no data" would quietly train the models on nothing.
 */

import { readEnv } from "../env";

const BASE = "https://api.bigballsdata.com";

/** The API's own sport vocabulary. Not the same as our internal SportId. */
export type BigBallsSport =
  | "football"
  | "american_football"
  | "baseball"
  | "basketball"
  | "ice_hockey"
  | "cricket"
  | "mma"
  | "boxing"
  | "formula1";

export interface BigBallsTeam {
  id: string;
  name: string;
  short_name?: string | null;
  logo_url?: string | null;
}

export interface BigBallsMatch {
  id: string;
  sport: string;
  league: string;
  home: BigBallsTeam;
  away: BigBallsTeam;
  kickoff_utc: string;
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled";
  score: { home: number | null; away: number | null } | null;
  has_odds?: boolean;
  season?: string | null;
}

export class BigBallsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Machine-readable code, e.g. "forbidden", "history_not_included". */
    public readonly code: string | null,
    public readonly suggestedFix: string | null,
  ) {
    super(message);
    this.name = "BigBallsError";
  }
}

/** True when the failure is a plan restriction rather than a bad request. */
export function isPlanLimit(err: unknown): err is BigBallsError {
  return (
    err instanceof BigBallsError &&
    err.status === 403 &&
    (err.code === "forbidden" || err.code === "history_not_included")
  );
}

export interface RateState {
  usedThisRun: number;
  /** Free plan: 100/minute, 1000/day. */
  perMinute: number;
  perDay: number;
}

/**
 * Minimal request pacing.
 *
 * The free plan allows 100 requests/minute. Backfills are the only thing here
 * that runs in a loop, so a fixed gap between calls is enough -- it keeps a
 * long backfill comfortably under the ceiling without needing a token bucket.
 */
class Pacer {
  private last = 0;
  constructor(private readonly minGapMs: number) {}
  async wait(): Promise<void> {
    const since = Date.now() - this.last;
    if (since < this.minGapMs) {
      await new Promise((r) => setTimeout(r, this.minGapMs - since));
    }
    this.last = Date.now();
  }
}

export class BigBallsClient {
  private pacer = new Pacer(700); // ~85/min, under the 100/min ceiling
  public used = 0;

  constructor(private readonly apiKey: string) {}

  static fromEnv(): BigBallsClient | null {
    const key = readEnv("BIGBALLS_API_KEY");
    return key ? new BigBallsClient(key) : null;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    await this.pacer.wait();
    const qs = new URLSearchParams(params);
    const res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
      cache: "no-store",
    });
    this.used++;

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      const fix = (body as { suggested_fix?: string } | null)?.suggested_fix ?? null;
      throw new BigBallsError(
        err?.message ?? `Big Balls API returned ${res.status}`,
        res.status,
        err?.code ?? null,
        fix,
      );
    }

    return (body as { data: T }).data;
  }

  /**
   * List matches.
   *
   * Normalises the two response shapes. When the API returns the scores
   * projection (soccer with an explicit league), this returns an empty array
   * and sets `projection: true` -- the projection carries no team names and is
   * useless for fitting ratings.
   *
   * WARNING: `page` is accepted but IGNORED by the API -- page 1, 2 and 3 of
   * the same query return byte-identical data. Any loop that pages until a
   * short result set will spin until it exhausts its budget. Walk `date`
   * instead; that is the only pagination that actually works here.
   */
  async listMatches(params: {
    /**
     * Omit for a full cross-sport list. Supplying it can switch the response to
     * the scores projection (baseball always does), so the backfill leaves it
     * unset on purpose.
     */
    sport?: BigBallsSport;
    league?: string;
    date?: string;
    season?: string;
    status?: BigBallsMatch["status"];
    page?: number;
    limit?: number;
  }): Promise<{ matches: BigBallsMatch[]; projection: boolean }> {
    const query: Record<string, string> = {};
    if (params.sport) query.sport = params.sport;
    if (params.league) query.league = params.league;
    if (params.date) query.date = params.date;
    if (params.season) query.season = params.season;
    if (params.status) query.status = params.status;
    query.page = String(params.page ?? 1);
    query.limit = String(params.limit ?? 100);

    const data = await this.request<unknown>("/v1/matches", query);

    if (Array.isArray(data)) {
      return { matches: data as BigBallsMatch[], projection: false };
    }
    // The scores projection: `{scores:{value:[...]}}`. No team names, so it
    // cannot be used to fit ratings. Report it rather than returning junk.
    return { matches: [], projection: true };
  }

  /** Current Elo rating and league rank, computed by the provider. */
  async teamElo(teamId: string, sport: BigBallsSport): Promise<unknown> {
    return this.request(`/v1/teams/${teamId}/elo`, { sport });
  }

  /** Weekly NFL injury and practice report. Free plan. */
  async nflInjuries(season?: number, week?: number): Promise<unknown> {
    const q: Record<string, string> = {};
    if (season) q.season = String(season);
    if (week) q.week = String(week);
    return this.request("/v1/nfl/injuries", q);
  }

  /** Plan and rate-limit state for the current key. */
  async me(): Promise<{
    plan: string;
    email: string;
    limits: { per_minute: number; per_day: number };
  }> {
    return this.request("/v1/user/me", {});
  }
}

/**
 * Our SportId -> how to query this provider for it.
 *
 * Two things here are load-bearing and were only discoverable by probing:
 *
 *  - `season` is REQUIRED to reach finished matches. Without it the list
 *    returns upcoming fixtures ascending from today, so a backfill silently
 *    collects zero results.
 *  - For soccer, passing `league` degrades the response to a scores projection
 *    with no team names. Soccer must be queried by sport+season and filtered
 *    client-side on the league DISPLAY NAME ("EPL", "La Liga") -- not the slug.
 */
export interface BigBallsSportMap {
  sport: BigBallsSport;
  /** League slug for the `league` query param. Empty when it must be omitted. */
  leagueParams: string[];
  /** League display names as they appear in `match.league`, for client filtering. */
  leagueNames: string[];
  /** True when `league=` returns full match objects rather than a projection. */
  leagueQueryWorks: boolean;
}

export const BIGBALLS_MAP: Record<string, BigBallsSportMap> = {
  soccer: {
    sport: "football",
    leagueParams: [],
    leagueNames: ["EPL", "La Liga", "Serie A", "Bundesliga", "Ligue 1", "UEFA Champions League"],
    leagueQueryWorks: false,
  },
  nfl: {
    sport: "american_football",
    leagueParams: ["nfl"],
    leagueNames: ["NFL"],
    leagueQueryWorks: true,
  },
  cfb: {
    sport: "american_football",
    leagueParams: ["ncaaf"],
    leagueNames: ["NCAAF"],
    leagueQueryWorks: true,
  },
  mlb: {
    sport: "baseball",
    leagueParams: ["mlb"],
    leagueNames: ["MLB"],
    leagueQueryWorks: true,
  },
  tennis: {
    sport: "football",
    leagueParams: [],
    leagueNames: [],
    leagueQueryWorks: false,
  },
};

/**
 * Seasons to pull, newest first.
 *
 * The free plan covers the current season plus one prior; asking for anything
 * older returns 403 `history_not_included`. Seasons are plain years even for
 * European leagues -- `season=2025-26` is rejected as a bad request.
 */
export function seasonsToPull(now = new Date()): number[] {
  const y = now.getUTCFullYear();
  return [y, y - 1];
}

export const TENNIS_UNSUPPORTED =
  "Big Balls Sports Data does not cover tennis. Its catalogue is soccer, basketball, " +
  "American football, baseball, ice hockey, cricket, MMA, boxing and Formula 1. " +
  "Tennis ratings need a different results source.";
