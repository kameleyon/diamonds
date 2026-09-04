/**
 * Elo rating model.
 *
 * Elo is a recursive estimate of relative strength: every result moves the two
 * ratings by an amount proportional to how surprising it was. It is the right
 * default for NFL, CFB, MLB and tennis because it needs nothing but results,
 * degrades gracefully with sparse data, and has no parameters to overfit
 * besides K.
 *
 * What Elo does NOT give you is a scoring distribution, so it cannot price
 * totals on its own. For that, see `dixon-coles.ts` (soccer) and the
 * spread/total conversion helpers at the bottom of this file.
 */

import type { SportSpec } from "../sports/registry";

/** Every rating starts here; the scale is arbitrary but conventional. */
export const DEFAULT_RATING = 1500;

export interface EloRating {
  competitorId: string;
  rating: number;
  /** Number of results the rating has absorbed. Low counts are unreliable. */
  games: number;
  updatedAt: Date;
}

export interface MatchResult {
  homeId: string;
  awayId: string;
  /** 1 = home win, 0.5 = draw, 0 = away win. */
  homeScore: number;
  /** Points/goals/runs, used for margin-of-victory weighting when available. */
  homePoints?: number;
  awayPoints?: number;
  /** Neutral venue suppresses home advantage (finals, tennis). */
  neutralVenue?: boolean;
  date: Date;
}

export class EloModel {
  private ratings = new Map<string, EloRating>();

  constructor(private readonly sport: SportSpec) {}

  get(competitorId: string): EloRating {
    const existing = this.ratings.get(competitorId);
    if (existing) return existing;
    const fresh: EloRating = {
      competitorId,
      rating: DEFAULT_RATING,
      games: 0,
      updatedAt: new Date(0),
    };
    this.ratings.set(competitorId, fresh);
    return fresh;
  }

  all(): EloRating[] {
    return [...this.ratings.values()].sort((a, b) => b.rating - a.rating);
  }

  /** Seed from stored ratings (e.g. loaded from the database). */
  load(ratings: EloRating[]): void {
    for (const r of ratings) this.ratings.set(r.competitorId, { ...r });
  }

  /**
   * Probability the home side wins, ignoring draws.
   *
   *   E = 1 / (1 + 10^(-(Ra - Rb + H) / 400))
   *
   * The 400 constant defines the scale: a 400-point edge means a 10:1
   * favourite. Home advantage is added in rating points, so it scales
   * correctly against any rating gap.
   */
  expectedScore(homeId: string, awayId: string, neutralVenue = false): number {
    const h = this.get(homeId).rating;
    const a = this.get(awayId).rating;
    const adv = neutralVenue ? 0 : this.sport.homeAdvantage;
    return 1 / (1 + Math.pow(10, -(h - a + adv) / 400));
  }

  /** Rating difference including home advantage, in Elo points. */
  ratingEdge(homeId: string, awayId: string, neutralVenue = false): number {
    const adv = neutralVenue ? 0 : this.sport.homeAdvantage;
    return this.get(homeId).rating - this.get(awayId).rating + adv;
  }

  /**
   * Apply one result.
   *
   * When scores are available we scale K by a margin-of-victory multiplier.
   * The log form is the FiveThirtyEight correction: it credits a 3-point win
   * far more than the difference between a 40- and 43-point blowout, and the
   * `1 / (2.2 + 0.001 * edge)` denominator damps the autocorrelation that would
   * otherwise let strong teams inflate their own ratings by running up scores.
   */
  update(result: MatchResult): { homeAfter: number; awayAfter: number; delta: number } {
    const { homeId, awayId, homeScore, neutralVenue = false } = result;

    const expected = this.expectedScore(homeId, awayId, neutralVenue);
    const edge = this.ratingEdge(homeId, awayId, neutralVenue);

    let k = this.sport.eloK;
    if (result.homePoints !== undefined && result.awayPoints !== undefined) {
      k *= marginMultiplier(result.homePoints - result.awayPoints, edge);
    }

    const delta = k * (homeScore - expected);

    const home = this.get(homeId);
    const away = this.get(awayId);
    home.rating += delta;
    away.rating -= delta;
    home.games += 1;
    away.games += 1;
    home.updatedAt = result.date;
    away.updatedAt = result.date;

    return { homeAfter: home.rating, awayAfter: away.rating, delta };
  }

  /**
   * Pull all ratings a fraction of the way back to the mean.
   *
   * Run between seasons. Teams change rosters, coaches and coordinators, so
   * last season's rating is a biased prior for this one; regressing ~25% toward
   * 1500 is the standard correction and materially improves early-season
   * calibration.
   */
  regressToMean(fraction = 0.25): void {
    for (const r of this.ratings.values()) {
      r.rating = r.rating + (DEFAULT_RATING - r.rating) * fraction;
    }
  }

  /** Fit ratings by replaying results in chronological order. */
  fit(results: MatchResult[]): void {
    const ordered = [...results].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const r of ordered) this.update(r);
  }
}

/**
 * Margin-of-victory multiplier on K.
 *
 * `pointDiff` is signed from the home team's perspective; `ratingEdge` is the
 * pre-game rating gap. An upset (winner was the underdog) gets a larger
 * multiplier because it is more informative.
 */
export function marginMultiplier(pointDiff: number, ratingEdge: number): number {
  const margin = Math.abs(pointDiff);
  // Signed so that a win by the pre-game underdog produces a smaller
  // denominator, hence a larger multiplier.
  const signedEdge = pointDiff > 0 ? ratingEdge : -ratingEdge;
  return Math.log(margin + 1) * (2.2 / (signedEdge * 0.001 + 2.2));
}

/**
 * Convert an Elo edge into a point spread.
 *
 * `pointsPerElo` is sport-specific and must be calibrated against real closing
 * spreads -- the values in `SPREAD_SCALE` are published starting points, not
 * truths. Using an uncalibrated scale is the fastest way to manufacture fake
 * edges on the spread market.
 */
export const SPREAD_SCALE: Record<string, number> = {
  nfl: 25, // ~25 Elo points per point of spread
  cfb: 28,
  mlb: 0, // spreads in MLB are a fixed 1.5 runline; Elo does not map linearly
  soccer: 0,
  tennis: 0,
};

export function eloToSpread(ratingEdge: number, sportId: string): number | null {
  const scale = SPREAD_SCALE[sportId];
  if (!scale) return null;
  return ratingEdge / scale;
}

/**
 * Convert a two-way win probability into a three-way 1X2 split.
 *
 * Elo has no notion of a draw, so this distributes draw probability around the
 * two-way estimate. `drawRate` is the competition's base draw frequency (~0.25
 * in most soccer leagues), and draws are made likeliest for evenly matched
 * sides by damping with how close the two-way probability is to 0.5.
 *
 * This is a serviceable approximation, NOT a substitute for Dixon-Coles. Use it
 * only where goal data is unavailable.
 */
export function twoWayToThreeWay(
  homeWinTwoWay: number,
  drawRate = 0.25,
): { home: number; draw: number; away: number } {
  const closeness = 1 - 2 * Math.abs(homeWinTwoWay - 0.5); // 1 when even, 0 when lopsided
  const draw = drawRate * closeness;
  const remaining = 1 - draw;
  return {
    home: homeWinTwoWay * remaining,
    draw,
    away: (1 - homeWinTwoWay) * remaining,
  };
}
