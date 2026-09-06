/**
 * Edge detection engine.
 *
 * Turns raw bookmaker data into ranked, stake-sized betting opportunities.
 *
 * There are two independent sources of edge here and the engine keeps them
 * strictly separate, because they carry very different amounts of trust:
 *
 *   MARKET edge  -- the sharp consensus (ideally Pinnacle, whose line moves on
 *                   money rather than opinion) says an outcome is 55%, but a
 *                   soft book is still offering a price that only needs 52%.
 *                   Requires no model. Works on day one. Edges are small, real,
 *                   and the way most profitable bettors actually operate.
 *
 *   MODEL edge   -- your own rating model disagrees with the entire market.
 *                   Potentially much larger, but until a backtest has earned
 *                   that trust, a big model edge is far more likely to be model
 *                   error than market error.
 *
 * Reporting these as one blended number would hide exactly the distinction you
 * need in order to decide whether to believe a bet.
 */

import { devig, devigAll, type DevigMethod } from "../odds/devig";
import { recommendedStake, blendProbability, DEFAULT_STAKE_CONFIG, type StakeConfig, type StakeRecommendation } from "../odds/ev";
import type { OddsApiEvent, OddsApiBookmaker } from "../providers/oddsapi";
import { sportForKey } from "../sports/registry";

/**
 * Books whose prices carry information rather than just marketing.
 *
 * Pinnacle is the reference: low margin, high limits, and it welcomes sharp
 * money instead of limiting it, so its line is the closest public thing to a
 * true probability. Exchanges are next best. Ordered by how much we trust them.
 */
export const SHARP_BOOKS = [
  "pinnacle",
  "betfair_ex_uk",
  "betfair_ex_eu",
  "betfair_ex_au",
  "matchbook",
  "lowvig",
  "betonlineag",
] as const;

export type EdgeSource = "market" | "model" | "blend";

export type Confidence = "high" | "medium" | "low";

export interface Opportunity {
  eventId: string;
  sportKey: string;
  sportLabel: string;
  commenceTime: string;
  homeTeam: string | null;
  awayTeam: string | null;

  /** Market key as reported by the provider: h2h, spreads, totals, or a prop. */
  marketKey: string;
  /** The specific side being backed. */
  selection: string;
  /** Handicap or total line, where the market has one. */
  point?: number;

  /** Best price found and where to get it. */
  bestBook: string;
  bestBookTitle: string;
  bestPrice: number;

  /** Devigged sharp-consensus probability. */
  fairProbability: number;
  fairSource: "pinnacle" | "sharp-consensus" | "all-book-consensus";
  /** How many books contributed to the consensus. */
  booksCounted: number;

  /** Model probability, when a model covers this market. */
  modelProbability?: number;

  /** The probability actually used for sizing. */
  usedProbability: number;
  edgeSource: EdgeSource;

  /** EV as a fraction of stake. 0.035 == +3.5%. */
  ev: number;
  marketEv: number;
  modelEv?: number;

  stake: StakeRecommendation;

  /**
   * How far apart the four devig methods are on this outcome. If this exceeds
   * the edge, the edge is a devig artefact rather than an opportunity.
   */
  methodSpread: number;
  /** Overround of the reference book on this market. */
  overround: number;

  confidence: Confidence;
  warnings: string[];
}

export interface EngineConfig {
  devigMethod: DevigMethod;
  stake: StakeConfig;
  /**
   * How much to trust the model when blending against market consensus.
   * Starts at 0 -- the model earns weight through backtesting, it is not
   * granted any by default.
   */
  modelWeight: number;
  /** Books to exclude (ones you cannot bet at). */
  excludeBooks: string[];
  /** Drop opportunities whose EV falls below this. */
  minEv: number;
  bankroll: number;
  /**
   * Ignore fixtures that have already started.
   *
   * This is on by default and should stay on. In-play books update at wildly
   * different speeds, so a stale price at one against a current price at
   * another manufactures enormous phantom edges. On live MLB data this produced
   * a +213% "edge" on the Angels -- correct arithmetic on a game the Pirates
   * were already winning, and completely untakeable.
   *
   * A pre-match terminal should not be pricing in-play markets at all.
   */
  excludeStarted: boolean;
  /** Treated as "now" when deciding what has started. Injected for tests. */
  now?: Date;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  devigMethod: "shin",
  stake: DEFAULT_STAKE_CONFIG,
  modelWeight: 0,
  excludeBooks: [],
  minEv: 0.02,
  bankroll: 1000,
  excludeStarted: true,
};

/**
 * Sanity bounds on a single book's own overround.
 *
 * A bookmaker always charges margin, so within ONE book's own market the
 * implied probabilities must sum to more than 1. When they do not, it is not an
 * arbitrage -- it is a broken or empty book. Betfair and other exchanges park
 * both sides at the extreme of the ladder when nothing is matched, which on
 * live MLB data produced 110/110 two-way markets: implied probabilities summing
 * to 0.018, a "fair" price of 50/50 after normalisation, and a completely
 * fictitious +5400% edge.
 *
 * The upper bound catches the opposite failure -- a garbage feed or a market
 * with a missing outcome, where the remaining prices imply far more than 100%.
 */
const MIN_OVERROUND_SUM = 0.99;
const MAX_OVERROUND_SUM = 3.0;

/** A single market at a single book, grouped so it can be devigged as a unit. */
interface BookMarket {
  bookKey: string;
  bookTitle: string;
  marketKey: string;
  /** Totals/spreads are only comparable at the same line, so it keys the group. */
  point?: number;
  outcomes: { name: string; price: number; point?: number; description?: string }[];
}

/**
 * Flatten an event into per-book, per-market, per-line groups.
 *
 * The grouping by line matters: Over 2.5 and Over 3.5 are different markets,
 * and devigging them together would be meaningless. Likewise a spread of -3.5
 * at one book is not the same bet as -4.0 at another.
 */
function groupMarkets(bookmakers: OddsApiBookmaker[], exclude: string[]): BookMarket[] {
  const groups: BookMarket[] = [];

  for (const book of bookmakers) {
    if (exclude.includes(book.key)) continue;

    for (const market of book.markets) {
      // Player props carry the player in `description`, so each player is a
      // separate two-way market and must be grouped by player as well as line.
      const byKey = new Map<string, BookMarket["outcomes"]>();

      for (const o of market.outcomes) {
        const lineKey = o.point !== undefined ? String(Math.abs(o.point)) : "-";
        const playerKey = o.description ?? "-";
        const k = `${playerKey}|${lineKey}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push({
          name: o.name,
          price: o.price,
          point: o.point,
          description: o.description,
        });
      }

      for (const [, outcomes] of byKey) {
        // A market we cannot devig is a market we cannot price.
        if (outcomes.length < 2) continue;

        // Reject degenerate books before they can contaminate anything. This
        // has to happen here rather than at scoring time, because such a market
        // would otherwise poison BOTH the consensus and the best-price search.
        let sum = 0;
        let bad = false;
        for (const o of outcomes) {
          if (!(o.price > 1) || !Number.isFinite(o.price)) {
            bad = true;
            break;
          }
          sum += 1 / o.price;
        }
        if (bad || sum < MIN_OVERROUND_SUM || sum > MAX_OVERROUND_SUM) continue;

        groups.push({
          bookKey: book.key,
          bookTitle: book.title,
          marketKey: market.key,
          point: outcomes[0].point !== undefined ? Math.abs(outcomes[0].point) : undefined,
          outcomes,
        });
      }
    }
  }

  return groups;
}

/** Stable identity for one bettable side, used to match it across books. */
function selectionId(g: BookMarket, outcomeIndex: number): string {
  const o = g.outcomes[outcomeIndex];
  const parts = [g.marketKey];
  if (o.description) parts.push(o.description);
  if (o.point !== undefined) parts.push(String(o.point));
  parts.push(o.name);
  return parts.join("|");
}

interface Consensus {
  fair: number;
  source: Opportunity["fairSource"];
  booksCounted: number;
  methodSpread: number;
  overround: number;
}

/**
 * Establish the fair probability for every selection.
 *
 * Preference order is deliberate. Pinnacle alone beats an average that includes
 * soft books, because averaging in books that are systematically wrong makes
 * the estimate systematically wrong. Only when no sharp book is present do we
 * fall back to a broad consensus, and the result is flagged as weaker.
 */
function buildConsensus(
  groups: BookMarket[],
  method: DevigMethod,
): Map<string, Consensus> {
  const out = new Map<string, Consensus>();

  // Collect devigged probabilities per selection, tagged by book sharpness.
  const collected = new Map<
    string,
    { pinnacle?: number; sharp: number[]; all: number[]; spread: number[]; overround: number[] }
  >();

  for (const g of groups) {
    const prices = g.outcomes.map((o) => o.price);
    let result;
    let allMethods;
    try {
      result = devig(prices, method);
      allMethods = devigAll(prices);
    } catch {
      // A malformed market (bad price, single outcome) is skipped rather than
      // allowed to poison the consensus.
      continue;
    }

    for (let i = 0; i < g.outcomes.length; i++) {
      const id = selectionId(g, i);
      if (!collected.has(id)) {
        collected.set(id, { sharp: [], all: [], spread: [], overround: [] });
      }
      const entry = collected.get(id)!;
      const p = result.fair[i];

      entry.all.push(p);
      entry.overround.push(result.overround);

      const across = Object.values(allMethods).map((r) => r.fair[i]);
      entry.spread.push(Math.max(...across) - Math.min(...across));

      if (g.bookKey === "pinnacle") entry.pinnacle = p;
      else if ((SHARP_BOOKS as readonly string[]).includes(g.bookKey)) entry.sharp.push(p);
    }
  }

  for (const [id, e] of collected) {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    let fair: number;
    let source: Opportunity["fairSource"];
    let booksCounted: number;

    if (e.pinnacle !== undefined) {
      fair = e.pinnacle;
      source = "pinnacle";
      booksCounted = 1;
    } else if (e.sharp.length > 0) {
      fair = mean(e.sharp);
      source = "sharp-consensus";
      booksCounted = e.sharp.length;
    } else {
      fair = mean(e.all);
      source = "all-book-consensus";
      booksCounted = e.all.length;
    }

    out.set(id, {
      fair,
      source,
      booksCounted,
      methodSpread: mean(e.spread),
      overround: mean(e.overround),
    });
  }

  return out;
}

/** Model probabilities keyed by the same selection id the consensus uses. */
export type ModelProbabilities = Map<string, number>;

/**
 * Find every +EV opportunity in one event.
 *
 * For each selection: establish fair probability from the sharpest available
 * source, find the best price anyone is offering, and size the bet. An
 * opportunity exists when the best price beats what the sharp consensus says is
 * fair -- that gap is the whole game.
 */
export function findOpportunities(
  event: OddsApiEvent,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
  modelProbabilities?: ModelProbabilities,
): Opportunity[] {
  // Anything already under way is dropped before any pricing happens.
  if (config.excludeStarted) {
    const now = config.now ?? new Date();
    if (new Date(event.commence_time).getTime() <= now.getTime()) return [];
  }

  const sport = sportForKey(event.sport_key);
  const groups = groupMarkets(event.bookmakers, config.excludeBooks);
  if (groups.length === 0) return [];

  const consensus = buildConsensus(groups, config.devigMethod);

  // Best available price per selection, and who is offering it.
  const best = new Map<string, { price: number; bookKey: string; bookTitle: string; g: BookMarket; i: number }>();
  for (const g of groups) {
    for (let i = 0; i < g.outcomes.length; i++) {
      const id = selectionId(g, i);
      const price = g.outcomes[i].price;
      const current = best.get(id);
      if (!current || price > current.price) {
        best.set(id, { price, bookKey: g.bookKey, bookTitle: g.bookTitle, g, i });
      }
    }
  }

  const opportunities: Opportunity[] = [];

  for (const [id, b] of best) {
    const c = consensus.get(id);
    if (!c) continue;
    if (c.fair <= 0 || c.fair >= 1) continue;

    const outcome = b.g.outcomes[b.i];
    const modelP = modelProbabilities?.get(id);

    const marketEv = c.fair * b.price - 1;
    const modelEv = modelP !== undefined ? modelP * b.price - 1 : undefined;

    // The model only gets weight if it has been granted some AND it actually
    // covers this market. Otherwise the market consensus stands alone.
    const useModel = modelP !== undefined && config.modelWeight > 0;
    const usedProbability = useModel
      ? blendProbability(modelP, c.fair, config.modelWeight)
      : c.fair;
    const edgeSource: EdgeSource = useModel
      ? config.modelWeight >= 1
        ? "model"
        : "blend"
      : "market";

    const ev = usedProbability * b.price - 1;
    if (ev < config.minEv) continue;

    const warnings: string[] = [];

    // The single most important sanity check in the whole engine.
    if (c.methodSpread > ev) {
      warnings.push(
        `Devig methods disagree by ${(c.methodSpread * 100).toFixed(1)}pp, which is more than the ` +
          `${(ev * 100).toFixed(1)}% edge. This is probably a devig artefact, not an opportunity.`,
      );
    }
    if (c.source === "all-book-consensus") {
      warnings.push(
        `No sharp book priced this market, so "fair" is an average of soft books ` +
          `(${c.booksCounted}). Treat the edge as unverified.`,
      );
    }
    if (c.booksCounted < 3 && c.source !== "pinnacle") {
      warnings.push(`Only ${c.booksCounted} book(s) in the consensus -- thin evidence.`);
    }
    if (ev > IMPLAUSIBLE_EDGE) {
      warnings.push(
        `+${(ev * 100).toFixed(1)}% is implausibly large against a sharp reference. Real market ` +
          `edges are 1-4%. Almost always a stale line, a pulled market, a mismatched handicap, or ` +
          `an illiquid exchange price. Verify it is still takeable before betting.`,
      );
    }
    // NOTE: there is deliberately no "reference book is also the best price"
    // warning here, because that case cannot produce a positive edge in the
    // first place. If `fair` is the devig of a book's own market then
    // fair_i * price_i = fair_i / q_i, and since the fair probabilities sum to
    // 1 while the raw ones sum to R > 1, that product is below 1 for every
    // outcome. Self-comparison always yields exactly negative-vig, so such
    // rows never survive the `minEv` filter above.
    if (modelEv !== undefined && Math.abs(modelEv - marketEv) > 0.1) {
      warnings.push(
        `Model and market disagree sharply (model ${(modelEv * 100).toFixed(1)}% vs market ` +
          `${(marketEv * 100).toFixed(1)}%). Until the model is backtested, believe the market.`,
      );
    }

    const stake = recommendedStake(usedProbability, b.price, config.bankroll, config.stake);

    opportunities.push({
      eventId: event.id,
      sportKey: event.sport_key,
      sportLabel: sport?.label ?? event.sport_title,
      commenceTime: event.commence_time,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      marketKey: b.g.marketKey,
      selection: outcome.description ? `${outcome.description} ${outcome.name}` : outcome.name,
      point: outcome.point,
      bestBook: b.bookKey,
      bestBookTitle: b.bookTitle,
      bestPrice: b.price,
      fairProbability: c.fair,
      fairSource: c.source,
      booksCounted: c.booksCounted,
      modelProbability: modelP,
      usedProbability,
      edgeSource,
      ev,
      marketEv,
      modelEv,
      stake,
      methodSpread: c.methodSpread,
      overround: c.overround,
      confidence: gradeConfidence(c, ev, warnings),
      warnings,
    });
  }

  return opportunities.sort((a, b) => b.ev - a.ev);
}

/**
 * Edges above this are treated as data problems rather than opportunities.
 *
 * The relationship between edge size and trustworthiness is INVERTED once a
 * sharp reference is involved. A sharp book's price is close to the true
 * probability, so a soft book being 2% away from it is an ordinary lag, while
 * being 15% away means something is broken: the line is stale, the market has
 * been pulled, the handicaps do not match, or the price sits on an illiquid
 * exchange ladder. Live MLB data produced exactly these.
 */
const IMPLAUSIBLE_EDGE = 0.1;
/** Above this, the evidence can never be graded better than medium. */
const SUSPICIOUS_EDGE = 0.06;

/**
 * Grade how much to trust an opportunity.
 *
 * Confidence is about the quality of the EVIDENCE, not the size of the payoff.
 * Note the deliberate inversion: a bigger edge lowers confidence rather than
 * raising it, because against a sharp reference a large gap is far more likely
 * to be a data artefact than a real opportunity.
 */
function gradeConfidence(c: Consensus, ev: number, warnings: string[]): Confidence {
  if (warnings.some((w) => w.includes("devig artefact"))) return "low";
  if (c.source === "all-book-consensus") return "low";
  if (ev > IMPLAUSIBLE_EDGE) return "low";

  const evidenceIsStrong =
    (c.source === "pinnacle" && c.methodSpread < ev / 2) ||
    (c.source === "sharp-consensus" && c.booksCounted >= 2 && c.methodSpread < ev);

  if (!evidenceIsStrong) return "medium";
  // Strong evidence, but an edge this size still argues against itself.
  return ev > SUSPICIOUS_EDGE ? "medium" : "high";
}

/** Scan many events at once and rank every opportunity found. */
export function scanEvents(
  events: OddsApiEvent[],
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
  models?: Map<string, ModelProbabilities>,
): Opportunity[] {
  return events
    .flatMap((e) => findOpportunities(e, config, models?.get(e.id)))
    .sort((a, b) => b.ev - a.ev);
}
