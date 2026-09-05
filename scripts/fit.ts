/**
 * Fit the rating models offline and persist them.
 *
 * Run: npm run fit
 *
 * The Model tab refits on load too -- with analytic gradients the whole thing
 * takes a fraction of a second, so there is no reason to serve a stale fit.
 * This script exists to inspect the fit from the terminal after a backfill, and
 * to make convergence problems visible: a league marked "!" did not converge
 * and its parameters should not be trusted.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { refitAll } from "../src/lib/models/fit-from-scores";

async function main() {
  const t0 = Date.now();
  const states = await refitAll();

  console.log("\nsport      readiness   results  detail");
  for (const s of states) {
    const detail = s.ratings
      ? `${s.ratings.length} rated · top ${s.ratings[0]?.competitorId} ${Math.round(s.ratings[0]?.rating ?? 0)}`
      : s.poissonByLeague
        ? Object.entries(s.poissonByLeague)
            .map(([l, f]) => `${l}(${f.matchCount}${f.converged ? "" : "!"})`)
            .join(" ")
        : "—";
    console.log(
      `${s.sportId.padEnd(10)} ${s.readiness.padEnd(11)} ${String(s.resultCount).padStart(5)}  ${detail}`,
    );
  }
  console.log(`\nFitted in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
