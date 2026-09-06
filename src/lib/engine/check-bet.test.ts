import { describe, it, expect } from "vitest";
import { parseBetSlip } from "../parse/bet-slip";
import { nameMatches, findMatch, checkAgainstMarket, checkSettled, noMatch } from "./check-bet";
import { scanEvents, DEFAULT_ENGINE_CONFIG } from "./edge";
import { DEMO_EVENTS } from "../fixtures/demo-slate";

const opps = scanEvents(DEMO_EVENTS, { ...DEFAULT_ENGINE_CONFIG, minEv: -1 });

describe("name matching", () => {
  it("matches a short name against a full one", () => {
    expect(nameMatches("Chiefs", "Kansas City Chiefs")).toBe(true);
    expect(nameMatches("Kansas City Chiefs", "Chiefs")).toBe(true);
  });
  it("does not match unrelated teams", () => {
    expect(nameMatches("Chiefs", "Buffalo Bills")).toBe(false);
    expect(nameMatches("", "Kansas City Chiefs")).toBe(false);
  });
});

describe("checking a bet", () => {
  it("judges the user's OWN price when one is given", () => {
    // The core of the feature: the same selection is a take at the best price
    // and a pass at a worse one. Judging the best price when the user told us
    // theirs would answer a question they did not ask.
    const best = checkAgainstMarket(parseBetSlip("Kansas City Chiefs ML 1u"), findMatch(parseBetSlip("Kansas City Chiefs ML 1u"), opps)!);
    const theirs = checkAgainstMarket(parseBetSlip("Chiefs ML -130 1u"), findMatch(parseBetSlip("Chiefs ML -130 1u"), opps)!);

    expect(best.verdict).toBe("take");
    expect(theirs.verdict).toBe("pass");
    expect(theirs.ev!).toBeLessThan(best.ev!);
    expect(theirs.reasoning.join(" ")).toMatch(/your price/i);
  });

  it("points at a better price elsewhere when there is one", () => {
    const p = parseBetSlip("Chiefs ML -130");
    const c = checkAgainstMarket(p, findMatch(p, opps)!);
    expect(c.reasoning.join(" ")).toMatch(/offering .* on the same side/i);
  });

  it("matches a total only at the same line", () => {
    expect(findMatch(parseBetSlip("Under 8.5 Dodgers"), opps)).toBeDefined();
    // A different line is a different bet and must not silently match.
    expect(findMatch(parseBetSlip("Under 9.5 Dodgers"), opps)).toBeUndefined();
  });

  it("admits when it cannot price a bet", () => {
    const p = parseBetSlip("Barcelona ML");
    expect(findMatch(p, opps)).toBeUndefined();
    const c = noMatch(p, opps.length);
    expect(c.verdict).toBe("unknown");
    expect(c.headline).toMatch(/Could not price/);
  });

  it("settles a total correctly", () => {
    const r = { homeTeam: "Dodgers", awayTeam: "Padres", homeScore: 6, awayScore: 4 };
    expect(checkSettled(parseBetSlip("Over 8.5 Dodgers"), r).settled!.won).toBe(true);
    expect(checkSettled(parseBetSlip("Under 8.5 Dodgers"), r).settled!.won).toBe(false);
  });

  it("settles a moneyline correctly for either side", () => {
    const r = { homeTeam: "Dodgers", awayTeam: "Padres", homeScore: 6, awayScore: 4 };
    expect(checkSettled(parseBetSlip("Dodgers ML"), r).settled!.won).toBe(true);
    expect(checkSettled(parseBetSlip("Padres ML"), r).settled!.won).toBe(false);
  });

  it("refuses to say a settled bet was GOOD without the information to know", () => {
    // Judging a past bet against today's market is lookahead: it uses
    // information that did not exist when the bet was placed.
    const r = { homeTeam: "Dodgers", awayTeam: "Padres", homeScore: 6, awayScore: 4 };
    const c = checkSettled(parseBetSlip("Dodgers ML -110"), r);
    expect(c.settled!.won).toBe(true);
    expect(c.settled!.wasGoodBet).toBeNull();
    // It must explain WHY it cannot answer, not merely decline to.
    expect(c.reasoning.join(" ")).toMatch(/before kickoff|historical closing lines/i);
  });
});
