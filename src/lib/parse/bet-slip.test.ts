import { describe, it, expect } from "vitest";
import { parseBetSlip, describeParsedBet } from "./bet-slip";

describe("bet slip parser", () => {
  it("parses the canonical example", () => {
    const b = parseBetSlip("Alabama o3.5 1U");
    expect(b.subject).toBe("Alabama");
    expect(b.market).toBe("total");
    expect(b.side).toBe("over");
    expect(b.line).toBe(3.5);
    expect(b.stakeUnits).toBe(1);
  });

  it("parses a moneyline with units", () => {
    const b = parseBetSlip("Chiefs ML 2u");
    expect(b.subject).toBe("Chiefs");
    expect(b.market).toBe("moneyline");
    expect(b.stakeUnits).toBe(2);
    expect(b.confidence).toBe("high");
  });

  it("parses a total written before the team", () => {
    const b = parseBetSlip("Under 8.5 Dodgers");
    expect(b.market).toBe("total");
    expect(b.side).toBe("under");
    expect(b.line).toBe(8.5);
    expect(b.subject).toBe("Dodgers");
  });

  it("parses a spread with a fractional stake", () => {
    const b = parseBetSlip("Rams -3.5 0.5u");
    expect(b.subject).toBe("Rams");
    expect(b.market).toBe("spread");
    expect(b.line).toBe(-3.5);
    expect(b.stakeUnits).toBe(0.5);
  });

  it("tells a price from a handicap", () => {
    // The ambiguity that matters: -110 is a price, -3.5 is a line. Magnitude
    // and whole-ness are what separate them.
    const b = parseBetSlip("Lakers +6.5 -110 1u");
    expect(b.line).toBe(6.5);
    expect(b.price).toBeCloseTo(1.909, 2);
    expect(b.stakeUnits).toBe(1);
  });

  it("reads American underdog prices", () => {
    const b = parseBetSlip("Chiefs ML +150");
    expect(b.price).toBeCloseTo(2.5, 6);
    expect(b.market).toBe("moneyline");
  });

  it("accepts a currency stake", () => {
    const b = parseBetSlip("Chiefs ML $50");
    expect(b.stakeAmount).toBe(50);
    expect(b.stakeUnits).toBeUndefined();
  });

  it("handles glued tokens and mixed case", () => {
    expect(parseBetSlip("ALABAMA O3.5 1U").line).toBe(3.5);
    expect(parseBetSlip("alabama over 3.5").side).toBe("over");
  });

  it("FLAGS the team-total vs game-total ambiguity rather than hiding it", () => {
    // The single most consequential guess this parser makes. Silently choosing
    // one and pricing it confidently would be worse than saying which it took.
    const b = parseBetSlip("Alabama o3.5 1U");
    expect(b.ambiguities.join(" ")).toMatch(/own total or the whole game/i);
  });

  it("flags an unnamed market instead of assuming silently", () => {
    const b = parseBetSlip("Chiefs 2u");
    expect(b.market).toBe("moneyline");
    expect(b.ambiguities.join(" ")).toMatch(/No market named/);
    expect(b.confidence).not.toBe("high");
  });

  it("reports low confidence when it cannot find a bet", () => {
    const b = parseBetSlip("hello there");
    expect(b.confidence).toBe("low");
    expect(describeParsedBet(b)).toMatch(/Could not read/);
  });

  it("returns a safe result for empty input", () => {
    const b = parseBetSlip("   ");
    expect(b.market).toBe("unknown");
    expect(b.confidence).toBe("low");
    expect(b.ambiguities).toEqual([]);
  });

  it("restates the bet in plain English", () => {
    expect(describeParsedBet(parseBetSlip("Alabama o3.5 1U"))).toBe(
      "Alabama · team total Over 3.5 · 1 unit",
    );
    expect(describeParsedBet(parseBetSlip("Chiefs ML 2u"))).toBe("Chiefs to win · 2 units");
    expect(describeParsedBet(parseBetSlip("Rams -3.5"))).toBe("Rams -3.5");
  });

  it("keeps the raw string verbatim for display", () => {
    const b = parseBetSlip("  Alabama o3.5 1U  ");
    expect(b.raw).toBe("Alabama o3.5 1U");
  });
});
