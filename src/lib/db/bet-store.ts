import "server-only";

/**
 * Bet log: the storage-agnostic entry point.
 *
 * TWO MODES, CHOSEN BY CONFIGURATION -- NOT A FALLBACK:
 *
 *   postgres  Supabase is configured. All reads and writes go to the
 *             `diamonds.bets` table, scoped to the signed-in user.
 *   file      No database configured. The local single-user JSON store.
 *
 * The distinction matters. If Postgres is configured and a query FAILS, this
 * module throws -- it does not quietly write to the file instead. A silent
 * downgrade would split the bet log across two stores, and the ledger's whole
 * value depends on there being exactly one record of what was actually staked.
 *
 * The mode is decided once from configuration, so it cannot flip mid-session.
 */

import { isDatabaseConfigured } from "../supabase/admin";
import type { Bet, BetStatus, NewBet } from "./bet-types";
import * as fileStore from "./bet-store-file";
import * as pg from "./bet-store-pg";

export type { Bet, BetStatus, NewBet } from "./bet-types";
export * from "./ledger-analytics";

export type StorageMode = "postgres" | "file";

export function storageMode(): StorageMode {
  return isDatabaseConfigured() ? "postgres" : "file";
}

/**
 * In postgres mode a user id is REQUIRED. Refusing to proceed without one is
 * what stops an unauthenticated code path from reading or writing rows that
 * belong to somebody else -- the secret key bypasses RLS, so nothing else
 * would stop it.
 */
function requireUser(userId: string | null): string {
  if (!userId) {
    throw new Error(
      "A signed-in user is required to reach the bet log in database mode.",
    );
  }
  return userId;
}

export async function listBets(userId: string | null): Promise<Bet[]> {
  return storageMode() === "postgres"
    ? pg.listBetsPg(requireUser(userId))
    : fileStore.listBets();
}

export async function addBet(userId: string | null, input: NewBet): Promise<Bet> {
  return storageMode() === "postgres"
    ? pg.addBetPg(requireUser(userId), input)
    : fileStore.addBet(input);
}

export async function settleBet(
  userId: string | null,
  id: string,
  status: Exclude<BetStatus, "open">,
): Promise<Bet> {
  return storageMode() === "postgres"
    ? pg.settleBetPg(requireUser(userId), id, status)
    : fileStore.settleBet(id, status);
}

export async function setClosingLine(
  userId: string | null,
  id: string,
  closingOdds: number,
  closingMarket?: number[],
): Promise<Bet> {
  return storageMode() === "postgres"
    ? pg.setClosingLinePg(requireUser(userId), id, closingOdds, closingMarket)
    : fileStore.updateBet(id, { closingOdds, closingMarket });
}

export async function deleteBet(userId: string | null, id: string): Promise<void> {
  return storageMode() === "postgres"
    ? pg.deleteBetPg(requireUser(userId), id)
    : fileStore.deleteBet(id);
}
