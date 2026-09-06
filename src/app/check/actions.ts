"use server";

import { requireViewer } from "@/lib/auth";
import { parseBetSlip } from "@/lib/parse/bet-slip";
import { buildSlate } from "@/lib/engine/slate";
import { DEFAULT_ENGINE_CONFIG, scanEvents } from "@/lib/engine/edge";
import { DEMO_EVENTS } from "@/lib/fixtures/demo-slate";
import {
  findMatch,
  checkAgainstMarket,
  checkSettled,
  noMatch,
  nameMatches,
  type BetCheck,
} from "@/lib/engine/check-bet";
import { adminDb, isDatabaseConfigured } from "@/lib/supabase/admin";

/**
 * Price a pasted bet.
 *
 * Authorises first: this is a callable POST endpoint that middleware never
 * sees, and it spends Odds API credits, so an unauthenticated caller could
 * drain the month's quota.
 */
export async function checkBetAction(
  text: string,
  demo = false,
): Promise<{ ok: true; check: BetCheck } | { ok: false; error: string }> {
  try {
    await requireViewer();

    if (typeof text !== "string" || text.trim().length === 0) {
      return { ok: false, error: "Type or paste a bet first." };
    }
    if (text.length > 400) {
      return { ok: false, error: "That is too long to be a bet slip." };
    }

    const parsed = parseBetSlip(text);

    const opportunities = demo
      ? scanEvents(DEMO_EVENTS, { ...DEFAULT_ENGINE_CONFIG, minEv: -1 })
      : (
          await buildSlate({
            sports: ["nfl", "mlb", "soccer", "cfb"],
            // minEv of -1 so a bet can be priced even when it is a BAD one --
            // "should I take this?" must be answerable with "no".
            config: { ...DEFAULT_ENGINE_CONFIG, minEv: -1 },
          })
        ).opportunities;

    const match = findMatch(parsed, opportunities);
    if (match) return { ok: true, check: checkAgainstMarket(parsed, match) };

    // Nothing live matched: it may have already played.
    const settled = await findSettled(parsed.subject);
    if (settled) return { ok: true, check: checkSettled(parsed, settled) };

    return { ok: true, check: noMatch(parsed, opportunities.length) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Look for a completed fixture involving this team in the stored results. */
async function findSettled(subject?: string) {
  if (!subject || !isDatabaseConfigured()) return null;

  const { data, error } = await adminDb()
    .from("results")
    .select("home_team, away_team, home_score, away_score, completed_at")
    .order("completed_at", { ascending: false })
    .limit(4000);

  if (error || !data) return null;

  const hit = data.find(
    (r) => nameMatches(subject, r.home_team) || nameMatches(subject, r.away_team),
  );
  if (!hit) return null;

  return {
    homeTeam: hit.home_team as string,
    awayTeam: hit.away_team as string,
    homeScore: Number(hit.home_score),
    awayScore: Number(hit.away_score),
  };
}
