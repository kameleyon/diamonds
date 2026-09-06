import { describe, it, expect } from "vitest";
import {
  logLoss,
  brierScore,
  accuracy,
  calibration,
  calibrationError,
  skillScore,
  baseRateForecasts,
  type Forecast,
} from "./metrics";
import { backtestElo, backtestDixonColes } from "./backtest";
import { SPORTS } from "../sports/registry";
import type { StoredResult } from "../models/fit-from-scores";

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

describe("scoring rules", () => {
  it("scores a perfect forecast at zero log loss", () => {
    const f: Forecast[] = [{ probabilities: [1, 0, 0], outcome: 0 }];
    expect(logLoss(f)).toBeCloseTo(0, 10);
    expect(brierScore(f)).toBeCloseTo(0, 10);
    expect(accuracy(f)).toBe(1);
  });

  it("scores a uniform 3-way guess at ln(3)", () => {
    const third = 1 / 3;
    const f: Forecast[] = [{ probabilities: [third, third, third], outcome: 1 }];
    expect(logLoss(f)).toBeCloseTo(Math.log(3), 10);
  });

  it("bounds a confidently wrong forecast rather than returning Infinity", () => {
    const f: Forecast[] = [{ probabilities: [1, 0, 0], outcome: 2 }];
    expect(Number.isFinite(logLoss(f))).toBe(true);
    expect(logLoss(f)).toBeGreaterThan(30);
  });

  it("is a proper scoring rule: honesty beats shading", () => {
    // Truth is 60/40. Over many trials the honest forecast must score better
    // than either an overconfident or an underconfident one. This is the whole
    // reason log loss is the headline metric, so it is asserted directly.
    const rand = mulberry32(3);
    const honest: Forecast[] = [];
    const overconfident: Forecast[] = [];
    const underconfident: Forecast[] = [];

    for (let i = 0; i < 4000; i++) {
      const outcome = rand() < 0.6 ? 0 : 1;
      honest.push({ probabilities: [0.6, 0.4], outcome });
      overconfident.push({ probabilities: [0.9, 0.1], outcome });
      underconfident.push({ probabilities: [0.5, 0.5], outcome });
    }

    expect(logLoss(honest)).toBeLessThan(logLoss(overconfident));
    expect(logLoss(honest)).toBeLessThan(logLoss(underconfident));
  });

  it("builds base-rate forecasts from observed frequencies", () => {
    const f: Forecast[] = [
      { probabilities: [1, 0], outcome: 0 },
      { probabilities: [1, 0], outcome: 0 },
      { probabilities: [1, 0], outcome: 1 },
      { probabilities: [1, 0], outcome: 1 },
    ];
    const base = baseRateForecasts(f);
    expect(base[0].probabilities).toEqual([0.5, 0.5]);
  });

  it("reports positive skill only when the model beats the baseline", () => {
    expect(skillScore(0.9, 1.0)).toBeCloseTo(0.1, 10);
    expect(skillScore(1.0, 1.0)).toBeCloseTo(0, 10);
    expect(skillScore(1.1, 1.0)).toBeLessThan(0);
  });

  it("measures calibration and detects overconfidence", () => {
    const rand = mulberry32(9);
    // A model that says 90% but is right only 60% of the time.
    const bad: Forecast[] = [];
    for (let i = 0; i < 2000; i++) {
      bad.push({ probabilities: [0.9, 0.1], outcome: rand() < 0.6 ? 0 : 1 });
    }
    expect(calibrationError(bad)).toBeGreaterThan(0.2);

    // A model whose stated probability matches reality.
    const good: Forecast[] = [];
    for (let i = 0; i < 4000; i++) {
      good.push({ probabilities: [0.6, 0.4], outcome: rand() < 0.6 ? 0 : 1 });
    }
    expect(calibrationError(good)).toBeLessThan(0.03);
  });

  it("buckets every outcome of every forecast", () => {
    const f: Forecast[] = [{ probabilities: [0.5, 0.3, 0.2], outcome: 0 }];
    const total = calibration(f).reduce((a, b) => a + b.count, 0);
    expect(total).toBe(3);
  });
});

/** Build a synthetic league where the home side genuinely is stronger. */
function syntheticResults(seed: number, n: number, sportId: "nfl" | "soccer"): StoredResult[] {
  const rand = mulberry32(seed);
  const teams = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const strength: Record<string, number> = {
    A: 1.0, B: 0.85, C: 0.7, D: 0.55, E: 0.45, F: 0.35, G: 0.25, H: 0.15,
  };
  const out: StoredResult[] = [];
  const start = new Date("2025-01-01").getTime();

  for (let i = 0; i < n; i++) {
    const h = teams[Math.floor(rand() * teams.length)];
    let a = teams[Math.floor(rand() * teams.length)];
    while (a === h) a = teams[Math.floor(rand() * teams.length)];

    const pHome = strength[h] / (strength[h] + strength[a]);
    const homeWins = rand() < pHome;
    const margin = 1 + Math.floor(rand() * 3);

    out.push({
      id: `m${i}`,
      sportId,
      sportKey: sportId === "soccer" ? "football:EPL" : "american_football:NFL",
      homeTeam: h,
      awayTeam: a,
      homeScore: homeWins ? margin : 0,
      awayScore: homeWins ? 0 : margin,
      completedAt: new Date(start + i * 86_400_000).toISOString(),
    });
  }
  return out;
}

describe("walk-forward backtest", () => {
  it("finds skill in data that genuinely has structure", () => {
    const results = syntheticResults(11, 800, "nfl");
    const report = backtestElo(results, { ...SPORTS.nfl, eloK: 20 }, { warmup: 100 });

    expect(report.scored).toBeGreaterThan(600);
    expect(report.skill).toBeGreaterThan(0.05);
    expect(report.logLoss).toBeLessThan(report.baseline.logLoss);
    // The verdict has two "found skill" wordings depending on calibration, so
    // match the claim they share rather than one phrasing.
    expect(report.verdict).toMatch(/over base rate/);
  });

  it("finds NO skill in pure noise", () => {
    // Every result a coin flip: there is nothing to learn, and a backtest that
    // reports skill here would be leaking information from the future.
    const rand = mulberry32(5);
    const teams = ["A", "B", "C", "D", "E", "F"];
    const results: StoredResult[] = [];
    const start = new Date("2025-01-01").getTime();
    for (let i = 0; i < 900; i++) {
      const h = teams[Math.floor(rand() * teams.length)];
      let a = teams[Math.floor(rand() * teams.length)];
      while (a === h) a = teams[Math.floor(rand() * teams.length)];
      const homeWins = rand() < 0.5;
      results.push({
        id: `n${i}`,
        sportId: "nfl",
        sportKey: "american_football:NFL",
        homeTeam: h,
        awayTeam: a,
        homeScore: homeWins ? 1 : 0,
        awayScore: homeWins ? 0 : 1,
        completedAt: new Date(start + i * 86_400_000).toISOString(),
      });
    }

    const report = backtestElo(results, { ...SPORTS.nfl, eloK: 20, homeAdvantage: 0 }, { warmup: 100 });
    // Chasing noise should score no better than the base rate, and usually worse.
    expect(report.skill).toBeLessThan(0.02);
  });

  it("excludes the predicted match from its own training data", () => {
    // The leakage guard. If Dixon-Coles were fitted on data including the match
    // being predicted, log loss would collapse toward zero. A genuine
    // walk-forward score stays well above that.
    const results = syntheticResults(21, 400, "soccer");
    const report = backtestDixonColes(results, "EPL", { warmup: 120, refitEvery: 40 });

    expect(report.scored).toBeGreaterThan(150);
    expect(report.logLoss).toBeGreaterThan(0.2);
    expect(report.refits).toBeGreaterThan(1);
  });

  it("refuses to draw conclusions from a small sample", () => {
    const results = syntheticResults(7, 150, "nfl");
    const report = backtestElo(results, SPORTS.nfl, { warmup: 100 });
    expect(report.scored).toBeLessThan(100);
    expect(report.verdict).toMatch(/too few to conclude/);
  });

  it("skips draws in sports with no draw outcome instead of scoring them", () => {
    const results: StoredResult[] = [];
    const start = new Date("2025-01-01").getTime();
    for (let i = 0; i < 300; i++) {
      results.push({
        id: `d${i}`,
        sportId: "nfl",
        sportKey: "american_football:NFL",
        homeTeam: i % 2 ? "A" : "B",
        awayTeam: i % 2 ? "B" : "A",
        // Every game a tie, which the two-way forecast cannot represent.
        homeScore: 3,
        awayScore: 3,
        completedAt: new Date(start + i * 86_400_000).toISOString(),
      });
    }
    const report = backtestElo(results, SPORTS.nfl, { warmup: 10 });
    expect(report.scored).toBe(0);
    expect(report.skipped).toBeGreaterThan(0);
  });
});
