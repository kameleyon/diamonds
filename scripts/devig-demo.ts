/**
 * Diagnostic: show how much the four devig methods disagree on real markets.
 *
 * Run with: npm run devig-demo
 *
 * The "disagreement" line at the bottom of each block is the one to watch. If
 * the methods differ by more than the edge you think you have found, the edge
 * is a modelling artefact, not an opportunity.
 */

import { devigAll, type DevigResult } from "../src/lib/odds/devig";
import { americanToDecimal } from "../src/lib/odds/format";

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function show(title: string, market: number[], labels: string[]): void {
  const all = devigAll(market);
  const entries = Object.entries(all) as [string, DevigResult][];
  const ref = all.shin;

  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log(`  prices     ${market.map((d) => d.toFixed(3).padStart(9)).join("")}`);
  console.log(`  overround ${pct(ref.overround)}   hold ${pct(ref.hold)}`);
  console.log(`  ${"method".padEnd(16)}${labels.map((l) => l.padStart(9)).join("")}    solver`);

  for (const [name, r] of entries) {
    const param =
      r.params.k !== undefined
        ? `k=${r.params.k.toFixed(4)}`
        : r.params.z !== undefined
          ? `z=${r.params.z.toFixed(4)}`
          : "";
    const row = r.fair.map((x) => pct(x).padStart(9)).join("");
    const flag = r.converged ? "" : "  \x1b[33m(clamped)\x1b[0m";
    console.log(`  ${name.padEnd(16)}${row}    ${param}${flag}`);
  }

  const firstCol = entries.map(([, r]) => r.fair[0]);
  const spread = Math.max(...firstCol) - Math.min(...firstCol);
  const warn = spread > 0.01 ? " \x1b[33m<- wider than most real edges\x1b[0m" : "";
  console.log(`  spread on "${labels[0]}": ${(spread * 100).toFixed(2)}pp${warn}`);
}

show("NFL spread, both sides -110", [americanToDecimal(-110), americanToDecimal(-110)], [
  "Home",
  "Away",
]);

show("MLB moneyline, heavy favourite (-300 / +250)", [
  americanToDecimal(-300),
  americanToDecimal(250),
], ["Fav", "Dog"]);

show("Soccer 1X2, lopsided (1.25 / 6.50 / 11.00)", [1.25, 6.5, 11.0], [
  "Home",
  "Draw",
  "Away",
]);

show("Tennis, near coin-flip (-125 / +105)", [
  americanToDecimal(-125),
  americanToDecimal(105),
], ["P1", "P2"]);

show("CFB outright, 9 runners, fat margin", [2.0, 10, 10, 10, 10, 10, 10, 10, 100], [
  "Fav",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "Long",
]);

console.log("");
