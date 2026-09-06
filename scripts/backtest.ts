/**
 * Walk-forward backtest over the stored results.
 *
 * Run: npm run backtest -- [--warmup 120] [--refit 15]
 *
 * This is the gate on model weight. Until a model shows skill here, its weight
 * on the board stays at zero and the board runs on market edge alone.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

import { loadResults } from "../src/lib/models/fit-from-scores";
import { backtestAll, type BacktestReport } from "../src/lib/backtest/backtest";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

function bar(predicted: number, actual: number): string {
  // A compact reliability cue: where actual sits relative to predicted.
  const diff = actual - predicted;
  const n = Math.min(6, Math.round(Math.abs(diff) * 40));
  if (n === 0) return "·";
  return diff > 0 ? "▲".repeat(n) : "▼".repeat(n);
}

function report(r: BacktestReport): void {
  console.log(`\n${"─".repeat(78)}`);
  console.log(`${r.label}  ·  ${r.model}`);
  console.log(
    `  scored ${r.scored}   skipped ${r.skipped}` + (r.refits ? `   refits ${r.refits}` : ""),
  );
  if (r.scored === 0) {
    console.log("  nothing scoreable");
    return;
  }

  console.log(
    `  log loss  ${r.logLoss.toFixed(4)}   baseline ${r.baseline.logLoss.toFixed(4)}   ` +
      `skill ${(r.skill * 100).toFixed(1)}%`,
  );
  console.log(
    `  brier     ${r.brier.toFixed(4)}   baseline ${r.baseline.brier.toFixed(4)}`,
  );
  console.log(
    `  accuracy  ${(r.accuracy * 100).toFixed(1)}%   baseline ${(r.baseline.accuracy * 100).toFixed(1)}%   ` +
      `calibration error ${(r.calibrationError * 100).toFixed(1)}%`,
  );

  const rows = r.calibration.filter((b) => b.count >= 20);
  if (rows.length) {
    console.log("  calibration:  band    n     said    happened");
    for (const b of rows) {
      console.log(
        `                ${(b.from * 100).toFixed(0).padStart(2)}-${(b.to * 100).toFixed(0).padEnd(3)} ` +
          `${String(b.count).padStart(5)}  ${(b.predicted * 100).toFixed(1).padStart(6)}%  ` +
          `${(b.actual * 100).toFixed(1).padStart(6)}%  ${bar(b.predicted, b.actual)}`,
      );
    }
  }

  console.log(`\n  ${r.verdict}`);
}

async function main() {
  const results = await loadResults();
  if (results.length === 0) {
    console.error("No stored results. Run `npm run backfill` first.");
    process.exit(1);
  }

  const warmup = arg("warmup", 120);
  const refitEvery = arg("refit", 15);

  console.log(
    `\nWalk-forward backtest over ${results.length} stored results ` +
      `(warm-up ${warmup}, Dixon-Coles refit every ${refitEvery}).`,
  );

  const t0 = Date.now();
  const reports = backtestAll(results, { warmup, refitEvery });
  for (const r of reports) report(r);

  console.log(`\n${"─".repeat(78)}`);
  console.log("SUMMARY  (skill = improvement over base rate on log loss)\n");
  const sorted = [...reports].sort((a, b) => b.skill - a.skill);
  for (const r of sorted) {
    const verdict = r.scored < 100 ? "too few" : r.skill > 0.02 ? "has skill" : "no skill";
    console.log(
      `  ${r.label.padEnd(28)} ${r.model.padEnd(13)} ` +
        `n=${String(r.scored).padStart(5)}  skill ${(r.skill * 100).toFixed(1).padStart(6)}%   ${verdict}`,
    );
  }

  console.log(
    `\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.\n` +
      `Skill here means the model beats a base-rate guess. It does NOT mean it beats\n` +
      `the market — that needs historical closing odds, which no current data source\n` +
      `provides on its plan.\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
