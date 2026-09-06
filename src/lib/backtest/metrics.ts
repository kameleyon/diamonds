/**
 * Scoring rules for probabilistic forecasts.
 *
 * Accuracy is deliberately not the headline. A model that says "home win, 51%"
 * and a model that says "home win, 99%" score identically on accuracy, but one
 * of them is far more useful and far more dangerous. Betting is priced in
 * probabilities, so the model has to be judged in probabilities.
 *
 * Log loss is the primary metric because it is a *strictly proper* scoring
 * rule: it is minimised only by reporting your true beliefs. Any attempt to
 * game it -- shading toward confident predictions to look decisive -- makes the
 * score worse. That property is exactly what you want from the number that
 * decides whether a model gets to influence real money.
 */

/** Probabilities are clamped before taking logs; a confident miss is bounded. */
const EPS = 1e-15;

export interface Forecast {
  /** Probability assigned to each outcome. Should sum to 1. */
  probabilities: number[];
  /** Index of the outcome that actually happened. */
  outcome: number;
}

/**
 * Mean negative log-likelihood. Lower is better.
 *
 * Reference points for a 3-way market: a uniform guess scores ln(3) = 1.099.
 * Anything above that is worse than knowing nothing.
 */
export function logLoss(forecasts: Forecast[]): number {
  if (forecasts.length === 0) return NaN;
  let total = 0;
  for (const f of forecasts) {
    const p = Math.min(Math.max(f.probabilities[f.outcome] ?? 0, EPS), 1);
    total -= Math.log(p);
  }
  return total / forecasts.length;
}

/**
 * Multiclass Brier score: mean squared error across the full probability
 * vector. Also strictly proper, and less punishing of confident misses than log
 * loss, so the two disagreeing is itself informative.
 */
export function brierScore(forecasts: Forecast[]): number {
  if (forecasts.length === 0) return NaN;
  let total = 0;
  for (const f of forecasts) {
    for (let i = 0; i < f.probabilities.length; i++) {
      const actual = i === f.outcome ? 1 : 0;
      total += (f.probabilities[i] - actual) ** 2;
    }
  }
  return total / forecasts.length;
}

/** Share of forecasts whose highest-probability outcome occurred. */
export function accuracy(forecasts: Forecast[]): number {
  if (forecasts.length === 0) return NaN;
  let hits = 0;
  for (const f of forecasts) {
    let best = 0;
    for (let i = 1; i < f.probabilities.length; i++) {
      if (f.probabilities[i] > f.probabilities[best]) best = i;
    }
    if (best === f.outcome) hits++;
  }
  return hits / forecasts.length;
}

export interface CalibrationBucket {
  /** Lower edge of the predicted-probability band. */
  from: number;
  to: number;
  count: number;
  /** Mean probability the model assigned in this band. */
  predicted: number;
  /** Fraction of those that actually happened. */
  actual: number;
}

/**
 * Reliability diagram data.
 *
 * Every (probability, did-it-happen) pair across all outcomes is bucketed, so a
 * three-way market contributes three points per match. A well-calibrated model
 * has `actual` tracking `predicted` down the table: of everything it called
 * 30%, close to 30% should have happened.
 *
 * This is the diagnostic that tells you *how* a model is wrong. Log loss says
 * a model is bad; calibration says whether it is overconfident, underconfident,
 * or simply biased toward one outcome.
 */
export function calibration(forecasts: Forecast[], buckets = 10): CalibrationBucket[] {
  const bins: { sumPred: number; hits: number; count: number }[] = Array.from(
    { length: buckets },
    () => ({ sumPred: 0, hits: 0, count: 0 }),
  );

  for (const f of forecasts) {
    for (let i = 0; i < f.probabilities.length; i++) {
      const p = f.probabilities[i];
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor(p * buckets)));
      bins[idx].sumPred += p;
      bins[idx].hits += i === f.outcome ? 1 : 0;
      bins[idx].count += 1;
    }
  }

  return bins.map((b, i) => ({
    from: i / buckets,
    to: (i + 1) / buckets,
    count: b.count,
    predicted: b.count ? b.sumPred / b.count : 0,
    actual: b.count ? b.hits / b.count : 0,
  }));
}

/**
 * Expected calibration error: average gap between predicted and actual,
 * weighted by how many forecasts fall in each bucket. 0 is perfect.
 */
export function calibrationError(forecasts: Forecast[], buckets = 10): number {
  const bins = calibration(forecasts, buckets);
  const total = bins.reduce((a, b) => a + b.count, 0);
  if (total === 0) return NaN;
  return bins.reduce((a, b) => a + (b.count / total) * Math.abs(b.predicted - b.actual), 0);
}

/**
 * Skill score against a baseline: 1 - model/baseline.
 *
 * Positive means the model beats the baseline, 0 means it matches it, negative
 * means it is worse than the trivial alternative. Reporting raw log loss alone
 * hides this -- 1.02 sounds fine until you learn that always guessing the base
 * rate scores 1.03.
 */
export function skillScore(model: number, baseline: number): number {
  if (!Number.isFinite(model) || !Number.isFinite(baseline) || baseline === 0) return NaN;
  return 1 - model / baseline;
}

/**
 * The baseline every model must beat: the historical frequency of each outcome,
 * ignoring who is playing.
 *
 * For soccer that is roughly 45/27/28 home/draw/away. A model that cannot beat
 * this has learned nothing about the teams -- it has only learned that home
 * sides win more often, which is free.
 */
export function baseRateForecasts(forecasts: Forecast[]): Forecast[] {
  if (forecasts.length === 0) return [];
  const k = forecasts[0].probabilities.length;
  const counts = new Array<number>(k).fill(0);
  for (const f of forecasts) counts[f.outcome]++;
  const rates = counts.map((c) => c / forecasts.length);
  return forecasts.map((f) => ({ probabilities: rates, outcome: f.outcome }));
}
