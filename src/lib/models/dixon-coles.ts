/**
 * Dixon-Coles model for soccer.
 *
 * Independent Poisson is the textbook goals model, and it is wrong in one
 * specific, well-documented way: it underestimates 0-0, 1-0, 0-1 and 1-1. Low
 * scores are positively dependent in real football in a way independence cannot
 * capture, and those four scorelines are a large share of all matches -- so the
 * error lands squarely on the draw price and the under.
 *
 * Dixon & Coles (1997) fix this with a correction factor `tau` applied to
 * exactly those four cells, plus exponential time decay so recent form counts
 * for more than a result from two seasons ago.
 *
 * Each team gets an attack and a defence parameter; the league also gets a
 * shared home-advantage term. Goal rates are:
 *
 *   lambda (home) = exp(attack_home - defence_away + homeAdv)
 *   mu     (away) = exp(attack_away - defence_home)
 */

const MAX_GOALS = 10;

export interface SoccerMatch {
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
  date: Date;
}

export interface DixonColesParams {
  teams: string[];
  /** Attack strength per team, mean-centred for identifiability. */
  attack: Record<string, number>;
  /** Defence strength per team. Higher means concedes fewer. */
  defence: Record<string, number>;
  homeAdvantage: number;
  /** Low-score dependence correction. Typically small and negative. */
  rho: number;
  logLikelihood: number;
  iterations: number;
  converged: boolean;
  matchCount: number;
}

export interface FitOptions {
  /**
   * Time-decay rate per day. 0.0065 halves a match's weight after ~107 days,
   * roughly Dixon & Coles' own recommendation for a weekly-fixture league.
   * Set to 0 to weight all history equally.
   */
  decayPerDay?: number;
  maxIterations?: number;
  learningRate?: number;
  tolerance?: number;
  /** Reference date for decay. Defaults to the most recent match. */
  asOf?: Date;
}

/**
 * log(n!) from a precomputed table.
 *
 * This sits in the optimiser's innermost loop -- it is evaluated roughly
 * (iterations x parameters x matches) times, which is millions of calls for a
 * single fit. Computing the sum on every call made fitting several times
 * slower for no reason; goal counts never exceed a small integer, so a table
 * covers every case exactly.
 */
const LOG_FACTORIAL: number[] = (() => {
  const table = [0, 0];
  for (let i = 2; i <= 64; i++) table[i] = table[i - 1] + Math.log(i);
  return table;
})();

function logFactorial(n: number): number {
  if (n < 2) return 0;
  if (n < LOG_FACTORIAL.length) return LOG_FACTORIAL[n];
  // Stirling's approximation for the (never-in-practice) tail.
  return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
}

function logPoisson(k: number, lambda: number): number {
  return k * Math.log(lambda) - lambda - logFactorial(k);
}

function poisson(k: number, lambda: number): number {
  return Math.exp(logPoisson(k, lambda));
}

/**
 * The Dixon-Coles correction. Applies only to the four low-score cells; every
 * other scoreline is left as independent Poisson.
 */
export function tau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

interface Packed {
  values: number[];
  teams: string[];
  index: Map<string, number>;
}

/**
 * Parameters are packed into a flat vector for the optimiser:
 *   [attack_0..attack_{n-1}, defence_0..defence_{n-1}, homeAdv, rho]
 */
function pack(teams: string[]): Packed {
  const index = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const values = new Array<number>(2 * n + 2).fill(0);
  values[2 * n] = 0.25; // sensible starting home advantage
  values[2 * n + 1] = -0.05; // rho is small and typically negative
  return { values, teams, index };
}

function rates(
  v: number[],
  n: number,
  hi: number,
  ai: number,
): { lambda: number; mu: number } {
  const homeAdv = v[2 * n];
  const lambda = Math.exp(v[hi] - v[n + ai] + homeAdv);
  const mu = Math.exp(v[ai] - v[n + hi]);
  // Guard against the optimiser wandering into degenerate territory.
  return {
    lambda: Math.min(Math.max(lambda, 1e-6), 15),
    mu: Math.min(Math.max(mu, 1e-6), 15),
  };
}

/**
 * Weighted log-likelihood of the whole dataset under a parameter vector.
 * `rho` is clamped to the region where tau stays positive; outside it the
 * likelihood is undefined and the optimiser must be pushed back.
 */
function negLogLikelihood(
  v: number[],
  matches: SoccerMatch[],
  weights: number[],
  n: number,
  index: Map<string, number>,
): number {
  const rho = v[2 * n + 1];
  let total = 0;

  for (let m = 0; m < matches.length; m++) {
    const match = matches[m];
    const hi = index.get(match.homeId);
    const ai = index.get(match.awayId);
    if (hi === undefined || ai === undefined) continue;

    const { lambda, mu } = rates(v, n, hi, ai);
    const t = tau(match.homeGoals, match.awayGoals, lambda, mu, rho);
    // tau <= 0 means an invalid rho; return a large penalty so the optimiser
    // retreats rather than taking log of a non-positive number.
    if (t <= 1e-10) return 1e12;

    total +=
      weights[m] *
      (Math.log(t) + logPoisson(match.homeGoals, lambda) + logPoisson(match.awayGoals, mu));
  }

  return -total;
}

/**
 * Analytic gradient of the negative weighted log-likelihood.
 *
 * One pass over the matches produces every partial derivative, instead of the
 * `2 * dim + 1` passes a central-difference estimate needs. On a 20-team league
 * that is an ~85x reduction in work per iteration, which is the difference
 * between a fit that finishes in a second and one that does not finish at all.
 *
 * Derivation. For one match with weight w, goals (x, y):
 *
 *   dLL/dlambda = w * [ (1/tau) * dtau/dlambda + x/lambda - 1 ]
 *   dLL/dmu     = w * [ (1/tau) * dtau/dmu     + y/mu     - 1 ]
 *   dLL/drho    = w *   (1/tau) * dtau/drho
 *
 * and since lambda = exp(attack_h - defence_a + adv), mu = exp(attack_a - defence_h):
 *
 *   dlambda/d(attack_h) = lambda,  dlambda/d(defence_a) = -lambda,  dlambda/d(adv) = lambda
 *   dmu/d(attack_a)     = mu,      dmu/d(defence_h)     = -mu
 *
 * tau is 1 with zero derivatives outside the four low-score cells, so the
 * correction only contributes where it is actually defined.
 *
 * NOTE: `rates()` clamps lambda and mu into a sane range. A clamped rate has a
 * true derivative of zero, which this does not special-case -- on real football
 * scorelines the clamp never binds, and pretending otherwise would add a branch
 * to the hot loop for a case that does not occur.
 */
function gradient(
  v: number[],
  matches: SoccerMatch[],
  weights: number[],
  n: number,
  index: Map<string, number>,
  out: number[],
): void {
  out.fill(0);
  const rho = v[2 * n + 1];
  const advIdx = 2 * n;
  const rhoIdx = 2 * n + 1;

  for (let m = 0; m < matches.length; m++) {
    const match = matches[m];
    const hi = index.get(match.homeId);
    const ai = index.get(match.awayId);
    if (hi === undefined || ai === undefined) continue;

    const { lambda, mu } = rates(v, n, hi, ai);
    const x = match.homeGoals;
    const y = match.awayGoals;
    const w = weights[m];

    const t = tau(x, y, lambda, mu, rho);
    if (t <= 1e-10) continue;

    let dTauDLambda = 0;
    let dTauDMu = 0;
    let dTauDRho = 0;
    if (x === 0 && y === 0) {
      dTauDLambda = -mu * rho;
      dTauDMu = -lambda * rho;
      dTauDRho = -lambda * mu;
    } else if (x === 0 && y === 1) {
      dTauDLambda = rho;
      dTauDRho = lambda;
    } else if (x === 1 && y === 0) {
      dTauDMu = rho;
      dTauDRho = mu;
    } else if (x === 1 && y === 1) {
      dTauDRho = -1;
    }

    const invT = 1 / t;
    const dLambda = w * (invT * dTauDLambda + x / lambda - 1);
    const dMu = w * (invT * dTauDMu + y / mu - 1);

    // Chain through the exponential link.
    const gl = dLambda * lambda;
    const gm = dMu * mu;

    // Accumulate the NEGATIVE log-likelihood gradient, which is what Adam
    // descends.
    out[hi] -= gl;
    out[n + ai] += gl;
    out[advIdx] -= gl;
    out[ai] -= gm;
    out[n + hi] += gm;
    out[rhoIdx] -= w * invT * dTauDRho;
  }
}

/**
 * Fit by Adam on analytic gradients.
 *
 * A wrong gradient produces a model that converges confidently to the wrong
 * answer with no visible symptom, which is why the parameter-recovery test in
 * `models.test.ts` matters more than any other test here: it generates matches
 * from known attack/defence values and asserts the fit recovers them. That test
 * is what makes a hand-derived gradient safe to rely on.
 */
export function fitDixonColes(
  matches: SoccerMatch[],
  options: FitOptions = {},
): DixonColesParams {
  const {
    decayPerDay = 0.0065,
    maxIterations = 600,
    learningRate = 0.05,
    tolerance = 1e-7,
  } = options;

  if (matches.length === 0) throw new Error("Cannot fit Dixon-Coles with no matches");

  const teams = [...new Set(matches.flatMap((m) => [m.homeId, m.awayId]))].sort();
  if (teams.length < 2) throw new Error("Need at least 2 distinct teams to fit");

  const n = teams.length;
  const { values, index } = pack(teams);

  const asOf = options.asOf ?? new Date(Math.max(...matches.map((m) => m.date.getTime())));
  const weights = matches.map((m) => {
    const days = (asOf.getTime() - m.date.getTime()) / 86_400_000;
    return decayPerDay > 0 ? Math.exp(-decayPerDay * Math.max(0, days)) : 1;
  });

  const dim = values.length;
  const grad = new Array<number>(dim).fill(0);
  const mAdam = new Array<number>(dim).fill(0);
  const vAdam = new Array<number>(dim).fill(0);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;

  let prev = negLogLikelihood(values, matches, weights, n, index);
  let converged = false;
  let iter = 0;

  for (iter = 1; iter <= maxIterations; iter++) {
    gradient(values, matches, weights, n, index, grad);

    for (let i = 0; i < dim; i++) {
      mAdam[i] = beta1 * mAdam[i] + (1 - beta1) * grad[i];
      vAdam[i] = beta2 * vAdam[i] + (1 - beta2) * grad[i] * grad[i];
      const mHat = mAdam[i] / (1 - Math.pow(beta1, iter));
      const vHat = vAdam[i] / (1 - Math.pow(beta2, iter));
      values[i] -= (learningRate * mHat) / (Math.sqrt(vHat) + eps);
    }

    // Identifiability: attack parameters are only defined up to a constant, so
    // pin their mean to zero. Without this the optimiser drifts along a flat
    // ridge forever and the fitted values become uninterpretable.
    let attackMean = 0;
    for (let i = 0; i < n; i++) attackMean += values[i];
    attackMean /= n;
    for (let i = 0; i < n; i++) values[i] -= attackMean;

    // Keep rho inside the region where tau stays positive for realistic rates.
    values[2 * n + 1] = Math.min(Math.max(values[2 * n + 1], -0.35), 0.35);

    const current = negLogLikelihood(values, matches, weights, n, index);
    if (Math.abs(prev - current) < tolerance) {
      converged = true;
      prev = current;
      break;
    }
    prev = current;
  }

  const attack: Record<string, number> = {};
  const defence: Record<string, number> = {};
  teams.forEach((t, i) => {
    attack[t] = values[i];
    defence[t] = values[n + i];
  });

  return {
    teams,
    attack,
    defence,
    homeAdvantage: values[2 * n],
    rho: values[2 * n + 1],
    logLikelihood: -prev,
    iterations: iter,
    converged,
    matchCount: matches.length,
  };
}

export interface MatchPrediction {
  lambda: number;
  mu: number;
  /** scoreMatrix[h][a] = P(home scores h, away scores a). */
  scoreMatrix: number[][];
  home: number;
  draw: number;
  away: number;
  /** P(total goals > line) keyed by line, e.g. "2.5". */
  over: Record<string, number>;
  under: Record<string, number>;
  bothTeamsScore: number;
  /** Most likely exact scorelines, descending. */
  topScores: { home: number; away: number; probability: number }[];
  expectedGoals: { home: number; away: number; total: number };
}

/**
 * Predict a fixture from fitted parameters.
 *
 * Builds the full joint scoreline distribution once, then reads every market
 * off it. That is the point of a scoring model: 1X2, totals, BTTS and correct
 * score all come from the same coherent distribution rather than from four
 * separately-guessed numbers that may contradict each other.
 */
export function predictMatch(
  params: DixonColesParams,
  homeId: string,
  awayId: string,
  options: { neutralVenue?: boolean; lines?: number[] } = {},
): MatchPrediction {
  const { neutralVenue = false, lines = [0.5, 1.5, 2.5, 3.5, 4.5] } = options;

  const ah = params.attack[homeId];
  const dh = params.defence[homeId];
  const aa = params.attack[awayId];
  const da = params.defence[awayId];

  if (ah === undefined || aa === undefined) {
    throw new Error(
      `Unknown team in prediction: ${ah === undefined ? homeId : awayId}. ` +
        `The model was fitted on ${params.teams.length} teams and has never seen this one.`,
    );
  }

  const adv = neutralVenue ? 0 : params.homeAdvantage;
  const lambda = Math.exp(ah - da + adv);
  const mu = Math.exp(aa - dh);

  const matrix: number[][] = [];
  let totalMass = 0;
  for (let x = 0; x <= MAX_GOALS; x++) {
    matrix[x] = [];
    for (let y = 0; y <= MAX_GOALS; y++) {
      const p = tau(x, y, lambda, mu, params.rho) * poisson(x, lambda) * poisson(y, mu);
      matrix[x][y] = p;
      totalMass += p;
    }
  }
  // Truncating at MAX_GOALS loses a sliver of probability; renormalise so every
  // market read off the matrix sums correctly.
  for (let x = 0; x <= MAX_GOALS; x++) {
    for (let y = 0; y <= MAX_GOALS; y++) matrix[x][y] /= totalMass;
  }

  let home = 0;
  let draw = 0;
  let away = 0;
  let btts = 0;
  const overs: Record<string, number> = {};
  const unders: Record<string, number> = {};
  for (const line of lines) overs[String(line)] = 0;

  const scores: { home: number; away: number; probability: number }[] = [];

  for (let x = 0; x <= MAX_GOALS; x++) {
    for (let y = 0; y <= MAX_GOALS; y++) {
      const p = matrix[x][y];
      if (x > y) home += p;
      else if (x === y) draw += p;
      else away += p;
      if (x > 0 && y > 0) btts += p;
      for (const line of lines) {
        if (x + y > line) overs[String(line)] += p;
      }
      scores.push({ home: x, away: y, probability: p });
    }
  }

  for (const line of lines) unders[String(line)] = 1 - overs[String(line)];

  scores.sort((a, b) => b.probability - a.probability);

  return {
    lambda,
    mu,
    scoreMatrix: matrix,
    home,
    draw,
    away,
    over: overs,
    under: unders,
    bothTeamsScore: btts,
    topScores: scores.slice(0, 8),
    expectedGoals: { home: lambda, away: mu, total: lambda + mu },
  };
}

/** Team strength table for display, most dangerous attack first. */
export function strengthTable(
  params: DixonColesParams,
): { team: string; attack: number; defence: number; net: number }[] {
  return params.teams
    .map((t) => ({
      team: t,
      attack: params.attack[t],
      defence: params.defence[t],
      net: params.attack[t] + params.defence[t],
    }))
    .sort((a, b) => b.net - a.net);
}
