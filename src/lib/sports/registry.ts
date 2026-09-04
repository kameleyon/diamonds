/**
 * Sport registry.
 *
 * Maps the five sports this app covers onto The Odds API's sport keys, and
 * records the properties the rating models need to know about each one.
 *
 * Competition keys are NOT hardcoded. The Odds API scopes tennis by tournament
 * (`tennis_atp_wimbledon` exists only during Wimbledon) and soccer by league,
 * and inactive competitions disappear from the catalogue entirely. So the
 * registry matches on key prefix and resolves live competitions at runtime.
 */

export type SportId = "soccer" | "nfl" | "cfb" | "mlb" | "tennis";

export type MarketKey = "h2h" | "spreads" | "totals" | "props";

export interface SportSpec {
  id: SportId;
  label: string;
  /** Prefixes used to recognise this sport in The Odds API catalogue. */
  keyPrefixes: string[];
  /** Markets worth pulling for this sport. */
  markets: MarketKey[];
  /** True when a draw is a distinct outcome, making the moneyline three-way. */
  hasDraw: boolean;
  /**
   * Which rating model to fit. `poisson` models scoring rates directly and only
   * makes sense for low-scoring goal sports; everything else uses Elo.
   */
  model: "dixon-coles" | "elo";
  /**
   * Elo K-factor: how far a rating moves per result. Higher means faster
   * adaptation but noisier ratings. Tuned to how many games a season has and
   * how much genuine roster turnover happens between them.
   */
  eloK: number;
  /** Rating points of home advantage, on the Elo scale. Tennis has none. */
  homeAdvantage: number;
  /** The Odds API prop market keys, where the sport supports them. */
  propMarkets: string[];
  /** Honest note about where this sport's model is weak. */
  caveat: string;
}

export const SPORTS: Record<SportId, SportSpec> = {
  soccer: {
    id: "soccer",
    label: "Soccer",
    keyPrefixes: ["soccer_"],
    markets: ["h2h", "spreads", "totals"],
    hasDraw: true,
    model: "dixon-coles",
    eloK: 20,
    homeAdvantage: 65,
    propMarkets: ["player_goal_scorer_anytime", "player_shots_on_target"],
    caveat:
      "Draw probability is the hardest quantity in sports modelling; Dixon-Coles corrects low-score dependence but draws stay noisy.",
  },
  nfl: {
    id: "nfl",
    label: "NFL",
    keyPrefixes: ["americanfootball_nfl"],
    markets: ["h2h", "spreads", "totals", "props"],
    hasDraw: false,
    // Only ~17 games per team per season, so ratings must move fast to stay current.
    eloK: 32,
    model: "elo",
    homeAdvantage: 55,
    propMarkets: [
      "player_pass_yds",
      "player_rush_yds",
      "player_reception_yds",
      "player_anytime_td",
    ],
    caveat:
      "Sharpest market in US sports and only ~16 games a week, so edges are small and samples accumulate slowly.",
  },
  cfb: {
    id: "cfb",
    label: "College Football",
    keyPrefixes: ["americanfootball_ncaaf"],
    markets: ["h2h", "spreads", "totals"],
    hasDraw: false,
    model: "elo",
    // Huge talent gaps and heavy roster turnover; ratings need to move quickly.
    eloK: 40,
    homeAdvantage: 65,
    propMarkets: [],
    caveat:
      "Enormous talent disparity produces extreme spreads where model error is largest. Soft lines exist but so do blowout-driven rating distortions.",
  },
  mlb: {
    id: "mlb",
    label: "MLB",
    keyPrefixes: ["baseball_mlb"],
    markets: ["h2h", "spreads", "totals", "props"],
    hasDraw: false,
    model: "elo",
    // 162 games smooths ratings, so a low K avoids chasing noise.
    eloK: 12,
    homeAdvantage: 24,
    propMarkets: ["batter_home_runs", "batter_hits", "pitcher_strikeouts"],
    caveat:
      "Team Elo is a weak model for baseball because the starting pitcher dominates a single game. Treat team-level output as a prior only.",
  },
  tennis: {
    id: "tennis",
    label: "Tennis",
    keyPrefixes: ["tennis_"],
    markets: ["h2h", "totals"],
    hasDraw: false,
    model: "elo",
    eloK: 24,
    // Neutral courts: there is no home team in tennis.
    homeAdvantage: 0,
    propMarkets: [],
    caveat:
      "Surface matters enormously; a single rating per player is a known simplification. Retirements and walkovers corrupt naive result data.",
  },
};

export const SPORT_IDS = Object.keys(SPORTS) as SportId[];

/** Identify which of our sports an Odds API sport key belongs to, if any. */
export function sportForKey(oddsApiKey: string): SportSpec | undefined {
  return Object.values(SPORTS).find((s) =>
    s.keyPrefixes.some((p) => oddsApiKey.startsWith(p)),
  );
}

/** Number of outcomes in the moneyline market for a sport. */
export function moneylineOutcomes(sport: SportSpec): number {
  return sport.hasDraw ? 3 : 2;
}
