/**
 * Price a pasted bet.
 *
 * Pure functions over data, with no secret access -- deliberately NOT marked
 * `server-only`, so the verdict logic can be unit-tested directly. The guard
 * belongs on modules that hold credentials (`supabase/admin.ts`), not on
 * everything that happens to run on the server.
 *
 * Answers one of two questions depending on whether the fixture has played:
 *
 *   UPCOMING  Is this price worth taking? Compared against the sharp market the
 *             same way the board compares everything else.
 *   SETTLED   Did it win, AND was it a good bet? Those are separate questions
 *             and both are answered. Reporting only the result teaches that
 *             winning bets were good bets, which is the most expensive thing a
 *             bettor can learn wrong.
 *
 * When the fixture cannot be found, that is reported plainly. Inventing a
 * verdict for a bet we could not price would be worse than useless in a tool
 * whose entire claim is auditable evidence.
 */

import type { ParsedBet } from "../parse/bet-slip";
import type { Opportunity } from "./edge";
import { devig } from "../odds/devig";
import { expectedValue } from "../odds/ev";
import { impliedProbability } from "../odds/format";
import type { OddsApiEvent } from "../providers/oddsapi";

export type Verdict = "take" | "thin" | "pass" | "unknown";

export interface BetCheck {
  parsed: ParsedBet;
  verdict: Verdict;
  /** Why, in one sentence. */
  headline: string;
  reasoning: string[];

  /** Present when the bet was priced against a live market. */
  ev?: number;
  yourPrice?: number;
  needsToHit?: number;
  fairProbability?: number;
  fairSource?: string;
  bestPrice?: number;
  bestBook?: string;

  /** Present when the fixture has already played. */
  settled?: {
    won: boolean;
    homeScore: number;
    awayScore: number;
    fixture: string;
    /** Was it +EV at the price taken, regardless of the result? */
    wasGoodBet: boolean | null;
    quadrant: "right-and-paid" | "lucky" | "right-unlucky" | "wrong-and-paid" | "unclear";
  };

  matchedFixture?: string;
}

/** Loose name match: "Chiefs" should find "Kansas City Chiefs". */
export function nameMatches(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const h = haystack.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (!n || !h) return false;
  if (h.includes(n) || n.includes(h)) return true;
  // Any significant word in common (skips "the", "fc", short noise).
  const words = n.split(/\s+/).filter((w) => w.length > 3);
  return words.some((w) => h.includes(w));
}

/**
 * Find the opportunity, if any, that corresponds to this parsed bet.
 *
 * Deliberately conservative: a wrong match produces a confident verdict about
 * the wrong game, which is worse than admitting we could not find it.
 */
export function findMatch(
  parsed: ParsedBet,
  opportunities: Opportunity[],
): Opportunity | undefined {
  if (!parsed.subject) return undefined;

  const marketKey =
    parsed.market === "moneyline" ? "h2h" : parsed.market === "total" ? "totals" : "spreads";

  return opportunities.find((o) => {
    if (o.marketKey !== marketKey) return false;

    if (parsed.market === "total") {
      if (parsed.line !== undefined && o.point !== undefined) {
        if (Math.abs(Math.abs(o.point) - Math.abs(parsed.line)) > 0.001) return false;
      }
      const wantOver = parsed.side !== "under";
      if (o.selection.toLowerCase().includes("over") !== wantOver) return false;
      return (
        nameMatches(parsed.subject!, o.homeTeam ?? "") ||
        nameMatches(parsed.subject!, o.awayTeam ?? "")
      );
    }

    return nameMatches(parsed.subject!, o.selection);
  });
}

/**
 * Price the bet against a matched market.
 *
 * The user's own price is what gets judged when they supplied one. Without it,
 * the best available price stands in and the answer becomes "is this bet worth
 * making at all", which is a different and weaker question -- so the reasoning
 * says which was used.
 */
export function checkAgainstMarket(parsed: ParsedBet, match: Opportunity): BetCheck {
  const yourPrice = parsed.price ?? match.bestPrice;
  const usedOwnPrice = parsed.price !== undefined;

  const ev = expectedValue(match.fairProbability, yourPrice);
  const needsToHit = impliedProbability(yourPrice);

  const reasoning: string[] = [];
  let verdict: Verdict;
  let headline: string;

  if (ev >= 0.02) {
    verdict = "take";
    headline = `Worth taking — the price pays more than the market says it should.`;
  } else if (ev > 0) {
    verdict = "thin";
    headline = `Marginal. Positive, but inside the range noise produces.`;
  } else {
    verdict = "pass";
    headline = `Pass — the price asks you to be right more often than the market expects.`;
  }

  reasoning.push(
    usedOwnPrice
      ? `Judged at your price of ${yourPrice.toFixed(2)}, which needs this to hit ${(needsToHit * 100).toFixed(1)}% of the time.`
      : `No price given, so this is judged at the best available: ${match.bestPrice.toFixed(2)} at ${match.bestBookTitle}.`,
  );

  reasoning.push(
    `The sharp market puts it at ${(match.fairProbability * 100).toFixed(1)}%` +
      (match.fairSource === "pinnacle"
        ? `, from Pinnacle.`
        : match.fairSource === "sharp-consensus"
          ? `, from ${match.booksCounted} sharp book${match.booksCounted === 1 ? "" : "s"}.`
          : `, but no sharp book priced it — that figure is an average of soft books and is weak evidence.`),
  );

  if (usedOwnPrice && match.bestPrice > yourPrice) {
    const better = (match.bestPrice / yourPrice - 1) * 100;
    reasoning.push(
      `${match.bestBookTitle} is offering ${match.bestPrice.toFixed(2)} on the same side — ${better.toFixed(1)}% better. If you want this bet, take it there.`,
    );
  }

  if (match.confidence === "low") {
    verdict = verdict === "take" ? "thin" : verdict;
    reasoning.push(
      `The engine does not trust this row: ${match.warnings[0] ?? "the evidence is thin."}`,
    );
  }

  return {
    parsed,
    verdict,
    headline,
    reasoning,
    ev,
    yourPrice,
    needsToHit,
    fairProbability: match.fairProbability,
    fairSource: match.fairSource,
    bestPrice: match.bestPrice,
    bestBook: match.bestBookTitle,
    matchedFixture:
      match.homeTeam && match.awayTeam ? `${match.awayTeam} at ${match.homeTeam}` : undefined,
  };
}

/**
 * Judge a bet whose fixture has already played.
 *
 * Two independent answers. The quadrant names the combination, because
 * "won but should not have been bet" is the case people most need to see and
 * the one a result-only report hides.
 */
export function checkSettled(
  parsed: ParsedBet,
  result: { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number },
): BetCheck {
  const total = result.homeScore + result.awayScore;
  let won: boolean;

  if (parsed.market === "total" && parsed.line !== undefined) {
    won = parsed.side === "under" ? total < parsed.line : total > parsed.line;
  } else {
    const backedHome = nameMatches(parsed.subject ?? "", result.homeTeam);
    const margin = result.homeScore - result.awayScore;
    if (parsed.market === "spread" && parsed.line !== undefined) {
      won = backedHome ? margin + parsed.line > 0 : -margin + parsed.line > 0;
    } else {
      won = backedHome ? margin > 0 : margin < 0;
    }
  }

  /*
   * Whether it was a GOOD bet stays null, even when a price was given.
   *
   * Answering it honestly needs the fair probability AS IT WAS before kickoff,
   * and no current data source provides historical closing lines on its plan.
   * Comparing against today's market would be judging a settled bet with
   * information that did not exist when it was placed -- the same lookahead
   * error the backtest exists to avoid. Better to say "unknown" than to
   * manufacture a verdict.
   */
  const wasGoodBet: boolean | null = null;

  const fixture = `${result.awayTeam} at ${result.homeTeam}`;
  const reasoning: string[] = [
    `Final score ${result.homeScore}–${result.awayScore}. ${fixture}.`,
  ];

  // "Was it a good bet" is always unanswerable here, but for two different
  // reasons, and saying which one is the difference between a limitation and a
  // shrug.
  reasoning.push(
    parsed.price === undefined
      ? `Whether it was a GOOD bet needs the price you took — the result alone does not tell you. Add it (for example "${parsed.raw} -110").`
      : `You took ${parsed.price.toFixed(2)}. Judging whether that was a good price needs the fair value AS IT WAS before kickoff, and no current data source provides historical closing lines on its plan. Comparing against today's market would be judging the bet with information that did not exist when you placed it.`,
  );

  return {
    parsed,
    verdict: "unknown",
    headline: won ? "It won." : "It lost.",
    reasoning,
    settled: {
      won,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      fixture,
      wasGoodBet,
      quadrant: "unclear",
    },
    matchedFixture: fixture,
  };
}

/** Nothing matched: say so, and say what would help. */
export function noMatch(parsed: ParsedBet, scanned: number): BetCheck {
  const reasoning: string[] = [];

  if (!parsed.subject) {
    reasoning.push(`No team or player was recognised in "${parsed.raw}".`);
  } else {
    reasoning.push(
      `No live market matched ${parsed.subject}${
        parsed.line !== undefined ? ` at ${parsed.line}` : ""
      } across the ${scanned} fixtures currently priced.`,
    );
    reasoning.push(
      `That usually means the fixture is outside the sports being scanned, further out than the board reaches, or already under way — the engine excludes in-play markets because stale prices there invent enormous phantom edges.`,
    );
  }

  return {
    parsed,
    verdict: "unknown",
    headline: "Could not price this one.",
    reasoning,
  };
}

/** Convenience for callers holding raw events rather than opportunities. */
export function fairFromEvent(event: OddsApiEvent, outcomeName: string): number | undefined {
  for (const b of event.bookmakers) {
    for (const m of b.markets) {
      if (m.key !== "h2h") continue;
      const idx = m.outcomes.findIndex((o) => o.name === outcomeName);
      if (idx === -1) continue;
      try {
        return devig(m.outcomes.map((o) => o.price)).fair[idx];
      } catch {
        continue;
      }
    }
  }
  return undefined;
}
