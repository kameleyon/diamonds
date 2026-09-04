import { describe, it, expect } from "vitest";
import {
  americanToDecimal,
  decimalToAmerican,
  fractionalToDecimal,
  impliedProbability,
  probabilityToDecimal,
} from "./format";
import { devig, devigAll, worstCaseFair } from "./devig";
import {
  expectedValue,
  kellyFraction,
  recommendedStake,
  blendProbability,
  breakEvenRate,
  DEFAULT_STAKE_CONFIG,
} from "./ev";
import { analyzeParlay, correlatedTwoLegProbability } from "./parlay";
import { closingLineValue, summarizeClv } from "./clv";

describe("odds format conversion", () => {
  it("converts American to decimal", () => {
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 10);
    expect(americanToDecimal(-200)).toBeCloseTo(1.5, 10);
    expect(americanToDecimal(100)).toBeCloseTo(2.0, 10);
    expect(americanToDecimal(-110)).toBeCloseTo(1.9090909, 6);
  });

  it("rejects American odds inside the undefined band", () => {
    expect(() => americanToDecimal(50)).toThrow();
    expect(() => americanToDecimal(0)).toThrow();
  });

  it("round-trips decimal to American and back", () => {
    for (const a of [-500, -250, -110, 100, 150, 400, 1200]) {
      expect(decimalToAmerican(americanToDecimal(a))).toBe(a);
    }
  });

  it("parses fractional odds", () => {
    expect(fractionalToDecimal("5/2")).toBeCloseTo(3.5, 10);
    expect(fractionalToDecimal("evens")).toBeCloseTo(2.0, 10);
    expect(fractionalToDecimal("1/4")).toBeCloseTo(1.25, 10);
  });

  it("round-trips probability and decimal price", () => {
    expect(impliedProbability(4.0)).toBeCloseTo(0.25, 10);
    expect(probabilityToDecimal(0.25)).toBeCloseTo(4.0, 10);
  });
});

describe("devig", () => {
  // A standard -110/-110 two-way market: 4.76% overround, perfectly symmetric.
  const symmetric = [americanToDecimal(-110), americanToDecimal(-110)];

  it("reports the correct overround and hold", () => {
    const r = devig(symmetric, "multiplicative");
    expect(r.overround).toBeCloseTo(0.047619, 5);
    expect(r.hold).toBeCloseTo(0.045454, 5);
  });

  it("returns exactly 50/50 on a symmetric market under every method", () => {
    for (const r of Object.values(devigAll(symmetric))) {
      expect(r.fair[0]).toBeCloseTo(0.5, 8);
      expect(r.fair[1]).toBeCloseTo(0.5, 8);
    }
  });

  it("produces fair probabilities that sum to 1 for every method", () => {
    const markets = [
      symmetric,
      [1.3333, 3.5], // heavy favourite
      [2.1, 3.4, 3.6], // soccer 1X2
      [1.05, 15.0], // extreme favourite
      [4.5, 4.2, 4.8, 4.6], // four-way
    ];
    for (const market of markets) {
      for (const [name, r] of Object.entries(devigAll(market))) {
        const sum = r.fair.reduce((a, b) => a + b, 0);
        expect(sum, `${name} on ${JSON.stringify(market)}`).toBeCloseTo(1, 9);
      }
    }
  });

  it("solvers converge on realistic markets", () => {
    const r = devigAll([2.1, 3.4, 3.6]);
    expect(r.power.converged).toBe(true);
    expect(r.shin.converged).toBe(true);
    expect(r.power.params.k).toBeGreaterThan(1);
    expect(r.shin.params.z).toBeGreaterThan(0);
  });

  it("corrects favourite-longshot bias in the right direction", () => {
    // On a lopsided market, power and Shin should assign the favourite a HIGHER
    // fair probability than naive multiplicative -- because they shrink the
    // longshot's inflated price more aggressively. Getting this backwards is the
    // classic silent bug, so it is asserted explicitly.
    const market = [1.3333, 3.5];
    const all = devigAll(market);
    expect(all.power.fair[0]).toBeGreaterThan(all.multiplicative.fair[0]);
    expect(all.shin.fair[0]).toBeGreaterThan(all.multiplicative.fair[0]);
    // ...and correspondingly a lower probability for the longshot.
    expect(all.power.fair[1]).toBeLessThan(all.multiplicative.fair[1]);
  });

  it("matches a hand-computed power solution", () => {
    // 0.75^k + 0.2857^k = 1 solves near k = 1.063, giving the favourite ~0.7365.
    const r = devig([1 / 0.75, 1 / 0.2857], "power");
    expect(r.params.k).toBeCloseTo(1.063, 2);
    expect(r.fair[0]).toBeCloseTo(0.7365, 3);
  });

  it("normalises rather than solving when there is no margin", () => {
    // Cross-book arbitrage: implied probabilities sum below 1.
    const r = devig([2.2, 2.2]);
    expect(r.overround).toBeLessThan(0);
    expect(r.fair[0]).toBeCloseTo(0.5, 10);
    expect(r.converged).toBe(true);
  });

  it("flags additive as non-converged when it would go negative", () => {
    // A 9-runner outright market with a ~21% overround, the shape where additive
    // actually breaks: spreading 21 points of margin across 9 outcomes charges
    // each one 2.3pp, which is more than the 100-1 shot's entire 1% implied
    // probability. Two-way markets almost never trigger this; outrights do.
    const outright = [2.0, 10, 10, 10, 10, 10, 10, 10, 100];
    const r = devig(outright, "additive");
    expect(r.overround).toBeGreaterThan(0.2);
    expect(r.converged).toBe(false);
    expect(Math.min(...r.fair)).toBeGreaterThan(0);
    expect(r.fair.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("worstCaseFair is the most conservative estimate available", () => {
    const market = [1.3333, 3.5];
    const wc = worstCaseFair(market, 0);
    const all = Object.values(devigAll(market)).map((r) => r.fair[0]);
    expect(wc).toBe(Math.max(...all));
  });

  it("rejects malformed markets", () => {
    expect(() => devig([2.0])).toThrow(/at least 2/);
    expect(() => devig([2.0, 0.5])).toThrow(/Invalid decimal/);
  });
});

describe("expected value and staking", () => {
  it("computes EV as p*d - 1", () => {
    expect(expectedValue(0.55, 2.0)).toBeCloseTo(0.1, 10);
    expect(expectedValue(0.5, 1.9091)).toBeCloseTo(-0.04545, 4);
  });

  it("computes full Kelly", () => {
    // p=0.55 at even money: f* = (0.55*2 - 1) / 1 = 0.10
    expect(kellyFraction(0.55, 2.0)).toBeCloseTo(0.1, 10);
    // Negative edge must floor at zero, never suggest a negative stake.
    expect(kellyFraction(0.45, 2.0)).toBe(0);
  });

  it("applies fractional Kelly and the hard cap", () => {
    // Full Kelly 0.10 -> quarter Kelly 0.025 -> capped at 0.02.
    const r = recommendedStake(0.55, 2.0, 10_000);
    expect(r.fullKelly).toBeCloseTo(0.1, 10);
    expect(r.fraction).toBeCloseTo(0.02, 10);
    expect(r.amount).toBeCloseTo(200, 6);
    expect(r.limitedBy).toBe("max-stake-cap");
  });

  it("refuses bets below the minimum edge", () => {
    const r = recommendedStake(0.505, 2.0, 10_000);
    expect(r.ev).toBeCloseTo(0.01, 10);
    expect(r.fraction).toBe(0);
    expect(r.limitedBy).toBe("below-min-edge");
  });

  it("refuses negative-EV bets outright", () => {
    const r = recommendedStake(0.45, 2.0, 10_000);
    expect(r.fraction).toBe(0);
    expect(r.limitedBy).toBe("negative-ev");
  });

  it("stakes below the cap when the edge is small but sufficient", () => {
    // EV 0.03 at d=3.0 -> full Kelly 0.015 -> quarter Kelly 0.00375, under cap.
    const r = recommendedStake(0.3433, 3.0, 10_000, {
      ...DEFAULT_STAKE_CONFIG,
      minEdge: 0.02,
    });
    expect(r.limitedBy).toBe("none");
    expect(r.fraction).toBeLessThan(DEFAULT_STAKE_CONFIG.maxStakeFraction);
    expect(r.fraction).toBeGreaterThan(0);
  });

  it("blends model and market probabilities", () => {
    expect(blendProbability(0.6, 0.5, 0.3)).toBeCloseTo(0.53, 10);
    expect(blendProbability(0.6, 0.5, 0)).toBeCloseTo(0.5, 10);
    expect(blendProbability(0.6, 0.5, 1)).toBeCloseTo(0.6, 10);
  });

  it("computes break-even rate", () => {
    expect(breakEvenRate(2.0)).toBeCloseTo(0.5, 10);
    expect(breakEvenRate(americanToDecimal(-110))).toBeCloseTo(0.5238, 4);
  });
});

describe("parlays", () => {
  it("compounds EV multiplicatively across independent legs", () => {
    // Two legs each at +5% EV must compound to (1.05)^2 - 1 = 0.1025.
    const legs = [
      { id: "a", label: "A", probability: 0.5, decimalOdds: 2.1 },
      { id: "b", label: "B", probability: 0.5, decimalOdds: 2.1 },
    ];
    const r = analyzeParlay(legs);
    expect(r.combinedOdds).toBeCloseTo(4.41, 10);
    expect(r.combinedProbability).toBeCloseTo(0.25, 10);
    expect(r.ev).toBeCloseTo(1.05 * 1.05 - 1, 10);
    expect(r.allLegsPositive).toBe(true);
  });

  it("compounds the house edge on negative-EV legs", () => {
    // Two standard -110 coin flips: each -4.5% EV, compounding to about -8.9%.
    const d = americanToDecimal(-110);
    const legs = [
      { id: "a", label: "A", probability: 0.5, decimalOdds: d },
      { id: "b", label: "B", probability: 0.5, decimalOdds: d },
    ];
    const r = analyzeParlay(legs);
    expect(r.ev).toBeLessThan(-0.08);
    expect(r.allLegsPositive).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/Negative-EV leg/);
  });

  it("requires at least two legs", () => {
    expect(() =>
      analyzeParlay([{ id: "a", label: "A", probability: 0.5, decimalOdds: 2 }]),
    ).toThrow(/at least 2 legs/);
  });

  it("respects Fréchet bounds on correlated legs", () => {
    // Perfect positive correlation cannot push the joint above either marginal.
    expect(correlatedTwoLegProbability(0.6, 0.4, 1)).toBeLessThanOrEqual(0.4);
    // Perfect negative correlation cannot fall below the forced overlap.
    expect(correlatedTwoLegProbability(0.8, 0.7, -1)).toBeGreaterThanOrEqual(0.5 - 1e-9);
    // Zero correlation reduces to the plain product.
    expect(correlatedTwoLegProbability(0.6, 0.4, 0)).toBeCloseTo(0.24, 10);
  });
});

describe("closing line value", () => {
  it("detects beating the close", () => {
    const r = closingLineValue({ betOdds: 2.1, closingOdds: 2.0 });
    expect(r.beatClose).toBe(true);
    expect(r.clvPercent).toBeCloseTo(0.05, 10);
  });

  it("measures EV against the devigged closing market", () => {
    // Bet 2.10, market closed 1.95/1.95 -> fair 50%, so EV = 0.5*2.1 - 1 = 0.05.
    const r = closingLineValue({
      betOdds: 2.1,
      closingOdds: 1.95,
      closingMarket: [1.95, 1.95],
      outcomeIndex: 0,
    });
    expect(r.closingFairProbability).toBeCloseTo(0.5, 8);
    expect(r.evVsClose).toBeCloseTo(0.05, 8);
  });

  it("refuses to read a small sample", () => {
    const results = Array.from({ length: 10 }, () =>
      closingLineValue({ betOdds: 2.1, closingOdds: 2.0 }),
    );
    const s = summarizeClv(results);
    expect(s.beatCloseRate).toBe(1);
    expect(s.verdict).toMatch(/far too few/);
  });

  it("identifies a real edge over a large positive sample", () => {
    const results = Array.from({ length: 200 }, (_, i) =>
      closingLineValue({ betOdds: 2.05 + (i % 5) * 0.01, closingOdds: 2.0 }),
    );
    const s = summarizeClv(results);
    expect(s.averageClvPercent).toBeGreaterThan(0);
    expect(s.tStatistic).toBeGreaterThan(2);
    expect(s.verdict).toMatch(/signature of a real edge/);
  });

  it("calls out negative CLV regardless of profit", () => {
    const results = Array.from({ length: 100 }, (_, i) =>
      closingLineValue({ betOdds: 1.9 + (i % 3) * 0.01, closingOdds: 2.0 }),
    );
    const s = summarizeClv(results);
    expect(s.averageClvPercent).toBeLessThan(0);
    expect(s.verdict).toMatch(/Negative CLV/);
  });

  it("handles an empty history", () => {
    expect(summarizeClv([]).verdict).toMatch(/No closing prices recorded/);
  });
});
