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
  /**
   * Dixon-Coles fits, one per league.
   *
   * Never pooled across leagues. Attack and defence parameters are identified
   * only through shared opponents, and leagues barely share any -- across the
   * whole soccer dataset only the Champions League fixtures connect them. A
   * pooled fit would put Bundesliga and MLS teams on one scale with almost no
   * evidence linking them, and it costs ~40x more to compute because the
   * numerical-gradient work grows with the square of the squad count.
   */
  poissonByLeague?: Record<string, DixonColesParams>;
  /** Competitors dropped per league for having too few matches to identify. */
  excludedByLeague?: Record<string, string[]>;
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


/**
 * Drop competitors with too little evidence to be identified.
 *
 * A Dixon-Coles attack parameter is only pinned down by the matches that team
 * actually played. A club appearing once or twice -- a cup entrant, a
 * mislabelled fixture, a promoted side with a handful of games -- has almost
 * nothing constraining it, so the optimiser is free to push its parameter
 * anywhere. In practice it lands on absurd values: on the first real fit of
 * this dataset, Hull City came out top of the Premier League on +7.76 against
 * Arsenal's +1.39, purely because it had two matches.
 *
 * Those rows are not merely noisy, they are actively misleading: they sort to
 * the top of a strength table and look like the model's strongest conviction.
 * Removing them is what the data supports, so it is done before fitting and
 * reported rather than hidden.
 *
 * Removal is iterative: dropping a team also removes its opponents' matches,
 * which can push another team below the threshold.
 */
function dropThinCompetitors(
  rows: StoredResult[],
  minAppearances: number,
): { kept: StoredResult[]; dropped: string[] } {
  let current = rows;
  const dropped = new Set<string>();

  for (let pass = 0; pass < 10; pass++) {
    const counts = new Map<string, number>();
    for (const r of current) {
      counts.set(r.homeTeam, (counts.get(r.homeTeam) ?? 0) + 1);
      counts.set(r.awayTeam, (counts.get(r.awayTeam) ?? 0) + 1);
    }

    const thin = new Set(
      [...counts.entries()].filter(([, c]) => c < minAppearances).map(([t]) => t),
    );
    if (thin.size === 0) break;

    for (const t of thin) dropped.add(t);
    current = current.filter((r) => !thin.has(r.homeTeam) && !thin.has(r.awayTeam));
  }

  return { kept: current, dropped: [...dropped].sort() };
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
      const byLeague = new Map<string, StoredResult[]>();
      for (const r of mine) {
        const league = r.sportKey.split(":")[1] ?? r.sportKey;
        if (!byLeague.has(league)) byLeague.set(league, []);
        byLeague.get(league)!.push(r);
      }

      const fits: Record<string, DixonColesParams> = {};
      const excluded: Record<string, string[]> = {};
      for (const [league, rows] of byLeague) {
        // A league needs enough matches for every team to have been seen
        // several times, or the fit is noise dressed up as parameters.
        if (rows.length < 60) continue;

        // Six appearances is roughly a third of a single-round-robin season --
        // enough for a parameter to be anchored, low enough to keep genuine
        // promoted sides in.
        const { kept, dropped } = dropThinCompetitors(rows, 6);
        if (dropped.length > 0) {
          excluded[league] = dropped;
        }
        if (kept.length < 60) continue;

        try {
          const matches: SoccerMatch[] = kept.map((r) => ({
            homeId: r.homeTeam,
            awayId: r.awayTeam,
            homeGoals: r.homeScore,
            awayGoals: r.awayScore,
            date: new Date(r.completedAt),
          }));
          // Analytic gradients made a fit cost milliseconds, so iterations are
          // cheap: spend them rather than shipping a half-converged model.
          fits[league] = fitDixonColes(matches, { maxIterations: 5000 });
        } catch {
          // One league failing to converge must not take the others down.
        }
      }
      if (Object.keys(fits).length > 0) base.poissonByLeague = fits;
      if (Object.keys(excluded).length > 0) base.excludedByLeague = excluded;
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
