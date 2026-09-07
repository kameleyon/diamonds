import type { Opportunity } from "@/lib/engine/edge";
import { signedPct, money, timeUntil, marketLabel, pct } from "@/lib/display";
import { LogBetButton } from "./log-bet-button";

/**
 * Every edge, ranked — not just the best one.
 *
 * Credible rows come first and in full. Rows the engine does not believe are
 * kept, but pushed below and dimmed, with the reason attached: hiding them
 * entirely would leave you wondering why a bet you can see at a book is missing,
 * and promoting them would repeat the mistake of treating a large number as a
 * good one.
 */
export function EdgeList({
  credible,
  suspect,
}: {
  credible: Opportunity[];
  suspect: Opportunity[];
}) {
  return (
    <div>
      {credible.length > 0 && (
        <ul>
          {credible.map((o) => (
            <li key={key(o)}>
              <EdgeRow o={o} />
            </li>
          ))}
        </ul>
      )}

      {suspect.length > 0 && (
        <details className="mt-4 border-t border-slate-rule pt-3">
          <summary className="cursor-pointer text-[12.5px] text-bone-faint hover:text-bone-dim">
            {suspect.length} more looked like edges but are not credible — show them
          </summary>
          <p className="mt-2 max-w-[76ch] text-[12px] leading-relaxed text-bone-faint">
            Large gaps against a sharp market are evidence of a stale price, a pulled market or a
            thin exchange book — not of value. These are staked at zero.
          </p>
          <ul className="mt-2">
            {suspect.map((o) => (
              <li key={key(o)}>
                <EdgeRow o={o} muted />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function key(o: Opportunity): string {
  return `${o.eventId}-${o.marketKey}-${o.selection}-${o.point ?? ""}`;
}

function EdgeRow({ o, muted = false }: { o: Opportunity; muted?: boolean }) {
  const soon = new Date(o.commenceTime).getTime() - Date.now() < 4 * 3_600_000;

  return (
    <article className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-rule/70 py-3">
      <span
        className={`num w-[68px] shrink-0 text-[17px] ${muted ? "text-chalk-dim" : "text-chalk"}`}
      >
        {signedPct(o.ev)}
      </span>

      <span className="min-w-[180px] flex-1">
        <span className="block text-[14px] text-bone">{o.selection}</span>
        <span className="mt-0.5 block text-[11.5px] text-bone-faint">
          {marketLabel(o.marketKey, o.point)} · {o.sportLabel}
          {o.awayTeam && o.homeTeam ? ` · ${o.awayTeam} at ${o.homeTeam}` : ""} ·{" "}
          <span className={`num ${soon ? "text-brick" : ""}`}>
            {timeUntil(o.commenceTime)} out
          </span>
        </span>
      </span>

      <span className="min-w-[140px] text-[11.5px] text-bone-faint">
        <span className="block">
          {o.fairSource === "pinnacle"
            ? "Pinnacle"
            : o.fairSource === "sharp-consensus"
              ? `${o.booksCounted} sharp books`
              : `${o.booksCounted} soft books`}{" "}
          <span className="num text-bone-dim">{pct(o.fairProbability)}</span>
        </span>
        <span className="num mt-0.5 block text-bone-dim">
          {o.bestPrice.toFixed(2)} {o.bestBookTitle}
        </span>
      </span>

      <span className="ml-auto shrink-0 text-right">
        <span className="num block text-[13.5px] text-bone">{money(o.stake.amount)}</span>
        {o.stake.limitedBy === "not-credible" ? (
          <span className="block text-[11px] text-brick">not credible</span>
        ) : (
          <LogBetButton opportunity={o} />
        )}
      </span>

      {o.warnings.length > 0 && (
        <p className="w-full border-l-2 border-brick-dim pl-2.5 text-[11.5px] leading-relaxed text-bone-dim">
          {o.warnings[0]}
        </p>
      )}
    </article>
  );
}
