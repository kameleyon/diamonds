/**
 * Vig removal.
 *
 * A bookmaker's quoted prices imply probabilities that sum to more than 1. The
 * excess is the margin (vig/juice). To compare a model against the market you
 * first have to strip that margin out and recover the book's *fair* estimate.
 *
 * How you strip it matters. The naive method (multiplicative) assumes the
 * margin is spread proportionally across outcomes, which systematically
 * overprices favourites and underprices longshots -- the same favourite-longshot
 * bias that is well documented in the literature. Power and Shin both correct
 * for this, and they disagree with multiplicative by 1-3 percentage points on
 * lopsided markets. That is larger than most real edges, so the choice of
 * method is not cosmetic: it can invent or erase an edge on its own.
 *
 * Default is `shin`, with `power` as the usual second opinion.
 */

import { impliedProbability, isValidDecimal } from "./format";

export type DevigMethod = "multiplicative" | "additive" | "power" | "shin";

export interface DevigResult {
  method: DevigMethod;
  /** Fair probabilities. Sums to 1 (within tolerance). */
  fair: number[];
  /** Fair decimal prices, i.e. 1 / fair[i]. */
  fairOdds: number[];
  /** Sum of raw implied probabilities minus 1. 0.05 == a 5% overround. */
  overround: number;
  /** Bookmaker hold as a fraction of turnover: overround / (1 + overround). */
  hold: number;
  /** Solver parameter, when the method has one (power `k`, Shin `z`). */
  params: { k?: number; z?: number };
  /** False if the numeric solver hit its iteration cap without converging. */
  converged: boolean;
}

const EPS = 1e-12;
const MAX_ITER = 200;

function rawProbabilities(decimalOdds: number[]): number[] {
  if (decimalOdds.length < 2) {
    throw new Error("Devigging requires at least 2 outcomes in the market");
  }
  return decimalOdds.map((d) => {
    if (!isValidDecimal(d)) throw new Error(`Invalid decimal odds in market: ${d}`);
    return impliedProbability(d);
  });
}

interface Solved {
  fair: number[];
  converged: boolean;
  params: { k?: number; z?: number };
}

/**
 * Proportional margin removal: p_i = q_i / sum(q).
 * Fast and universally understood, but carries the favourite-longshot bias.
 */
function multiplicative(q: number[]): Solved {
  const sum = q.reduce((a, b) => a + b, 0);
  return { fair: q.map((x) => x / sum), converged: true, params: {} };
}

/**
 * Equal-share margin removal: p_i = q_i - (sum(q) - 1) / n.
 *
 * Assumes the book charges every outcome the same absolute amount of vig. Can
 * drive a longshot negative on very lopsided markets; when that happens we
 * clamp, renormalise, and report non-convergence so the caller knows the
 * method was a poor fit rather than silently trusting the output.
 */
function additive(q: number[]): Solved {
  const n = q.length;
  const excess = q.reduce((a, b) => a + b, 0) - 1;
  let fair = q.map((x) => x - excess / n);
  if (fair.some((p) => p <= 0)) {
    fair = fair.map((p) => Math.max(p, EPS));
    const s = fair.reduce((a, b) => a + b, 0);
    return { fair: fair.map((p) => p / s), converged: false, params: {} };
  }
  return { fair, converged: true, params: {} };
}

/**
 * Power method: find k such that sum(q_i^k) = 1, then p_i = q_i^k.
 *
 * Because every q_i < 1, raising to k > 1 shrinks small probabilities
 * proportionally more than large ones -- exactly the correction the
 * favourite-longshot bias calls for. sum(q_i^k) is strictly decreasing in k, so
 * plain bisection is safe and needs no derivative.
 */
function power(q: number[]): Solved {
  const f = (k: number) => q.reduce((a, x) => a + Math.pow(x, k), 0) - 1;

  let lo = 1;
  let hi = 2;
  let guard = 0;
  while (f(hi) > 0 && guard++ < 60) hi *= 2;

  let k = 1;
  let converged = false;
  for (let i = 0; i < MAX_ITER; i++) {
    k = (lo + hi) / 2;
    const v = f(k);
    if (Math.abs(v) < 1e-12 || hi - lo < 1e-14) {
      converged = true;
      break;
    }
    if (v > 0) lo = k;
    else hi = k;
  }

  const fair = q.map((x) => Math.pow(x, k));
  const s = fair.reduce((a, b) => a + b, 0);
  return { fair: fair.map((p) => p / s), converged, params: { k } };
}

/**
 * Shin (1992/1993) method.
 *
 * Models the book as pricing to protect itself against a proportion `z` of
 * insider money. Solving for the z that makes the fair probabilities sum to 1
 * recovers the book's own estimate. Best calibrated of the closed-form methods
 * and the one most sharp bettors default to.
 *
 *   p_i = ( sqrt(z^2 + 4(1-z) * q_i^2 / R) - z ) / (2(1-z)),  R = sum(q)
 */
function shin(q: number[]): Solved {
  const R = q.reduce((a, b) => a + b, 0);

  // No special case at z = 0: the formula is well defined there and yields
  // q_i / sqrt(R), which sums to sqrt(R) > 1 whenever there is a margin. That
  // positive value is precisely what brackets the root for bisection. Short-
  // circuiting z = 0 to q_i / R would make the objective trivially zero and
  // collapse Shin into multiplicative without any visible symptom.
  const probs = (z: number): number[] => {
    const denom = 2 * (1 - z);
    return q.map((x) => (Math.sqrt(z * z + 4 * (1 - z) * ((x * x) / R)) - z) / denom);
  };
  const f = (z: number) => probs(z).reduce((a, b) => a + b, 0) - 1;

  let lo = 0;
  let hi = 0.9999;
  let z = 0;
  let converged = false;

  for (let i = 0; i < MAX_ITER; i++) {
    z = (lo + hi) / 2;
    const v = f(z);
    if (Math.abs(v) < 1e-12 || hi - lo < 1e-14) {
      converged = true;
      break;
    }
    if (v > 0) lo = z;
    else hi = z;
  }

  const fair = probs(z);
  const s = fair.reduce((a, b) => a + b, 0);
  return { fair: fair.map((p) => p / s), converged, params: { z } };
}

const METHODS: Record<DevigMethod, (q: number[]) => Solved> = {
  multiplicative,
  additive,
  power,
  shin,
};

/**
 * Strip the bookmaker margin from a complete market.
 *
 * `decimalOdds` must cover every outcome of ONE market from ONE book -- all
 * three prices of a 1X2, both sides of a total, both moneylines. Mixing books
 * or passing a partial market produces a meaningless overround and therefore a
 * meaningless fair price.
 */
export function devig(decimalOdds: number[], method: DevigMethod = "shin"): DevigResult {
  const q = rawProbabilities(decimalOdds);
  const R = q.reduce((a, b) => a + b, 0);

  // R <= 1 means no margin to remove: either a genuine cross-book arbitrage or
  // bad data. Normalise only, and never let a solver invent structure here.
  if (R <= 1) {
    const fair = q.map((x) => x / R);
    return {
      method,
      fair,
      fairOdds: fair.map((p) => 1 / p),
      overround: R - 1,
      hold: (R - 1) / R,
      params: {},
      converged: true,
    };
  }

  const { fair, converged, params } = METHODS[method](q);

  return {
    method,
    fair,
    fairOdds: fair.map((p) => 1 / p),
    overround: R - 1,
    hold: (R - 1) / R,
    params,
    converged,
  };
}

/**
 * Run every method over the same market.
 *
 * Both a diagnostic and a conservatism tool: if the methods disagree by more
 * than your edge, you do not have an edge -- you have a modelling artefact.
 */
export function devigAll(decimalOdds: number[]): Record<DevigMethod, DevigResult> {
  return {
    multiplicative: devig(decimalOdds, "multiplicative"),
    additive: devig(decimalOdds, "additive"),
    power: devig(decimalOdds, "power"),
    shin: devig(decimalOdds, "shin"),
  };
}

/**
 * The most conservative fair probability available for one outcome.
 *
 * Taking the highest fair probability across methods yields the *smallest*
 * implied edge, so a bet only survives if it beats every reasonable reading of
 * the market. This is the number to bet on when you want to be honest with
 * yourself.
 */
export function worstCaseFair(decimalOdds: number[], index: number): number {
  const all = devigAll(decimalOdds);
  return Math.max(...Object.values(all).map((r) => r.fair[index]));
}
