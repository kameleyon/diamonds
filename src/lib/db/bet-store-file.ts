import "server-only";

/**
 * File-backed bet log.
 *
 * The local single-user mode. One writer, small dataset, no provisioning --
 * this is what runs when no database is configured. Writes go through a temp
 * file and a rename so an interrupted write cannot truncate the log.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Bet, BetStatus, NewBet } from "./bet-types";

const DATA_DIR = path.join(process.cwd(), ".data");
const BETS_FILE = path.join(DATA_DIR, "bets.json");

async function readAll(): Promise<Bet[]> {
  try {
    const raw = await fs.readFile(BETS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Bet[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    // A corrupt log must be loud. Silently starting from an empty ledger would
    // erase a betting history, which is the one thing here that cannot be
    // regenerated from an API.
    throw new Error(
      `Could not read the bet log at ${BETS_FILE}: ${(err as Error).message}. ` +
        `The file is present but unreadable -- move it aside rather than letting it be overwritten.`,
    );
  }
}

async function writeAll(bets: Bet[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${BETS_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(bets, null, 2), "utf8");
  try {
    await fs.rename(tmp, BETS_FILE);
  } catch {
    // Windows can refuse a rename over an open file; fall back to a direct
    // write and clean up rather than losing the bet the user just logged.
    await fs.writeFile(BETS_FILE, JSON.stringify(bets, null, 2), "utf8");
    await fs.rm(tmp, { force: true });
  }
}

export async function listBets(): Promise<Bet[]> {
  const bets = await readAll();
  return bets.sort((a, b) => b.placedAt.localeCompare(a.placedAt));
}


export async function addBet(input: NewBet): Promise<Bet> {
  if (!(input.odds > 1)) throw new Error(`Invalid odds: ${input.odds}`);
  if (!(input.stake > 0)) throw new Error(`Stake must be positive, got ${input.stake}`);

  const bet: Bet = {
    ...input,
    id: randomUUID(),
    placedAt: new Date().toISOString(),
    status: "open",
  };
  const bets = await readAll();
  bets.push(bet);
  await writeAll(bets);
  return bet;
}

export async function updateBet(id: string, patch: Partial<Bet>): Promise<Bet> {
  const bets = await readAll();
  const i = bets.findIndex((b) => b.id === id);
  if (i === -1) throw new Error(`No bet with id ${id}`);
  bets[i] = { ...bets[i], ...patch, id: bets[i].id };
  await writeAll(bets);
  return bets[i];
}

export async function deleteBet(id: string): Promise<void> {
  const bets = await readAll();
  await writeAll(bets.filter((b) => b.id !== id));
}

/**
 * Settle a bet.
 *
 * Returns are derived from the status rather than entered by hand, so a
 * mistyped payout cannot quietly corrupt the P&L record.
 */
export async function settleBet(
  id: string,
  status: Exclude<BetStatus, "open">,
): Promise<Bet> {
  const bets = await readAll();
  const bet = bets.find((b) => b.id === id);
  if (!bet) throw new Error(`No bet with id ${id}`);

  const returned =
    status === "won"
      ? bet.stake * bet.odds
      : status === "push" || status === "void"
        ? bet.stake
        : 0;

  return updateBet(id, { status, returned, settledAt: new Date().toISOString() });
}
