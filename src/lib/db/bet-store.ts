/**
 * Bet log.
 *
 * File-backed JSON at `.data/bets.json`. That is a deliberate primary choice
 * for a single-user local terminal, not a stand-in for a "real" database: there
 * is exactly one writer, the dataset is small, and it means the ledger works
 * the moment the app starts with no provisioning at all. Writes go through a
 * temp file and a rename so an interrupted write cannot truncate the log.
 *
 * If this ever becomes multi-user, swap this module for Postgres -- everything
 * above it depends only on the exported functions, not the storage.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { closingLineValue, summarizeClv, type ClvResult } from "../odds/clv";
import type { DevigMethod } from "../odds/devig";

const DATA_DIR = path.join(process.cwd(), ".data");
const BETS_FILE = path.join(DATA_DIR, "bets.json");

export type BetStatus = "open" | "won" | "lost" | "push" | "void";

export interface Bet {
  id: string;
  placedAt: string;

  eventId: string;
  sportKey: string;
  sportLabel: string;
  fixture: string;
  commenceTime: string;

  marketKey: string;
  selection: string;
  point?: number;

  book: string;
  /** Decimal price actually taken. */
  odds: number;
  stake: number;

  /** What the sharp market said was fair when the bet went on. */
  fairAtBet: number;
  evAtBet: number;

  status: BetStatus;
  settledAt?: string;
  /** Total returned including stake. 0 for a loss, stake for a push. */
  returned?: number;

  /** Closing price for the same selection at the same book. */
  closingOdds?: number;
  /** Full closing market, so the close can be devigged properly. */
  closingMarket?: number[];
  closingOutcomeIndex?: number;

  notes?: string;
}

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

export type NewBet = Omit<Bet, "id" | "placedAt" | "status">;

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

export interface LedgerSummary {
  totalBets: number;
  openBets: number;
  settledBets: number;

  staked: number;
  returned: number;
  profit: number;
  /** Profit divided by total staked. The number people quote. */
  roi: number;
  /** Wins over settled bets that could be won or lost (pushes excluded). */
  strikeRate: number;

  /** Sum of EV claimed at bet time. What the model said you should have made. */
  expectedProfit: number;

  clv: ReturnType<typeof summarizeClv>;
  /** Running bankroll after each settled bet, oldest first. */
  curve: { at: string; profit: number }[];

  /** The honest reading of all of the above. */
  verdict: string;
}

/**
 * Summarise the ledger.
 *
 * Profit is reported, but CLV is the headline. Over any sample a personal
 * bettor can realistically accumulate, profit is dominated by variance --
 * beating the closing line is the part that actually indicates skill.
 */
export function summarize(bets: Bet[], devigMethod: DevigMethod = "shin"): LedgerSummary {
  const settled = bets.filter((b) => b.status !== "open");
  const decided = settled.filter((b) => b.status === "won" || b.status === "lost");

  const staked = settled.reduce((a, b) => a + b.stake, 0);
  const returned = settled.reduce((a, b) => a + (b.returned ?? 0), 0);
  const profit = returned - staked;
  const expectedProfit = bets.reduce((a, b) => a + b.stake * b.evAtBet, 0);

  const clvResults: ClvResult[] = bets
    .filter((b) => b.closingOdds !== undefined)
    .map((b) =>
      closingLineValue({
        betOdds: b.odds,
        closingOdds: b.closingOdds as number,
        closingMarket: b.closingMarket,
        outcomeIndex: b.closingOutcomeIndex,
        method: devigMethod,
      }),
    );

  const chronological = [...settled].sort((a, b) =>
    (a.settledAt ?? a.placedAt).localeCompare(b.settledAt ?? b.placedAt),
  );
  let running = 0;
  const curve = chronological.map((b) => {
    running += (b.returned ?? 0) - b.stake;
    return { at: b.settledAt ?? b.placedAt, profit: running };
  });

  const clv = summarizeClv(clvResults);

  return {
    totalBets: bets.length,
    openBets: bets.length - settled.length,
    settledBets: settled.length,
    staked,
    returned,
    profit,
    roi: staked > 0 ? profit / staked : 0,
    strikeRate: decided.length > 0 ? decided.filter((b) => b.status === "won").length / decided.length : 0,
    expectedProfit,
    clv,
    curve,
    verdict: verdict(settled.length, profit, staked, clvResults.length, clv.averageClvPercent),
  };
}

function verdict(
  settledCount: number,
  profit: number,
  staked: number,
  clvCount: number,
  meanClv: number,
): string {
  if (settledCount === 0) return "Nothing settled yet.";

  const roi = staked > 0 ? profit / staked : 0;
  const roiText = `${(roi * 100).toFixed(1)}% ROI over ${settledCount} settled bet${settledCount === 1 ? "" : "s"}`;

  if (settledCount < 100) {
    return `${roiText}. Far too small a sample to mean anything either way -- at typical edges you need several hundred bets before profit separates from luck. Watch CLV instead.`;
  }
  if (clvCount < 30) {
    return `${roiText}, but closing lines are recorded for only ${clvCount} bets. Without CLV there is no way to tell skill from variance.`;
  }
  if (meanClv > 0 && profit > 0) {
    return `${roiText}, and you are beating the close by ${(meanClv * 100).toFixed(2)}% on average. Profit backed by CLV is the combination that suggests a real edge.`;
  }
  if (meanClv > 0) {
    return `Losing money (${roiText}) while still beating the close by ${(meanClv * 100).toFixed(2)}%. That pattern is consistent with a real edge running badly -- keep going and keep the stakes the same.`;
  }
  if (profit > 0) {
    return `${roiText}, but you are not beating the close. Winning without CLV usually means the results have been kind, not that the method works. Do not scale up on this.`;
  }
  return `${roiText} and negative CLV. Both signals agree: this is not working yet.`;
}
