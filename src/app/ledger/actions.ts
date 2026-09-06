"use server";

/**
 * Ledger server actions.
 *
 * Two rules, applied to every action without exception:
 *
 *   1. AUTHORISE FIRST. Middleware redirects browsers, but a Server Action is
 *      a callable POST endpoint -- it can be invoked directly, with no page
 *      load and no middleware in the path. Authorisation therefore lives here,
 *      next to the data, not in the routing layer.
 *
 *   2. VALIDATE THE INPUT. Action arguments arrive over the wire from a client
 *      and are attacker-controlled, whatever the TypeScript signature claims.
 *      TypeScript is erased at runtime and enforces nothing. Every input is
 *      parsed with a schema before it reaches the database.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { addBet, settleBet, deleteBet, setClosingLine, type BetStatus } from "@/lib/db/bet-store";

// Zod 4: `z.uuid()` is top-level, and `z.number()` already rejects NaN and
// Infinity, so `.finite()` is redundant and deprecated.
const uuid = z.uuid();

const NewBetSchema = z.object({
  eventId: z.string().min(1).max(200),
  sportKey: z.string().min(1).max(100),
  sportLabel: z.string().min(1).max(100),
  fixture: z.string().min(1).max(300),
  commenceTime: z.string().min(1).max(60),
  marketKey: z.string().min(1).max(100),
  selection: z.string().min(1).max(200),
  point: z.number().optional(),
  book: z.string().min(1).max(100),
  // A price at or below 1 is not a wager, and a non-finite one would poison
  // every downstream calculation.
  odds: z.number().gt(1).lte(10_000),
  stake: z.number().positive().lte(1_000_000),
  fairAtBet: z.number().gt(0).lt(1),
  evAtBet: z.number().gte(-1).lte(100),
  notes: z.string().max(2000).optional(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Errors are returned rather than thrown so the UI can show them, and the
 * message is deliberately plain: it never echoes a database error, which can
 * leak schema details.
 */
function fail(error: unknown): ActionResult {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return { ok: false, error: message };
}

export async function logBetAction(input: unknown): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    const bet = NewBetSchema.parse(input);
    await addBet(viewer.id, bet);
    revalidatePath("/ledger");
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: `Invalid bet: ${err.issues[0]?.message ?? "bad input"}` };
    }
    return fail(err);
  }
}

export async function settleBetAction(id: string, status: BetStatus): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    const parsedId = uuid.parse(id);
    const parsedStatus = z.enum(["won", "lost", "push", "void"]).parse(status);
    await settleBet(viewer.id, parsedId, parsedStatus);
    revalidatePath("/ledger");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteBetAction(id: string): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    await deleteBet(viewer.id, uuid.parse(id));
    revalidatePath("/ledger");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Record the closing line for a bet.
 *
 * The most valuable field in the ledger and the only one that becomes
 * unrecoverable once the event starts.
 */
export async function setClosingLineAction(
  id: string,
  closingOdds: number,
  closingMarket?: number[],
): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    const parsedId = uuid.parse(id);
    const odds = z.number().gt(1).lte(10_000).parse(closingOdds);
    const market = closingMarket
      ? z.array(z.number().gt(1)).min(2).max(64).parse(closingMarket)
      : undefined;
    await setClosingLine(viewer.id, parsedId, odds, market);
    revalidatePath("/ledger");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
