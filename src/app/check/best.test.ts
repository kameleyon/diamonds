import { describe, it, expect } from "vitest";
import { scanEvents, DEFAULT_ENGINE_CONFIG } from "@/lib/engine/edge";
import { DEMO_EVENTS } from "@/lib/fixtures/demo-slate";

/**
 * "Best today" must mean the best BET, not the biggest number.
 *
 * The demo slate deliberately contains a stale line with an enormous headline
 * edge. Sorting by raw EV puts it first, which is how a +105% soccer moneyline
 * priced by one soft book ended up promoted as the day's headline while the
 * engine had already graded it low confidence and staked it at zero.
 */
describe("headline selection", () => {
  const opportunities = scanEvents(DEMO_EVENTS, { ...DEFAULT_ENGINE_CONFIG, minEv: 0.01 });

  it("the raw top of the list is the untrustworthy one", () => {
    const top = opportunities[0];
    expect(top.ev).toBeGreaterThan(0.1);
    expect(top.confidence).toBe("low");
    expect(top.stake.amount).toBe(0);
  });

  it("filtering to credible rows picks a different, believable headline", () => {
    const credible = opportunities.filter((o) => o.confidence !== "low" && o.stake.amount > 0);
    expect(credible.length).toBeGreaterThan(0);

    const best = credible[0];
    expect(best).not.toBe(opportunities[0]);
    // A credible headline sits in the range real market edges occupy.
    expect(best.ev).toBeLessThan(0.1);
    expect(best.stake.amount).toBeGreaterThan(0);
    expect(best.warnings.some((w) => w.includes("implausibly large"))).toBe(false);
  });
});
