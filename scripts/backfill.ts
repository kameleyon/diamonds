/**
 * Backfill completed results so the rating models have something to fit.
 *
 * Run: npm run backfill -- [--budget 300] [--days 400]
 *
 * Three properties of the Big Balls API shape this script, and all three were
 * only discoverable by probing:
 *
 *   1. `page` is IGNORED. Page 1, 2 and 3 of the same query return identical
 *      rows. Walking `date` is the only pagination that works.
 *
 *   2. Passing `sport` or `league` can degrade the response to a *scores
 *      projection* -- `{scores:{value:[{match_id, home, away}]}}` with no team
 *      names, which is useless for fitting ratings. Baseball does this on every
 *      query because it has a live adapter. Omitting both parameters returns
 *      full match objects for every sport at once.
 *
 *   3. Without a date filter the list returns UPCOMING fixtures, so a naive
 *      backfill collects zero finished results and looks like a silent failure
 *      rather than a bug.
 *
 * So: one request per day, no sport filter, filter to the leagues we want
 * client-side. That covers all five sports in a single pass at roughly one
 * request per day of history.
 *
 * The walk is resumable. On a 1,000 requests/day free plan a deep backfill
 * takes a few sessions, and the cursor means each run continues where the last
 * one stopped rather than re-fetching.
 */

import { config as loadEnv } from "dotenv";

// Next reads .env.local automatically; a standalone script does not, so load it
// explicitly rather than silently running with no key.
loadEnv({ path: ".env.local", quiet: true });

import { promises as fs } from "node:fs";
import path from "node:path";
import { BigBallsClient, isPlanLimit, type BigBallsMatch } from "../src/lib/providers/bigballs";
import { loadResults, type StoredResult } from "../src/lib/models/fit-from-scores";
import type { SportId } from "../src/lib/sports/registry";

const RESULTS_FILE = path.join(process.cwd(), ".data", "results.json");
const CURSOR_FILE = path.join(process.cwd(), ".data", "backfill-cursor.json");

/**
 * League display name (as it appears in `match.league`) -> our SportId.
 *
 * Matching is on the display name, not the slug: the slug only exists as a
 * query parameter, and that parameter is the thing that breaks the response.
 */
const LEAGUE_TO_SPORT: Record<string, SportId> = {
  EPL: "soccer",
  "La Liga": "soccer",
  "Serie A": "soccer",
  Bundesliga: "soccer",
  "Ligue 1": "soccer",
  "UEFA Champions League": "soccer",
  MLS: "soccer",
  NFL: "nfl",
  NCAAF: "cfb",
  MLB: "mlb",
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function toStored(m: BigBallsMatch, sportId: SportId): StoredResult | null {
  if (m.status !== "finished") return null;
  const home = m.score?.home;
  const away = m.score?.away;
  if (typeof home !== "number" || typeof away !== "number") return null;
  if (!m.home?.name || !m.away?.name) return null;
  return {
    id: m.id,
    sportId,
    sportKey: `${m.sport}:${m.league}`,
    homeTeam: m.home.name,
    awayTeam: m.away.name,
    homeScore: home,
    awayScore: away,
    completedAt: m.kickoff_utc,
  };
}

async function main() {
  const client = BigBallsClient.fromEnv();
  if (!client) {
    console.error("BIGBALLS_API_KEY is not set in .env.local. Nothing to do.");
    process.exit(1);
  }

  const budget = Number(arg("budget", "300"));
  const maxDays = Number(arg("days", "400"));

  const me = await client.me();
  console.log(
    `\nBig Balls: ${me.email} · ${me.plan} plan · ${me.limits.per_day}/day, ${me.limits.per_minute}/min`,
  );

  await fs.mkdir(path.dirname(RESULTS_FILE), { recursive: true });
  const cursors: Record<string, number> = await fs
    .readFile(CURSOR_FILE, "utf8")
    .then((t) => JSON.parse(t) as Record<string, number>)
    .catch(() => ({}));

  const existing = await loadResults();
  const seen = new Set(existing.map((r) => r.id));
  const before = existing.length;

  const startDay = cursors.allSports ?? 0;
  let day = startDay;
  const added: Record<string, number> = {};
  let note = "";

  console.log(`Walking back from ${daysAgo(startDay)}, budget ${budget} requests.\n`);

  try {
    for (; day < startDay + maxDays && client.used < budget; day++) {
      // No `sport`, no `league`: the only combination that returns full match
      // objects for every sport.
      const { matches, projection } = await client.listMatches({
        date: daysAgo(day),
        limit: 200,
      });

      if (projection) {
        note = "API returned a scores projection unexpectedly; stopping.";
        break;
      }

      for (const m of matches) {
        const sportId = LEAGUE_TO_SPORT[m.league];
        if (!sportId) continue;
        const r = toStored(m, sportId);
        if (r && !seen.has(r.id)) {
          existing.push(r);
          seen.add(r.id);
          added[sportId] = (added[sportId] ?? 0) + 1;
        }
      }
    }
  } catch (err) {
    note = isPlanLimit(err)
      ? `Stopped at a plan limit: ${(err as Error).message}`
      : `Stopped on error: ${(err as Error).message}`;
  }

  cursors.allSports = day;
  await fs.writeFile(CURSOR_FILE, JSON.stringify(cursors, null, 2), "utf8");
  await fs.writeFile(RESULTS_FILE, JSON.stringify(existing, null, 2), "utf8");

  const totals: Record<string, number> = {};
  for (const r of existing) totals[r.sportId] = (totals[r.sportId] ?? 0) + 1;

  console.log("sport      added   stored");
  for (const s of ["soccer", "nfl", "cfb", "mlb", "tennis"]) {
    console.log(
      `${s.padEnd(10)} +${String(added[s] ?? 0).padEnd(6)} ${String(totals[s] ?? 0).padStart(6)}`,
    );
  }
  if (note) console.log(`\n${note}`);
  console.log(
    `\nScanned ${day - startDay} days back to ${daysAgo(day - 1)}. ` +
      `${client.used} requests used. Total stored: ${existing.length} (+${existing.length - before}).`,
  );
  console.log(`Re-run to continue further back. Open /model to see what is fittable.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
