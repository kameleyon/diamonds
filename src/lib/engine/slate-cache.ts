import "server-only";

/**
 * Shared slate cache.
 *
 * The odds client already caches in memory, and in production that cache is
 * close to useless: every Vercel request can land on a different serverless
 * instance with a cold, empty map, so each page view re-bought the entire
 * slate. At ~40 credits per scan against a 500/month free tier that consumed
 * the month in about a day.
 *
 * Postgres is shared across instances, so the second viewer inside the window
 * costs nothing. The in-memory cache stays as a first-level hit for repeat
 * calls within one request.
 *
 * The TTL is a deliberate trade. Lines do move on a minute scale near kickoff,
 * so a cached board can be slightly stale — but a board that stopped working on
 * the 6th of the month because it spent the quota is worse than one whose
 * prices are a few minutes old, and every row already carries a "verify it is
 * still takeable" caveat.
 */

import { adminDb, isDatabaseConfigured } from "../supabase/admin";
import type { OddsApiEvent, Region } from "../providers/oddsapi";

/** Ten minutes: ~95% of credits saved, and staleness stays inside the noise. */
export const DEFAULT_TTL_SECONDS = 600;

export interface CachedSlate {
  events: OddsApiEvent[];
  fetchedAt: string;
  creditsSpent: number;
  ageSeconds: number;
}

/**
 * Cache identity must include everything that changes the response, or two
 * different requests will silently share one entry.
 */
export function cacheKey(sports: string[], regions: Region[], markets: string[]): string {
  return [
    [...sports].sort().join(","),
    [...regions].sort().join(","),
    [...markets].sort().join(","),
  ].join("|");
}

/**
 * Read the cache regardless of age.
 *
 * Used when a live fetch has already failed — an exhausted quota, a provider
 * outage. Prices an hour old are worse than fresh ones, and far better than an
 * empty screen that gives no reason. The caller MUST label the age; this is a
 * stated emergency fallback, never a silent substitution.
 */
export async function readStaleSlate(key: string): Promise<CachedSlate | null> {
  return readCachedSlate(key, Number.POSITIVE_INFINITY);
}

export async function readCachedSlate(
  key: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<CachedSlate | null> {
  if (!isDatabaseConfigured()) return null;

  const { data, error } = await adminDb()
    .from("diamonds_odds_cache")
    .select("payload, fetched_at, credits_spent")
    .eq("cache_key", key)
    .maybeSingle();

  // A cache miss and a cache failure are both "go fetch": the cache is an
  // optimisation, never a source of truth, so a broken cache must not break
  // the board.
  if (error || !data) return null;

  const fetchedAt = new Date(data.fetched_at as string);
  const ageSeconds = (Date.now() - fetchedAt.getTime()) / 1000;
  if (ageSeconds > ttlSeconds) return null;

  return {
    events: data.payload as unknown as OddsApiEvent[],
    fetchedAt: fetchedAt.toISOString(),
    creditsSpent: Number(data.credits_spent ?? 0),
    ageSeconds,
  };
}

export async function writeCachedSlate(
  key: string,
  events: OddsApiEvent[],
  creditsSpent: number,
): Promise<void> {
  if (!isDatabaseConfigured()) return;

  // Never let a cache write failure surface as a board failure: the data was
  // already fetched and is already being served.
  try {
    await adminDb()
      .from("diamonds_odds_cache")
      .upsert(
        {
          cache_key: key,
          payload: events as unknown as Record<string, unknown>,
          fetched_at: new Date().toISOString(),
          credits_spent: creditsSpent,
        },
        { onConflict: "cache_key" },
      );
  } catch {
    // Intentionally silent — see above.
  }
}
