/**
 * Closing Line Value.
 *
 * CLV is the only fast feedback signal in betting that is not mostly noise.
 *
 * Results tell you almost nothing in the short run -- you can be sharp and lose
 * for months, or be terrible and win for months. But the closing line is the
 * market's most informed estimate, formed after all the money and news are in.
 * If you consistently bet prices better than the close, you are finding real
 * information before the market does, and profit follows on a long enough
 * horizon. If you do not beat the close, no amount of winning proves you have
 * an edge -- you got lucky.
 *
 * So this app treats CLV, not profit, as the primary scoreboard for the model.
 */

import { devig, type DevigMethod } from "./devig";
import { impliedProbability, isValidDecimal } from "./format";

export interface ClvResult {
  /** The price you actually took. */
  betOdds: number;
  /** The price the market closed at, same book/market. */
  closingOdds: number;
  /**
   * Price improvement over the close. 0.03 means you got 3% better odds.
   * Positive is good.
   */
  clvPercent: number;
  /** True if you got a strictly better price than the close. */
  beatClose: boolean;
  /**
   * EV of your bet measured against the closing line's *fair* probability.
   * This is the honest version: it removes the vig from the close before
   * judging you, so you are not credited for merely beating a juiced price.
   */
  evVsClose: number | null;
  /** Fair closing probability used for `evVsClose`, if a full market was given. */
  closingFairProbability: number | null;
}

/**
 * Compute CLV for a single bet.
 *
 * `closingMarket` should be every outcome of the market at close, so the vig can
 * be removed. Pass it whenever you have it -- without it, `evVsClose` is null
 * and you only get the cruder price comparison.
 */
export function closingLineValue(params: {
  betOdds: number;
  closingOdds: number;
  closingMarket?: number[];
  outcomeIndex?: number;
  method?: DevigMethod;
}): ClvResult {
  const { betOdds, closingOdds, closingMarket, outcomeIndex, method = "shin" } = params;

  if (!isValidDecimal(betOdds)) throw new Error(`Invalid bet odds: ${betOdds}`);
  if (!isValidDecimal(closingOdds)) throw new Error(`Invalid closing odds: ${closingOdds}`);

  const clvPercent = betOdds / closingOdds - 1;

  let evVsClose: number | null = null;
  let closingFairProbability: number | null = null;

  if (closingMarket && closingMarket.length >= 2 && outcomeIndex !== undefined) {
    if (outcomeIndex < 0 || outcomeIndex >= closingMarket.length) {
      throw new Error(`outcomeIndex ${outcomeIndex} out of range for closing market`);
    }
    const fair = devig(closingMarket, method);
    closingFairProbability = fair.fair[outcomeIndex];
    evVsClose = closingFairProbability * betOdds - 1;
  }

  return {
    betOdds,
    closingOdds,
    clvPercent,
    beatClose: betOdds > closingOdds,
    evVsClose,
    closingFairProbability,
  };
}

export interface ClvSummary {
  count: number;
  /** Share of bets that beat the closing price. Above 0.55 is a strong signal. */
  beatCloseRate: number;
  /** Mean price improvement across all bets. */
  averageClvPercent: number;
  /** Mean EV against fair closing probability, over bets where it was computable. */
  averageEvVsClose: number | null;
  /**
   * Rough read on whether the CLV edge is real rather than noise, using the
   * standard error of the mean. |t| > 2 is the usual "probably not luck" bar.
   */
  tStatistic: number | null;
  verdict: string;
}

/**
 * Aggregate CLV across a bet history.
 *
 * The t-statistic here is deliberately crude -- it assumes independent bets,
 * which correlated same-day bets violate. Treat it as a smoke alarm, not a
 * proof.
 */
export function summarizeClv(results: ClvResult[]): ClvSummary {
  if (results.length === 0) {
    return {
      count: 0,
      beatCloseRate: 0,
      averageClvPercent: 0,
      averageEvVsClose: null,
      tStatistic: null,
      verdict: "No bets logged yet.",
    };
  }

  const n = results.length;
  const clvs = results.map((r) => r.clvPercent);
  const mean = clvs.reduce((a, b) => a + b, 0) / n;
  const beatCloseRate = results.filter((r) => r.beatClose).length / n;

  const withEv = results.filter((r) => r.evVsClose !== null).map((r) => r.evVsClose as number);
  const averageEvVsClose = withEv.length ? withEv.reduce((a, b) => a + b, 0) / withEv.length : null;

  let tStatistic: number | null = null;
  if (n > 1) {
    const variance = clvs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
    const stdErr = Math.sqrt(variance / n);
    tStatistic = stdErr > 0 ? mean / stdErr : null;
  }

  return {
    count: n,
    beatCloseRate,
    averageClvPercent: mean,
    averageEvVsClose,
    tStatistic,
    verdict: verdictFor(n, mean, tStatistic),
  };
}

function verdictFor(n: number, meanClv: number, t: number | null): string {
  if (n < 30) {
    return `Only ${n} bets -- far too few to read. CLV needs 100+ bets before it means anything.`;
  }
  if (t === null) return "Not enough variation to assess.";
  if (meanClv > 0 && t > 2) {
    return `Beating the close by ${(meanClv * 100).toFixed(2)}% on average (t=${t.toFixed(1)}). This is the signature of a real edge.`;
  }
  if (meanClv > 0) {
    return `Slightly positive CLV (${(meanClv * 100).toFixed(2)}%) but t=${t.toFixed(1)} is inside the noise band. Keep logging.`;
  }
  return `Negative CLV (${(meanClv * 100).toFixed(2)}%). The market is moving against your bets -- the model is not finding information, whatever the P&L says.`;
}

/** Convenience: raw implied probability move from bet time to close. */
export function lineMovement(betOdds: number, closingOdds: number): number {
  return impliedProbability(closingOdds) - impliedProbability(betOdds);
}
