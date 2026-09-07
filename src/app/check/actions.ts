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
import { readSlipImage, MAX_IMAGE_BYTES, ACCEPTED_TYPES } from "@/lib/providers/slip-vision";

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
    .from("diamonds_results")
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


/**
 * Price a bet from a screenshot.
 *
 * The image is transcribed to shorthand and then handed to `checkBetAction`,
 * so an image and a typed slip saying the same thing take the identical code
 * path and cannot produce different verdicts.
 */
export async function checkSlipImageAction(
  formData: FormData,
  demo = false,
): Promise<
  | { ok: true; check: BetCheck; transcribed: string }
  | { ok: false; error: string }
> {
  try {
    await requireViewer();

    const file = formData.get("slip");
    if (!(file instanceof File)) return { ok: false, error: "No image received." };

    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: "That image is over 5MB. A screenshot should be far smaller." };
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return { ok: false, error: `Unsupported image type (${file.type || "unknown"}).` };
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const transcribed = await readSlipImage(base64, file.type);

    if (!transcribed) {
      return {
        ok: false,
        error: "Could not read a bet in that image. Try typing it instead.",
      };
    }

    const result = await checkBetAction(transcribed, demo);
    if (!result.ok) return result;

    return { ok: true, check: result.check, transcribed };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
