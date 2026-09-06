import { describe, it, expect } from "vitest";
import { findOpportunities, DEFAULT_ENGINE_CONFIG, type EngineConfig } from "./edge";
import { devig } from "../odds/devig";
import type { OddsApiEvent, OddsApiBookmaker } from "../providers/oddsapi";

function book(
  key: string,
  title: string,
  markets: { key: string; outcomes: { name: string; price: number; point?: number; description?: string }[] }[],
): OddsApiBookmaker {
  return {
    key,
    title,
    last_update: "2026-09-04T18:00:00Z",
    markets: markets.map((m) => ({ ...m, last_update: "2026-09-04T18:00:00Z" })),
  };
}

function event(bookmakers: OddsApiBookmaker[]): OddsApiEvent {
  return {
    id: "evt1",
    sport_key: "americanfootball_nfl",
    sport_title: "NFL",
    commence_time: "2026-09-07T17:00:00Z",
    home_team: "Kansas City Chiefs",
    away_team: "Buffalo Bills",
    bookmakers,
  };
}

const h2h = (home: number, away: number) => ({
  key: "h2h",
  outcomes: [
    { name: "Kansas City Chiefs", price: home },
    { name: "Buffalo Bills", price: away },
  ],
});

const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, minEv: 0.01, bankroll: 10_000 };

describe("edge engine", () => {
  it("finds a soft book pricing above the Pinnacle fair line", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.1, 1.8)]),
      book("fanduel", "FanDuel", [h2h(1.95, 1.92)]),
    ]);

    const opps = findOpportunities(ev, config);
    const chiefs = opps.find((o) => o.selection === "Kansas City Chiefs");

    expect(chiefs).toBeDefined();
    // Pinnacle is the reference, and it is the only sharp book present.
    expect(chiefs!.fairSource).toBe("pinnacle");
    expect(chiefs!.bestBook).toBe("draftkings");
    expect(chiefs!.bestPrice).toBe(2.1);

    // The fair probability must match a direct devig of Pinnacle's own market.
    const pinnacleFair = devig([1.9, 2.0], "shin").fair[0];
    expect(chiefs!.fairProbability).toBeCloseTo(pinnacleFair, 10);
    expect(chiefs!.ev).toBeCloseTo(pinnacleFair * 2.1 - 1, 10);
    expect(chiefs!.ev).toBeGreaterThan(0.07);
    expect(chiefs!.edgeSource).toBe("market");
  });

  it("finds nothing when every book agrees with the sharp line", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(1.88, 1.98)]),
      book("fanduel", "FanDuel", [h2h(1.87, 1.97)]),
    ]);
    // Every soft price is worse than Pinnacle's, so there is no edge anywhere.
    expect(findOpportunities(ev, config)).toHaveLength(0);
  });

  it("can never manufacture an edge from a book against its own line", () => {
    // Pinnacle offers the best price on the Chiefs AND is the fair-value
    // reference. This must yield nothing: with fair = devig(own market),
    // fair_i * price_i = fair_i / q_i, which is below 1 for every outcome
    // because the fair probabilities sum to 1 while the raw ones sum to R > 1.
    // Self-comparison returns exactly negative-vig, never an opportunity.
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(2.2, 1.75)]),
      book("draftkings", "DraftKings", [h2h(1.9, 1.9)]),
    ]);

    const opps = findOpportunities(ev, { ...config, minEv: -1 });
    const chiefs = opps.find((o) => o.selection === "Kansas City Chiefs")!;
    expect(chiefs.bestBook).toBe("pinnacle");
    expect(chiefs.fairSource).toBe("pinnacle");
    expect(chiefs.ev).toBeLessThan(0);

    // With the normal filter it is simply absent.
    expect(
      findOpportunities(ev, config).some(
        (o) => o.selection === "Kansas City Chiefs" && o.bestBook === "pinnacle",
      ),
    ).toBe(false);
  });

  it("shows negative-vig on every side of a single-book market", () => {
    // The same theorem applied across a whole market: one book alone can never
    // produce a positive-EV row, whichever side you take.
    const ev = event([book("pinnacle", "Pinnacle", [h2h(1.95, 1.95)])]);
    const opps = findOpportunities(ev, { ...config, minEv: -1 });
    expect(opps).toHaveLength(2);
    for (const o of opps) expect(o.ev).toBeLessThan(0);
  });

  it("falls back to soft consensus and marks it untrustworthy", () => {
    const ev = event([
      book("draftkings", "DraftKings", [h2h(2.1, 1.8)]),
      book("fanduel", "FanDuel", [h2h(1.9, 1.95)]),
      book("betmgm", "BetMGM", [h2h(1.92, 1.93)]),
    ]);
    const opps = findOpportunities(ev, config);
    const chiefs = opps.find((o) => o.selection === "Kansas City Chiefs");
    expect(chiefs?.fairSource).toBe("all-book-consensus");
    expect(chiefs?.confidence).toBe("low");
    expect(chiefs?.warnings.join(" ")).toMatch(/No sharp book/);
  });

  it("never compares totals across different lines", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [
        {
          key: "totals",
          outcomes: [
            { name: "Over", price: 1.91, point: 47.5 },
            { name: "Under", price: 1.91, point: 47.5 },
          ],
        },
      ]),
      book("draftkings", "DraftKings", [
        {
          key: "totals",
          outcomes: [
            // A different line entirely -- Over 44.5 is a much easier bet than
            // Over 47.5, so treating them as the same market would invent a
            // huge phantom edge.
            { name: "Over", price: 2.3, point: 44.5 },
            { name: "Under", price: 1.65, point: 44.5 },
          ],
        },
      ]),
    ]);

    const opps = findOpportunities(ev, config);
    // The 44.5 market has no sharp reference, and the 47.5 market has no better
    // price. Neither should yield a Pinnacle-backed edge.
    const bogus = opps.find((o) => o.fairSource === "pinnacle" && o.point === 44.5);
    expect(bogus).toBeUndefined();
  });

  it("keeps player props separate per player", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [
        {
          key: "player_pass_yds",
          outcomes: [
            { name: "Over", price: 1.9, point: 275.5, description: "Patrick Mahomes" },
            { name: "Under", price: 1.9, point: 275.5, description: "Patrick Mahomes" },
            { name: "Over", price: 1.9, point: 240.5, description: "Josh Allen" },
            { name: "Under", price: 1.9, point: 240.5, description: "Josh Allen" },
          ],
        },
      ]),
      book("draftkings", "DraftKings", [
        {
          key: "player_pass_yds",
          outcomes: [
            { name: "Over", price: 2.15, point: 275.5, description: "Patrick Mahomes" },
            { name: "Under", price: 1.7, point: 275.5, description: "Patrick Mahomes" },
          ],
        },
      ]),
    ]);

    const opps = findOpportunities(ev, config);
    const mahomes = opps.find((o) => o.selection.includes("Mahomes"));
    expect(mahomes).toBeDefined();
    expect(mahomes!.fairProbability).toBeCloseTo(0.5, 6);
    expect(mahomes!.bestPrice).toBe(2.15);
    // Allen's market was only priced by one book, so it cannot produce an edge.
    expect(opps.some((o) => o.selection.includes("Allen"))).toBe(false);
  });

  it("respects the minimum EV filter", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(1.96, 1.9)]),
    ]);
    const loose = findOpportunities(ev, { ...config, minEv: 0.0 });
    const strict = findOpportunities(ev, { ...config, minEv: 0.2 });
    expect(loose.length).toBeGreaterThan(0);
    expect(strict).toHaveLength(0);
  });

  it("sizes stakes with fractional Kelly and the cap", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.1, 1.8)]),
    ]);
    const chiefs = findOpportunities(ev, config).find((o) => o.selection === "Kansas City Chiefs")!;
    expect(chiefs.stake.fraction).toBeGreaterThan(0);
    // The 2% hard cap must bind on a 7%+ edge rather than letting Kelly run.
    expect(chiefs.stake.fraction).toBeLessThanOrEqual(config.stake.maxStakeFraction);
    expect(chiefs.stake.amount).toBeCloseTo(chiefs.stake.fraction * 10_000, 6);
  });

  it("ignores the model entirely at zero weight", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.1, 1.8)]),
    ]);
    const model = new Map([["h2h|Kansas City Chiefs", 0.85]]);
    const opps = findOpportunities(ev, { ...config, modelWeight: 0 }, model);
    const chiefs = opps.find((o) => o.selection === "Kansas City Chiefs")!;

    expect(chiefs.edgeSource).toBe("market");
    // The model probability is reported for transparency...
    expect(chiefs.modelProbability).toBe(0.85);
    // ...but must not influence the number the stake is computed from.
    expect(chiefs.usedProbability).toBeCloseTo(chiefs.fairProbability, 10);
  });

  it("blends toward the model once it is granted weight, and warns on conflict", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.1, 1.8)]),
    ]);
    const model = new Map([["h2h|Kansas City Chiefs", 0.85]]);
    const opps = findOpportunities(ev, { ...config, modelWeight: 0.3 }, model);
    const chiefs = opps.find((o) => o.selection === "Kansas City Chiefs")!;

    expect(chiefs.edgeSource).toBe("blend");
    expect(chiefs.usedProbability).toBeCloseTo(0.3 * 0.85 + 0.7 * chiefs.fairProbability, 10);
    // A model claiming 85% against a market saying ~51% must be called out.
    expect(chiefs.warnings.join(" ")).toMatch(/disagree sharply/);
  });

  it("warns when an edge is implausibly large", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(3.5, 1.3)]),
    ]);
    const chiefs = findOpportunities(ev, config).find((o) => o.selection === "Kansas City Chiefs")!;
    expect(chiefs.ev).toBeGreaterThan(0.15);
    expect(chiefs.warnings.join(" ")).toMatch(/implausibly large/);
    expect(chiefs.confidence).toBe("low");
  });

  it("excludes books you cannot bet at", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.1, 1.8)]),
    ]);
    const opps = findOpportunities(ev, { ...config, excludeBooks: ["draftkings"] });
    expect(opps.every((o) => o.bestBook !== "draftkings")).toBe(true);
  });

  it("rejects a book whose own market implies under 100%", () => {
    // Exchanges park both sides at the extreme of the ladder when nothing is
    // matched. Live MLB data produced a 110/110 two-way market: implied
    // probabilities summing to 0.018, which normalises to a clean-looking 50/50
    // and a fictitious +5400% edge. Such a market must never enter the engine.
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("betfair_ex_eu", "Betfair", [h2h(110, 110)]),
    ]);

    const opps = findOpportunities(ev, { ...config, minEv: -1 });
    expect(opps.every((o) => o.bestBook !== "betfair_ex_eu")).toBe(true);
    expect(opps.every((o) => o.ev < 1)).toBe(true);
  });

  it("rejects a market whose prices imply far more than 100%", () => {
    // The opposite failure: a feed dropping an outcome, leaving the rest
    // summing to well over 1.
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("betus", "BetUS", [h2h(1.02, 1.02)]),
    ]);
    const opps = findOpportunities(ev, { ...config, minEv: -1 });
    expect(opps.every((o) => o.bestBook !== "betus")).toBe(true);
  });

  it("lowers confidence as the edge grows, not raises it", () => {
    // Against a sharp reference a large gap is evidence of broken data, so a
    // bigger edge must never grade better than a small one.
    const small = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.02, 1.85)]),
    ]);
    const huge = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.6, 1.55)]),
    ]);

    const a = findOpportunities(small, config).find((o) => o.bestBook === "draftkings")!;
    const b = findOpportunities(huge, config).find((o) => o.bestBook === "draftkings")!;

    expect(a.ev).toBeLessThan(b.ev);
    expect(a.confidence).toBe("high");
    expect(b.confidence).toBe("low");
    expect(b.warnings.join(" ")).toMatch(/implausibly large/);
  });

  it("ignores fixtures that have already started", () => {
    // In-play books move at different speeds, so a stale price at one against a
    // live price at another invents huge phantom edges. Live MLB data produced
    // a +213% "edge" on a game that had been running for two hours.
    const live: OddsApiEvent = {
      ...event([
        book("pinnacle", "Pinnacle", [h2h(9.97, 1.06)]),
        book("betfair_ex_eu", "Betfair", [h2h(40, 1.02)]),
      ]),
      commence_time: "2026-09-07T17:00:00Z",
    };

    const during = new Date("2026-09-07T19:00:00Z");
    const before = new Date("2026-09-07T15:00:00Z");

    expect(findOpportunities(live, { ...config, minEv: -1, now: during })).toHaveLength(0);
    // The same fixture before kickoff is priced normally.
    expect(
      findOpportunities(live, { ...config, minEv: -1, now: before }).length,
    ).toBeGreaterThan(0);
  });

  it("never sizes a stake on a row it does not believe", () => {
    // Live Argentine-league data produced a +105% "edge" -- a stale soft price
    // against one thin sharp reference -- that the board correctly flagged with
    // two caveats and then staked $20 on anyway. Flagging a row as untrustworthy
    // and sizing money onto it are incoherent; the stake must be zero.
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(2.8, 1.45)]),
      book("bovada", "Bovada", [h2h(5.75, 1.14)]),
    ]);

    const row = findOpportunities(ev, config).find((o) => o.bestBook === "bovada")!;
    expect(row.ev).toBeGreaterThan(0.5);
    expect(row.confidence).toBe("low");
    expect(row.stake.amount).toBe(0);
    expect(row.stake.fraction).toBe(0);
    expect(row.stake.limitedBy).toBe("not-credible");
  });

  it("still sizes a credible edge normally", () => {
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.02, 1.85)]),
    ]);
    const row = findOpportunities(ev, config).find((o) => o.bestBook === "draftkings")!;
    expect(row.confidence).toBe("high");
    expect(row.stake.amount).toBeGreaterThan(0);
  });

  it("returns nothing for an event with no bookmakers", () => {
    expect(findOpportunities(event([]), config)).toHaveLength(0);
  });

  it("ranks opportunities by EV", () => {
    // Each soft book is generous on ONE side only. A single book generous on
    // both sides would imply under 100% total probability, which no real book
    // offers and which the degenerate-market filter now rejects.
    const ev = event([
      book("pinnacle", "Pinnacle", [h2h(1.9, 2.0)]),
      book("draftkings", "DraftKings", [h2h(2.1, 1.8)]),
      book("fanduel", "FanDuel", [h2h(1.85, 2.15)]),
    ]);
    const opps = findOpportunities(ev, config);
    expect(opps.length).toBeGreaterThan(1);
    for (let i = 1; i < opps.length; i++) {
      expect(opps[i - 1].ev).toBeGreaterThanOrEqual(opps[i].ev);
    }
  });
});
