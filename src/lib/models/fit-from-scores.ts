/**
 * Fit rating models from completed results.
 *
 * Uses The Odds API's scores endpoint rather than a separate stats provider, so
 * the models work with the one key the board already needs. The trade-off is
 * honest and worth stating: that endpoint reaches back only a few days, which
 * is nowhere near enough history to fit a trustworthy rating from scratch.
 *
 * So this module is built to accumulate. Each run folds new results into
 * existing ratings and persists them, and the model becomes usable only after
 * weeks of collection. `ModelState.readiness` reports exactly how far along
 * that is, and the UI is expected to show it rather than quietly serving
 * predictions from four matches.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { EloModel, type EloRating, type MatchResult } from "./elo";
import { fitDixonColes, type DixonColesParams, type SoccerMatch } from "./dixon-coles";
import { SPORTS, type SportId } from "../sports/registry";
import type { OddsApiScore } from "../providers/oddsapi";

const DATA_DIR = path.join(process.cwd(), ".data");
const RATINGS_FILE = path.join(DATA_DIR, "ratings.json");
const RESULTS_FILE = path.join(DATA_DIR, "results.json");

export interface StoredResult {
  id: string;
  sportId: SportId;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  completedAt: string;
}

export type Readiness = "unfitted" | "thin" | "usable";

export interface ModelState {
  sportId: SportId;
  label: string;
  kind: "elo" | "dixon-coles";
  resultCount: number;
  competitorCount: number;
  readiness: Readiness;
  lastResultAt: string | null;
  /** What is still needed before the output should be trusted. */
  requirement: string;
  ratings?: EloRating[];
  poisson?: DixonColesParams;
}

/**
 * Results needed before a rating means anything.
 *
 * These are deliberately demanding. A rating fitted on 40 NFL games has barely
 * seen each team twice and will happily produce confident, wrong numbers.
 */
const USABLE_RESULTS: Record<SportId, number> = {
  nfl: 250,
  cfb: 500,
  mlb: 800,
  soccer: 300,
  tennis: 600,
};

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

export async function loadResults(): Promise<StoredResult[]> {
  return readJson<StoredResult[]>(RESULTS_FILE, []);
}

/**
 * Fold newly completed games into the stored result history.
 * Deduplicates on event id, so repeated polling is safe and idempotent.
 */
export async function ingestScores(
  sportId: SportId,
  scores: OddsApiScore[],
): Promise<{ added: number; total: number }> {
  const existing = await loadResults();
  const seen = new Set(existing.map((r) => r.id));
  let added = 0;

  for (const s of scores) {
    if (!s.completed || !s.scores || seen.has(s.id)) continue;

    const home = s.scores.find((x) => x.name === s.home_team);
    const away = s.scores.find((x) => x.name === s.away_team);
    const homeScore = Number(home?.score);
    const awayScore = Number(away?.score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

    existing.push({
      id: s.id,
      sportId,
      sportKey: s.sport_key,
      homeTeam: s.home_team,
      awayTeam: s.away_team,
      homeScore,
      awayScore,
      completedAt: s.last_update ?? s.commence_time,
    });
    seen.add(s.id);
    added++;
  }

  if (added > 0) await writeJson(RESULTS_FILE, existing);
  return { added, total: existing.length };
}

/** Refit every sport from stored results and persist the ratings. */
export async function refitAll(): Promise<ModelState[]> {
  const results = await loadResults();
  const states: ModelState[] = [];
  const ratingsOut: Record<string, EloRating[]> = {};

  for (const sportId of Object.keys(SPORTS) as SportId[]) {
    const spec = SPORTS[sportId];
    const mine = results
      .filter((r) => r.sportId === sportId)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

    const competitors = new Set(mine.flatMap((r) => [r.homeTeam, r.awayTeam]));
    const readiness = gradeReadiness(sportId, mine.length);
    const base: ModelState = {
      sportId,
      label: spec.label,
      kind: spec.model === "dixon-coles" ? "dixon-coles" : "elo",
      resultCount: mine.length,
      competitorCount: competitors.size,
      readiness,
      lastResultAt: mine.length ? mine[mine.length - 1].completedAt : null,
      requirement: requirementFor(sportId, mine.length, readiness),
    };

    if (mine.length === 0) {
      states.push(base);
      continue;
    }

    if (spec.model === "dixon-coles") {
      try {
        const matches: SoccerMatch[] = mine.map((r) => ({
          homeId: r.homeTeam,
          awayId: r.awayTeam,
          homeGoals: r.homeScore,
          awayGoals: r.awayScore,
          date: new Date(r.completedAt),
        }));
        base.poisson = fitDixonColes(matches);
      } catch (err) {
        base.requirement = `Fit failed: ${(err as Error).message}`;
      }
    } else {
      const elo = new EloModel(spec);
      const matchResults: MatchResult[] = mine.map((r) => ({
        homeId: r.homeTeam,
        awayId: r.awayTeam,
        homeScore: r.homeScore > r.awayScore ? 1 : r.homeScore === r.awayScore ? 0.5 : 0,
        homePoints: r.homeScore,
        awayPoints: r.awayScore,
        date: new Date(r.completedAt),
      }));
      elo.fit(matchResults);
      base.ratings = elo.all();
      ratingsOut[sportId] = base.ratings;
    }

    states.push(base);
  }

  await writeJson(RATINGS_FILE, ratingsOut);
  return states;
}

function gradeReadiness(sportId: SportId, count: number): Readiness {
  if (count === 0) return "unfitted";
  return count >= USABLE_RESULTS[sportId] ? "usable" : "thin";
}

function requirementFor(sportId: SportId, count: number, readiness: Readiness): string {
  const target = USABLE_RESULTS[sportId];
  if (readiness === "unfitted") {
    return `No results collected yet. Ratings build up as completed games are ingested; roughly ${target} are needed before the output is worth acting on.`;
  }
  if (readiness === "thin") {
    return `${count} of about ${target} results. The model will produce numbers, but they are not yet distinguishable from guesswork — keep the model weight at zero until this fills in.`;
  }
  return `${count} results collected. Enough to fit, though a backtest is still what earns this model any weight against the market.`;
}
