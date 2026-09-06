/**
 * Ledger analytics. Pure functions over a bet list, storage-agnostic.
 */

import { closingLineValue, summarizeClv, type ClvResult } from "../odds/clv";
import type { DevigMethod } from "../odds/devig";
import type { Bet } from "./bet-types";

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
