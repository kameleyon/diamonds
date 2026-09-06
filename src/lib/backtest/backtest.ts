/**
 * Walk-forward backtesting.
 *
 * The single rule this module exists to enforce: a forecast for a match may use
 * ONLY information available before that match kicked off. Fit a model on the
 * whole dataset and then "predict" games inside that fit and you get beautiful
 * numbers that mean nothing -- the model has seen the answers. That failure is
 * silent, produces plausible output, and is the reason most backtests are
 * worthless.
 *
 * Two model families need different handling:
 *
 *   Elo is naturally sequential. Predict with the current ratings, then update
 *   with the result. There is no leakage possible and it costs one pass.
 *
 *   Dixon-Coles is a batch fit, so it is refitted on a rolling window of past
 *   matches only. Refitting before every single match would be exact but
 *   wasteful; refitting every `refitEvery` matches is the standard compromise
 *   and is stated in the report rather than hidden.
 *
 * WHAT THIS CANNOT TELL YOU: whether the model beats the market. That needs
 * closing odds for every historical match, which none of the current data
 * sources provide on their plans. A well-calibrated model is NECESSARY for
 * profitable betting but nowhere near SUFFICIENT -- the market is also well
 * calibrated, and beating it is a different and much harder bar.
 */

import { EloModel, twoWayToThreeWay, type MatchResult } from "../models/elo";
import { fitDixonColes, predictMatch, type SoccerMatch } from "../models/dixon-coles";
import { SPORTS, type SportId, type SportSpec } from "../sports/registry";
import type { StoredResult } from "../models/fit-from-scores";
import {
  logLoss,
  brierScore,
  accuracy,
  calibration,
  calibrationError,
  skillScore,
  baseRateForecasts,
  type Forecast,
  type CalibrationBucket,
} from "./metrics";

export interface BacktestOptions {
  /**
   * Matches to consume before scoring begins. Early forecasts come from ratings
   * that have seen almost nothing, and scoring them measures the warm-up rather
   * than the model.
   */
  warmup?: number;
  /** Dixon-Coles only: refit after this many scored matches. */
  refitEvery?: number;
  /** Dixon-Coles only: cap the training window. 0 uses all prior matches. */
  windowSize?: number;
  /**
   * Pull each forecast toward the base rate by this fraction, 0..1.
   *
   * Elo is systematically overconfident at the tails -- on real MLB data it
   * said 72% where 66% happened and 28% where 34% happened. Shrinking toward
   * the base rate is the standard correction.
   *
   * The base rate used is a RUNNING one, computed only from matches already
   * seen. Using the full-sample rate would leak the future into every early
   * forecast and quietly inflate the score.
   */
  shrinkage?: number;
}

export interface BacktestReport {
  sportId: SportId;
  label: string;
  model: "elo" | "dixon-coles";
  /** Set for per-league Dixon-Coles runs. */
  league?: string;

  /** Matches actually scored, after warm-up. */
  scored: number;
  skipped: number;

  logLoss: number;
  brier: number;
  accuracy: number;
  calibrationError: number;

  baseline: { logLoss: number; brier: number; accuracy: number };
  /** Positive means the model beat the base-rate baseline on log loss. */
  skill: number;

  calibration: CalibrationBucket[];
  outcomes: string[];
  refits?: number;
  verdict: string;
}

/**
 * Backtest an Elo-based sport.
 *
 * Strictly sequential: every prediction is made before the result is applied,
 * so leakage is structurally impossible rather than merely avoided.
 */
export function backtestElo(
  results: StoredResult[],
  spec: SportSpec,
  options: BacktestOptions = {},
): BacktestReport {
  // Default 0.4: a sweep over the real dataset put the optimum near 0.4-0.5 for
  // both MLB and soccer, cutting calibration error from 3.5% to 0.5% and 5.0%
  // to 3.4% respectively. Running uncalibrated is strictly worse.
  const { warmup = 100, shrinkage = 0.4 } = options;
  const ordered = [...results].sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  const model = new EloModel(spec);
  const forecasts: Forecast[] = [];
  let skipped = 0;

  const outcomes = spec.hasDraw ? ["home", "draw", "away"] : ["home", "away"];

  // Running tally of outcomes seen so far, for leak-free shrinkage.
  const seenCounts = new Array<number>(outcomes.length).fill(0);
  let seenTotal = 0;

  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i];

    // PREDICT FIRST. The rating used here has never seen this match.
    if (i >= warmup) {
      const twoWay = model.expectedScore(r.homeTeam, r.awayTeam);
      let probabilities: number[];
      let outcome: number;

      if (spec.hasDraw) {
        const p = twoWayToThreeWay(twoWay);
        probabilities = [p.home, p.draw, p.away];
        outcome = r.homeScore > r.awayScore ? 0 : r.homeScore === r.awayScore ? 1 : 2;
      } else {
        probabilities = [twoWay, 1 - twoWay];
        if (r.homeScore === r.awayScore) {
          // A draw in a sport with no draw outcome is unscoreable, not a loss.
          skipped++;
          applyResult(model, r);
          continue;
        }
        outcome = r.homeScore > r.awayScore ? 0 : 1;
      }

      if (shrinkage > 0 && seenTotal > 20) {
        const base = seenCounts.map((c) => c / seenTotal);
        probabilities = probabilities.map(
          (p, k) => (1 - shrinkage) * p + shrinkage * base[k],
        );
      }

      forecasts.push({ probabilities, outcome });
    }

    // Update the running base rate with this result, then learn from it.
    const seenIdx = spec.hasDraw
      ? r.homeScore > r.awayScore
        ? 0
        : r.homeScore === r.awayScore
          ? 1
          : 2
      : r.homeScore > r.awayScore
        ? 0
        : 1;
    if (spec.hasDraw || r.homeScore !== r.awayScore) {
      seenCounts[seenIdx]++;
      seenTotal++;
    }

    // ...then learn from it.
    applyResult(model, r);
  }

  return buildReport({
    sportId: spec.id,
    label: spec.label,
    model: "elo",
    forecasts,
    skipped,
    outcomes,
  });
}

function applyResult(model: EloModel, r: StoredResult): void {
  const result: MatchResult = {
    homeId: r.homeTeam,
    awayId: r.awayTeam,
    homeScore: r.homeScore > r.awayScore ? 1 : r.homeScore === r.awayScore ? 0.5 : 0,
    homePoints: r.homeScore,
    awayPoints: r.awayScore,
    date: new Date(r.completedAt),
  };
  model.update(result);
}

/**
 * Backtest Dixon-Coles for one league.
 *
 * Refits on a rolling window of strictly prior matches. Teams the current fit
 * has never seen are skipped rather than guessed at -- a forecast for an
 * unknown team would be pure prior and would flatter the score.
 */
export function backtestDixonColes(
  results: StoredResult[],
  league: string,
  options: BacktestOptions = {},
): BacktestReport {
  const { warmup = 80, refitEvery = 10, windowSize = 0 } = options;
  const ordered = [...results].sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  const forecasts: Forecast[] = [];
  let skipped = 0;
  let refits = 0;
  let fit: ReturnType<typeof fitDixonColes> | null = null;

  for (let i = warmup; i < ordered.length; i++) {
    // Refit on history only. `slice(0, i)` is the guarantee: index i is the
    // match being predicted and is excluded from its own training data.
    if (fit === null || (i - warmup) % refitEvery === 0) {
      const history = ordered.slice(windowSize > 0 ? Math.max(0, i - windowSize) : 0, i);
      const matches: SoccerMatch[] = history.map((r) => ({
        homeId: r.homeTeam,
        awayId: r.awayTeam,
        homeGoals: r.homeScore,
        awayGoals: r.awayScore,
        date: new Date(r.completedAt),
      }));
      try {
        fit = fitDixonColes(matches, { maxIterations: 2000 });
        refits++;
      } catch {
        skipped++;
        continue;
      }
    }

    const r = ordered[i];
    if (fit.attack[r.homeTeam] === undefined || fit.attack[r.awayTeam] === undefined) {
      skipped++;
      continue;
    }

    const p = predictMatch(fit, r.homeTeam, r.awayTeam);
    const outcome = r.homeScore > r.awayScore ? 0 : r.homeScore === r.awayScore ? 1 : 2;
    forecasts.push({ probabilities: [p.home, p.draw, p.away], outcome });
  }

  return buildReport({
    sportId: "soccer",
    label: `Soccer — ${league}`,
    model: "dixon-coles",
    league,
    forecasts,
    skipped,
    refits,
    outcomes: ["home", "draw", "away"],
  });
}

function buildReport(input: {
  sportId: SportId;
  label: string;
  model: "elo" | "dixon-coles";
  league?: string;
  forecasts: Forecast[];
  skipped: number;
  refits?: number;
  outcomes: string[];
}): BacktestReport {
  const { forecasts } = input;
  const base = baseRateForecasts(forecasts);

  const ll = logLoss(forecasts);
  const baseLl = logLoss(base);

  return {
    sportId: input.sportId,
    label: input.label,
    model: input.model,
    league: input.league,
    scored: forecasts.length,
    skipped: input.skipped,
    logLoss: ll,
    brier: brierScore(forecasts),
    accuracy: accuracy(forecasts),
    calibrationError: calibrationError(forecasts),
    baseline: {
      logLoss: baseLl,
      brier: brierScore(base),
      accuracy: accuracy(base),
    },
    skill: skillScore(ll, baseLl),
    calibration: calibration(forecasts),
    outcomes: input.outcomes,
    refits: input.refits,
    verdict: verdictFor(forecasts.length, skillScore(ll, baseLl), calibrationError(forecasts)),
  };
}

/**
 * Turn the numbers into a decision about model weight.
 *
 * The bar is deliberately high. Beating a base-rate baseline is the minimum
 * evidence of having learned anything at all; it is not evidence of being able
 * to beat a bookmaker, and the wording says so.
 */
function verdictFor(n: number, skill: number, ece: number): string {
  if (n < 100) {
    return `Only ${n} scored forecasts — too few to conclude anything. Backfill further and re-run.`;
  }
  if (!Number.isFinite(skill)) return "Could not score this model.";

  if (skill <= 0) {
    return `No skill over the base rate (${(skill * 100).toFixed(1)}%). The model has learned nothing about the teams beyond how often home sides win. Keep its weight at zero.`;
  }
  if (skill < 0.02) {
    return `Marginal skill (${(skill * 100).toFixed(1)}% better than base rate) over ${n} forecasts. That is within the range noise produces. Not enough to justify any model weight.`;
  }
  if (ece > 0.05) {
    return `Real skill (${(skill * 100).toFixed(1)}% over base rate) but poorly calibrated (${(ece * 100).toFixed(1)}% mean error). It ranks matches better than chance while getting the probabilities wrong, and betting needs the probabilities. Calibrate before using it.`;
  }
  return `${(skill * 100).toFixed(1)}% better than base rate over ${n} forecasts, calibration error ${(ece * 100).toFixed(1)}%. The model has genuine skill. That still does not mean it beats the market — comparing against closing odds is the next bar, and it needs historical closing lines this data does not include.`;
}

/** Backtest every sport that has enough stored history. */
export function backtestAll(
  results: StoredResult[],
  options: BacktestOptions = {},
): BacktestReport[] {
  const reports: BacktestReport[] = [];

  for (const sportId of Object.keys(SPORTS) as SportId[]) {
    const spec = SPORTS[sportId];
    const mine = results.filter((r) => r.sportId === sportId);
    if (mine.length < 150) continue;

    if (spec.model === "dixon-coles") {
      const byLeague = new Map<string, StoredResult[]>();
      for (const r of mine) {
        const league = r.sportKey.split(":")[1] ?? r.sportKey;
        if (!byLeague.has(league)) byLeague.set(league, []);
        byLeague.get(league)!.push(r);
      }
      for (const [league, rows] of byLeague) {
        if (rows.length < 150) continue;
        reports.push(backtestDixonColes(rows, league, options));
      }
      // Elo on the same data, as a control: if the simpler model scores better,
      // the extra machinery in Dixon-Coles is not earning its place.
      reports.push(backtestElo(mine, spec, options));
    } else {
      reports.push(backtestElo(mine, spec, options));
    }
  }

  return reports;
}
