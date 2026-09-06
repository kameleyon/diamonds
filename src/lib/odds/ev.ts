/**
 * Expected value, edge, and stake sizing.
 *
 * Everything here takes a probability you believe and a price you can actually
 * get, and answers two questions: is this bet worth making, and how much of the
 * bankroll should it risk.
 */

import { isValidDecimal } from "./format";

/**
 * Expected profit per 1 unit staked.
 *
 *   EV = p * (d - 1) - (1 - p)  ==  p * d - 1
 *
 * 0.04 means you expect to win 4% of your stake on average. This is identical
 * to `edge` below -- they are the same quantity, kept as two names because the
 * betting world uses both.
 */
export function expectedValue(probability: number, decimalOdds: number): number {
  assertProb(probability);
  if (!isValidDecimal(decimalOdds)) throw new Error(`Invalid decimal odds: ${decimalOdds}`);
  return probability * decimalOdds - 1;
}

/** Alias for `expectedValue`, expressed as a percentage of stake. */
export function edgePercent(probability: number, decimalOdds: number): number {
  return expectedValue(probability, decimalOdds) * 100;
}

/**
 * How much better the offered price is than fair.
 *
 * A price of 2.10 against a fair price of 2.00 is 5% of price value. This is
 * NOT the same as EV -- it is the metric to use when comparing books against
 * each other rather than deciding whether to bet.
 */
export function priceValue(offeredDecimal: number, fairDecimal: number): number {
  if (!isValidDecimal(offeredDecimal) || !isValidDecimal(fairDecimal)) {
    throw new Error("Invalid decimal odds in price comparison");
  }
  return offeredDecimal / fairDecimal - 1;
}

/**
 * Full Kelly stake as a fraction of bankroll.
 *
 *   f* = (p * d - 1) / (d - 1) = edge / (d - 1)
 *
 * Kelly maximises long-run log growth, but it assumes your probability is
 * exactly right. It never is. Full Kelly on an overconfident model is how
 * bankrolls die, so `recommendedStake` below applies a fraction and a cap --
 * use that, not this, for anything you actually bet.
 */
export function kellyFraction(probability: number, decimalOdds: number): number {
  assertProb(probability);
  if (!isValidDecimal(decimalOdds)) throw new Error(`Invalid decimal odds: ${decimalOdds}`);
  const b = decimalOdds - 1;
  const f = (probability * decimalOdds - 1) / b;
  return Math.max(0, f);
}

export interface StakeConfig {
  /** Fraction of full Kelly to actually bet. 0.25 (quarter Kelly) is standard. */
  kellyMultiplier: number;
  /** Hard ceiling on any single bet, as a fraction of bankroll. */
  maxStakeFraction: number;
  /** Bets below this EV are not worth the variance or the effort. */
  minEdge: number;
}

export const DEFAULT_STAKE_CONFIG: StakeConfig = {
  // Quarter Kelly: ~1/4 the volatility of full Kelly for ~3/4 the growth rate,
  // and it stays solvent when the model is wrong -- which it will sometimes be.
  kellyMultiplier: 0.25,
  maxStakeFraction: 0.02,
  minEdge: 0.02,
};

export interface StakeRecommendation {
  /** Fraction of bankroll to stake. 0 means do not bet. */
  fraction: number;
  /** Absolute stake in currency units. */
  amount: number;
  /** Full Kelly before the multiplier and cap, for reference. */
  fullKelly: number;
  ev: number;
  /**
   * Which rule stopped or shrank the bet, if any.
   *
   * `not-credible` is set by the engine rather than by this module: it means
   * the edge may be arithmetically real but the evidence behind it is not
   * trustworthy, so no money is sized onto it.
   */
  limitedBy:
    | "none"
    | "below-min-edge"
    | "negative-ev"
    | "max-stake-cap"
    | "not-credible";
}

/**
 * Turn a probability and a price into an actual stake.
 *
 * Applies, in order: a minimum-edge filter, fractional Kelly, and a hard cap.
 * The cap matters more than it looks -- it is the thing that survives a model
 * that is badly wrong about one specific market.
 */
export function recommendedStake(
  probability: number,
  decimalOdds: number,
  bankroll: number,
  config: StakeConfig = DEFAULT_STAKE_CONFIG,
): StakeRecommendation {
  const ev = expectedValue(probability, decimalOdds);
  const fullKelly = kellyFraction(probability, decimalOdds);

  if (ev <= 0) {
    return { fraction: 0, amount: 0, fullKelly, ev, limitedBy: "negative-ev" };
  }
  if (ev < config.minEdge) {
    return { fraction: 0, amount: 0, fullKelly, ev, limitedBy: "below-min-edge" };
  }

  const scaled = fullKelly * config.kellyMultiplier;
  const capped = Math.min(scaled, config.maxStakeFraction);

  return {
    fraction: capped,
    amount: capped * bankroll,
    fullKelly,
    ev,
    limitedBy: capped < scaled ? "max-stake-cap" : "none",
  };
}

/**
 * Shrink a model probability toward the market's fair probability.
 *
 * This is the single most valuable line of defence in the whole app. A model
 * trained on limited data is systematically overconfident, and the market
 * aggregates far more information than any solo model does. Blending pulls
 * wild disagreements back toward reality, so the bets that survive are the ones
 * where the model disagrees *persistently*, not noisily.
 *
 * `modelWeight` of 0.3 means "trust the market 70%". Start low and only raise
 * it once a backtest earns it.
 */
export function blendProbability(
  modelProbability: number,
  marketFairProbability: number,
  modelWeight: number,
): number {
  assertProb(modelProbability);
  assertProb(marketFairProbability);
  if (modelWeight < 0 || modelWeight > 1) {
    throw new Error(`modelWeight must be in [0,1], got ${modelWeight}`);
  }
  return modelWeight * modelProbability + (1 - modelWeight) * marketFairProbability;
}

/**
 * Break-even win rate for a price -- what you must hit just to not lose money.
 * Sanity check: if your model claims to beat this by a mile, distrust the model.
 */
export function breakEvenRate(decimalOdds: number): number {
  if (!isValidDecimal(decimalOdds)) throw new Error(`Invalid decimal odds: ${decimalOdds}`);
  return 1 / decimalOdds;
}

function assertProb(p: number): void {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error(`Probability must be in (0,1), got ${p}`);
  }
}
