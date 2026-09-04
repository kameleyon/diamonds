import { describe, it, expect } from "vitest";
import { EloModel, marginMultiplier, twoWayToThreeWay, DEFAULT_RATING } from "./elo";
import { fitDixonColes, predictMatch, tau, type SoccerMatch } from "./dixon-coles";
import { SPORTS } from "../sports/registry";

/** Deterministic RNG so these tests never flake. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth's Poisson sampler; fine for the small rates football produces. */
function samplePoisson(lambda: number, rand: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}

describe("Elo", () => {
  const nfl = SPORTS.nfl;

  it("starts every competitor at the default rating", () => {
    const m = new EloModel(nfl);
    expect(m.get("KC").rating).toBe(DEFAULT_RATING);
    expect(m.get("KC").games).toBe(0);
  });

  it("gives the home side more than 50% between equal teams", () => {
    const m = new EloModel(nfl);
    const p = m.expectedScore("KC", "BUF");
    expect(p).toBeGreaterThan(0.5);
    // 55 Elo points of home edge is worth roughly 4-5 percentage points.
    expect(p).toBeCloseTo(0.578, 2);
  });

  it("removes home advantage at a neutral venue", () => {
    const m = new EloModel(nfl);
    expect(m.expectedScore("KC", "BUF", true)).toBeCloseTo(0.5, 10);
  });

  it("honours the 400-point 10:1 convention", () => {
    const m = new EloModel(SPORTS.tennis); // no home advantage to muddy it
    m.load([
      { competitorId: "A", rating: 1900, games: 50, updatedAt: new Date() },
      { competitorId: "B", rating: 1500, games: 50, updatedAt: new Date() },
    ]);
    expect(m.expectedScore("A", "B")).toBeCloseTo(10 / 11, 4);
  });

  it("moves ratings toward the winner and conserves total rating", () => {
    const m = new EloModel(nfl);
    const before = m.get("A").rating + m.get("B").rating;
    const { delta } = m.update({
      homeId: "A",
      awayId: "B",
      homeScore: 1,
      date: new Date(),
    });
    expect(delta).toBeGreaterThan(0);
    expect(m.get("A").rating).toBeGreaterThan(DEFAULT_RATING);
    expect(m.get("B").rating).toBeLessThan(DEFAULT_RATING);
    // Elo is zero-sum: what the winner gains, the loser loses.
    expect(m.get("A").rating + m.get("B").rating).toBeCloseTo(before, 10);
  });

  it("moves ratings further on a bigger surprise", () => {
    const strong = new EloModel(SPORTS.tennis);
    strong.load([
      { competitorId: "Fav", rating: 1900, games: 50, updatedAt: new Date() },
      { competitorId: "Dog", rating: 1500, games: 50, updatedAt: new Date() },
    ]);
    // Underdog wins: a big surprise, so a big move.
    const upset = strong.update({ homeId: "Dog", awayId: "Fav", homeScore: 1, date: new Date() });

    const even = new EloModel(SPORTS.tennis);
    const expected = even.update({ homeId: "A", awayId: "B", homeScore: 1, date: new Date() });

    expect(Math.abs(upset.delta)).toBeGreaterThan(Math.abs(expected.delta));
  });

  it("scales K by margin of victory and damps favourite blowouts", () => {
    // A bigger win is worth more...
    expect(marginMultiplier(21, 0)).toBeGreaterThan(marginMultiplier(3, 0));
    // ...but with diminishing returns, not linearly.
    const three = marginMultiplier(3, 0);
    expect(marginMultiplier(30, 0)).toBeLessThan(three * 10);
    // An underdog winning by 10 counts for more than a favourite doing the same.
    expect(marginMultiplier(10, -200)).toBeGreaterThan(marginMultiplier(10, 200));
  });

  it("regresses toward the mean between seasons", () => {
    const m = new EloModel(nfl);
    m.load([{ competitorId: "A", rating: 1700, games: 17, updatedAt: new Date() }]);
    m.regressToMean(0.25);
    expect(m.get("A").rating).toBeCloseTo(1650, 10);
  });

  it("recovers true strength ordering from simulated results", () => {
    const rand = mulberry32(7);
    const teams = ["A", "B", "C", "D", "E", "F"];
    // True Bradley-Terry strengths: A strongest, F weakest.
    const truth: Record<string, number> = { A: 0.9, B: 0.7, C: 0.55, D: 0.45, E: 0.3, F: 0.1 };

    // A deliberately low K. Elo ratings never converge to a point -- they
    // random-walk around the truth with an amplitude proportional to K. At the
    // registry's K=24 that noise is roughly the same size as the true A-to-C
    // gap (~85 Elo points), so a snapshot of the final ranking would be
    // testing noise rather than the model. Low K trades adaptation speed for
    // stable estimates, which is what a recovery test needs.
    const quiet = { ...SPORTS.tennis, eloK: 8, homeAdvantage: 0 };

    const m = new EloModel(quiet);
    for (let round = 0; round < 40; round++) {
      for (let i = 0; i < teams.length; i++) {
        for (let j = 0; j < teams.length; j++) {
          if (i === j) continue;
          const pHome = truth[teams[i]] / (truth[teams[i]] + truth[teams[j]]);
          m.update({
            homeId: teams[i],
            awayId: teams[j],
            homeScore: rand() < pHome ? 1 : 0,
            date: new Date(),
          });
        }
      }
    }

    // Rank correlation against truth is the robust assertion; individual
    // adjacent pairs can and will swap.
    const ranked = m.all().map((r) => r.competitorId);
    const trueRank = [...teams].sort((a, b) => truth[b] - truth[a]);
    const rho = spearman(
      ranked.map((t) => trueRank.indexOf(t)),
      ranked.map((_, i) => i),
    );
    expect(rho).toBeGreaterThan(0.85);

    // The extremes are far enough apart to assert directly.
    expect(m.get("A").rating).toBeGreaterThan(m.get("F").rating + 200);
    expect(ranked.slice(0, 2)).toContain("A");
    expect(ranked.slice(-2)).toContain("F");
  });

  it("splits a two-way probability into 1X2 with draws likeliest when even", () => {
    const even = twoWayToThreeWay(0.5, 0.25);
    const lopsided = twoWayToThreeWay(0.9, 0.25);
    expect(even.home + even.draw + even.away).toBeCloseTo(1, 10);
    expect(lopsided.home + lopsided.draw + lopsided.away).toBeCloseTo(1, 10);
    expect(even.draw).toBeGreaterThan(lopsided.draw);
    expect(even.home).toBeCloseTo(even.away, 10);
  });
});

describe("Dixon-Coles", () => {
  it("applies tau only to the four low-score cells", () => {
    const [l, m, rho] = [1.4, 1.1, -0.1];
    expect(tau(0, 0, l, m, rho)).toBeCloseTo(1 - l * m * rho, 10);
    expect(tau(0, 1, l, m, rho)).toBeCloseTo(1 + l * rho, 10);
    expect(tau(1, 0, l, m, rho)).toBeCloseTo(1 + m * rho, 10);
    expect(tau(1, 1, l, m, rho)).toBeCloseTo(1 - rho, 10);
    // Everything else is untouched independent Poisson.
    expect(tau(2, 1, l, m, rho)).toBe(1);
    expect(tau(3, 4, l, m, rho)).toBe(1);
  });

  it("with negative rho, raises 0-0 and 1-1 above independent Poisson", () => {
    // This is the entire reason the model exists, so assert it directly.
    const l = 1.3;
    const m = 1.1;
    const rho = -0.1;
    expect(tau(0, 0, l, m, rho)).toBeGreaterThan(1);
    expect(tau(1, 1, l, m, rho)).toBeGreaterThan(1);
    // ...while shading 1-0 and 0-1 down to keep the mass balanced.
    expect(tau(1, 0, l, m, rho)).toBeLessThan(1);
    expect(tau(0, 1, l, m, rho)).toBeLessThan(1);
  });

  const buildLeague = (seed: number) => {
    const rand = mulberry32(seed);
    const teams = ["Ars", "Bou", "Che", "Eve", "Ful", "Liv", "MCI", "New", "Tot", "Whu"];
    // Known ground truth the fit must recover.
    const trueAttack: Record<string, number> = {
      MCI: 0.55, Liv: 0.42, Ars: 0.35, Tot: 0.15, Che: 0.05,
      New: -0.05, Whu: -0.18, Ful: -0.28, Bou: -0.45, Eve: -0.56,
    };
    const trueDefence: Record<string, number> = {
      MCI: 0.45, Ars: 0.38, Liv: 0.25, New: 0.12, Che: 0.02,
      Tot: -0.08, Ful: -0.15, Whu: -0.25, Bou: -0.35, Eve: -0.39,
    };
    const trueHomeAdv = 0.28;

    const matches: SoccerMatch[] = [];
    const start = new Date("2025-08-01").getTime();
    let day = 0;
    // Four round-robins gives ~360 matches, a realistic multi-season sample.
    for (let rr = 0; rr < 4; rr++) {
      for (const h of teams) {
        for (const a of teams) {
          if (h === a) continue;
          const lambda = Math.exp(trueAttack[h] - trueDefence[a] + trueHomeAdv);
          const mu = Math.exp(trueAttack[a] - trueDefence[h]);
          matches.push({
            homeId: h,
            awayId: a,
            homeGoals: samplePoisson(lambda, rand),
            awayGoals: samplePoisson(mu, rand),
            date: new Date(start + day++ * 86_400_000),
          });
        }
      }
    }
    return { matches, trueAttack, trueDefence, trueHomeAdv, teams };
  };

  it("recovers known parameters from simulated data", () => {
    const { matches, trueAttack, trueHomeAdv, teams } = buildLeague(42);

    // No time decay: the data-generating process is stationary here, so
    // down-weighting old matches would only discard information.
    const fitted = fitDixonColes(matches, { decayPerDay: 0, maxIterations: 800 });

    expect(fitted.matchCount).toBe(matches.length);
    expect(fitted.teams).toHaveLength(teams.length);

    // Home advantage should land close to truth.
    expect(fitted.homeAdvantage).toBeCloseTo(trueHomeAdv, 1);

    // Attack parameters are identified only up to an additive constant, so
    // compare the recovered ORDERING and the correlation, not raw values.
    const ranked = [...teams].sort((a, b) => fitted.attack[b] - fitted.attack[a]);
    expect(ranked[0]).toBe("MCI");
    expect(ranked[ranked.length - 1]).toBe("Eve");

    const xs = teams.map((t) => trueAttack[t]);
    const ys = teams.map((t) => fitted.attack[t]);
    expect(pearson(xs, ys)).toBeGreaterThan(0.9);
  });

  it("produces a coherent probability distribution over scorelines", () => {
    const { matches } = buildLeague(11);
    const fitted = fitDixonColes(matches, { decayPerDay: 0, maxIterations: 400 });
    const p = predictMatch(fitted, "MCI", "Eve");

    // Every market is read off one joint distribution, so they must cohere.
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 8);
    const total = p.scoreMatrix.flat().reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 8);
    for (const line of ["0.5", "1.5", "2.5", "3.5", "4.5"]) {
      expect(p.over[line] + p.under[line]).toBeCloseTo(1, 8);
    }
    // Over 0.5 must be at least as likely as over 4.5 -- monotonic in the line.
    expect(p.over["0.5"]).toBeGreaterThan(p.over["4.5"]);

    // A strong home side against a weak away side should be a clear favourite.
    expect(p.home).toBeGreaterThan(p.away);
    expect(p.expectedGoals.home).toBeGreaterThan(p.expectedGoals.away);
    expect(p.topScores[0].probability).toBeGreaterThan(0);
  });

  it("drops home advantage at a neutral venue", () => {
    const { matches } = buildLeague(3);
    const fitted = fitDixonColes(matches, { decayPerDay: 0, maxIterations: 300 });
    const normal = predictMatch(fitted, "Ars", "Tot");
    const neutral = predictMatch(fitted, "Ars", "Tot", { neutralVenue: true });
    expect(neutral.home).toBeLessThan(normal.home);
    expect(neutral.lambda).toBeLessThan(normal.lambda);
  });

  it("weights recent matches more heavily when decay is on", () => {
    // A team that was dreadful long ago and excellent recently should be rated
    // better with decay on than with decay off.
    const teams = ["X", "Y"];
    const matches: SoccerMatch[] = [];
    const start = new Date("2024-01-01").getTime();
    for (let i = 0; i < 60; i++) {
      matches.push({ homeId: "X", awayId: "Y", homeGoals: 0, awayGoals: 3, date: new Date(start + i * 86_400_000) });
    }
    for (let i = 60; i < 120; i++) {
      matches.push({ homeId: "X", awayId: "Y", homeGoals: 3, awayGoals: 0, date: new Date(start + i * 86_400_000) });
    }
    const flat = fitDixonColes(matches, { decayPerDay: 0, maxIterations: 300 });
    const decayed = fitDixonColes(matches, { decayPerDay: 0.02, maxIterations: 300 });
    expect(decayed.attack["X"]).toBeGreaterThan(flat.attack["X"]);
    expect(teams).toHaveLength(2);
  });

  it("refuses to predict a team it has never seen", () => {
    const { matches } = buildLeague(5);
    const fitted = fitDixonColes(matches, { decayPerDay: 0, maxIterations: 100 });
    expect(() => predictMatch(fitted, "MCI", "Barcelona")).toThrow(/never seen/);
  });

  it("rejects an empty dataset", () => {
    expect(() => fitDixonColes([])).toThrow(/no matches/);
  });
});

/** Spearman is Pearson on ranks; both inputs here are already ranks. */
function spearman(xs: number[], ys: number[]): number {
  return pearson(xs, ys);
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
