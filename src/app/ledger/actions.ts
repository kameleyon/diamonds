"use server";

import { revalidatePath } from "next/cache";
import { addBet, settleBet, deleteBet, updateBet, type BetStatus, type NewBet } from "@/lib/db/bet-store";

export async function logBetAction(bet: NewBet): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await addBet(bet);
    revalidatePath("/ledger");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function settleBetAction(id: string, status: Exclude<BetStatus, "open">) {
  await settleBet(id, status);
  revalidatePath("/ledger");
}

export async function deleteBetAction(id: string) {
  await deleteBet(id);
  revalidatePath("/ledger");
}

/**
 * Record the closing line for a bet.
 *
 * This is the single most valuable piece of data in the ledger, and it has to
 * be captured before the event starts or it is gone -- books take the market
 * down at kickoff. Everything CLV reports depends on this being filled in.
 */
export async function setClosingLineAction(id: string, closingOdds: number, closingMarket?: number[]) {
  await updateBet(id, { closingOdds, closingMarket });
  revalidatePath("/ledger");
}
