/**
 * Parlay / accumulator maths.
 *
 * The central fact this module exists to make visible:
 *
 *   For independent legs, parlay EV = product(1 + EV_i) - 1
 *
 * Multiplication is not a bonus, it is a magnifier of whatever sign you feed
 * it. Three legs at +3% EV compound to about +9.3%. Three legs at -5% EV --
 * which is what a normal vigged price is -- compound to about -14.3%. This is
 * exactly why books push parlays: the house edge compounds per leg while the
 * payout only looks bigger.
 *
 * So a parlay is only ever correct when EVERY leg is independently +EV. This
 * module refuses to pretend otherwise.
 */

import { isValidDecimal } from "./format";
import { expectedValue, kellyFraction } from "./ev";

export interface ParlayLeg {
  id: string;
  label: string;
  /** Your believed probability for this leg. */
  probability: number;
  /** The price offered on this leg. */
  decimalOdds: number;
}

export interface ParlayAnalysis {
  legs: ParlayLeg[];
  /** Product of leg prices -- what the book pays. */
  combinedOdds: number;
  /** Product of leg probabilities, under an independence assumption. */
  combinedProbability: number;
  ev: number;
  /** Full Kelly on the parlay as a single bet. */
  fullKelly: number;
  /** Per-leg EV, so a single rotten leg is visible rather than buried. */
  legEv: number[];
  /** True only if every leg clears 0 EV on its own. */
  allLegsPositive: boolean;
  /**
   * The parlay's EV compared against betting the same legs singly. Almost
   * always negative once any leg is -EV.
   */
  evVsStraights: number;
  warnings: string[];
}

/**
 * Analyse a parlay under the independence assumption.
 *
 * IMPORTANT: independence is an assumption, and for same-game legs it is
 * usually false. Correlated legs (a team winning AND going over the total) have
 * a true joint probability higher than the product, which is why books either
 * refuse them or price them with extra margin. `correlationAdjusted()` below
 * handles the cases where you can estimate the correlation.
 */
export function analyzeParlay(legs: ParlayLeg[]): ParlayAnalysis {
  if (legs.length < 2) throw new Error("A parlay needs at least 2 legs");

  const warnings: string[] = [];

  for (const leg of legs) {
    if (!isValidDecimal(leg.decimalOdds)) {
      throw new Error(`Leg "${leg.label}" has invalid odds: ${leg.decimalOdds}`);
    }
    if (!(leg.probability > 0 && leg.probability < 1)) {
      throw new Error(`Leg "${leg.label}" has invalid probability: ${leg.probability}`);
    }
  }

  const combinedOdds = legs.reduce((a, l) => a * l.decimalOdds, 1);
  const combinedProbability = legs.reduce((a, l) => a * l.probability, 1);
  const legEv = legs.map((l) => expectedValue(l.probability, l.decimalOdds));
  const ev = combinedProbability * combinedOdds - 1;
  const allLegsPositive = legEv.every((e) => e > 0);

  // Betting the same legs as independent singles, equal stake each.
  const straightsEv = legEv.reduce((a, b) => a + b, 0) / legs.length;
  const evVsStraights = ev - straightsEv;

  if (!allLegsPositive) {
    const bad = legs.filter((_, i) => legEv[i] <= 0).map((l) => l.label);
    warnings.push(
      `Negative-EV leg(s) present: ${bad.join(", ")}. Parlaying multiplies the ` +
        `house edge on these legs -- this parlay is worse than its worst leg.`,
    );
  }
  if (legs.length > 4) {
    warnings.push(
      `${legs.length} legs. Variance grows far faster than EV here; hit rate is ` +
        `${(combinedProbability * 100).toFixed(1)}%, so expect long losing runs even if the edge is real.`,
    );
  }
  if (allLegsPositive && ev > 0) {
    warnings.push(
      `All legs are +EV so the parlay compounds a real edge -- but only if the legs ` +
        `are genuinely independent. Same-game legs usually are not.`,
    );
  }

  return {
    legs,
    combinedOdds,
    combinedProbability,
    ev,
    fullKelly: ev > 0 ? kellyFraction(combinedProbability, combinedOdds) : 0,
    legEv,
    allLegsPositive,
    evVsStraights,
    warnings,
  };
}

/**
 * Two-leg parlay with an explicit correlation estimate.
 *
 * Uses a joint probability built from the correlation coefficient rather than a
 * flat product:
 *
 *   P(A and B) = P(A)P(B) + rho * sqrt(P(A)(1-P(A))P(B)(1-P(B)))
 *
 * rho > 0 for legs that tend to happen together (favourite wins AND over hits
 * in a high-scoring matchup). Positive correlation raises the true joint
 * probability above the product, which is the only situation where a same-game
 * parlay can be better than it looks -- and books know it, so verify the price
 * really has not already absorbed it.
 */
export function correlatedTwoLegProbability(
  pA: number,
  pB: number,
  rho: number,
): number {
  if (rho < -1 || rho > 1) throw new Error(`Correlation must be in [-1,1], got ${rho}`);
  const joint = pA * pB + rho * Math.sqrt(pA * (1 - pA) * pB * (1 - pB));
  // Clamp to the Fréchet bounds -- the joint probability of two events can never
  // exceed either marginal, nor fall below the overlap they are forced to share.
  const upper = Math.min(pA, pB);
  const lower = Math.max(0, pA + pB - 1);
  return Math.min(upper, Math.max(lower, joint));
}

/**
 * The book's margin on a parlay, given the fair (devigged) probability of each
 * leg. Shows how much juice compounds across the ticket.
 */
export function parlayHold(fairProbabilities: number[], offeredCombinedOdds: number): number {
  const fairProb = fairProbabilities.reduce((a, b) => a * b, 1);
  const fairOdds = 1 / fairProb;
  return 1 - offeredCombinedOdds / fairOdds;
}
