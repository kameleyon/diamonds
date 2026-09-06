"use client";

import { useMemo, useState } from "react";
import { analyzeParlay, type ParlayLeg } from "@/lib/odds/parlay";
import { recommendedStake } from "@/lib/odds/ev";
import type { Opportunity } from "@/lib/engine/edge";
import { money, pct, signedPct, marketLabel } from "@/lib/display";

/**
 * Parlay builder.
 *
 * The screen exists to make one fact impossible to miss: multiplication
 * magnifies whatever sign you feed it. Independent legs compound as
 * prod(1 + EV_i) - 1, so three legs at +3% reach +9.3% -- and three legs at a
 * normal vigged -5% reach -14.3%.
 *
 * So the candidate list below the ticket shows, for every board row not yet
 * added, what the combined EV WOULD become. A negative leg advertises the
 * damage it does before you add it, rather than after.
 */
export function ParlayBuilder({ opportunities }: { opportunities: Opportunity[] }) {
  const [legIds, setLegIds] = useState<string[]>([]);
  const [bankroll] = useState(1000);

  const key = (o: Opportunity) =>
    `${o.eventId}|${o.marketKey}|${o.selection}|${o.point ?? ""}`;

  const byKey = useMemo(
    () => new Map(opportunities.map((o) => [key(o), o])),
    [opportunities],
  );

  const toLeg = (o: Opportunity): ParlayLeg => ({
    id: key(o),
    label: o.selection,
    // The blended/consensus probability the engine already sized the single
    // bet with -- not a fresh guess.
    probability: o.usedProbability,
    decimalOdds: o.bestPrice,
  });

  const legs = legIds.map((id) => byKey.get(id)).filter(Boolean) as Opportunity[];
  const analysis = legs.length >= 2 ? analyzeParlay(legs.map(toLeg)) : null;

  const stake = analysis && analysis.ev > 0
    ? recommendedStake(analysis.combinedProbability, analysis.combinedOdds, bankroll)
    : null;

  /** What the combined EV becomes if this candidate is added. */
  function evWith(candidate: Opportunity): number | null {
    const next = [...legs, candidate];
    if (next.length < 2) return null;
    return analyzeParlay(next.map(toLeg)).ev;
  }

  const candidates = opportunities.filter((o) => !legIds.includes(key(o)));

  return (
    <div>
      <header className="flex items-baseline gap-2.5 border-b border-slate-rule px-4 py-3.5">
        <h1 className="text-[14px] font-semibold tracking-[0.14em]" style={{ fontStretch: "112%" }}>
          PARLAY
        </h1>
        <span className="text-[11.5px] text-bone-faint">
          {legs.length} leg{legs.length === 1 ? "" : "s"}
        </span>
      </header>

      {analysis ? (
        <section className="border-b border-slate-rule p-4">
          <p className="num text-[10px] tracking-[0.18em] text-bone-faint">COMBINED EV</p>
          <p
            className={`num mt-2.5 text-[44px] leading-[0.9] ${
              analysis.ev > 0 ? "text-chalk" : "text-brick"
            }`}
          >
            {signedPct(analysis.ev)}
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-bone-dim">
            {analysis.allLegsPositive
              ? "Multiplication magnifies whatever sign you feed it. Every leg here is independently positive, which is the only condition under which this number is real."
              : "At least one leg is negative on its own. Multiplication compounds that too — positive legs cannot rescue it."}
          </p>
          <p className="num mt-2.5 text-[11.5px] text-bone-faint">
            ∏(1 + EVᵢ) − 1 · price {analysis.combinedOdds.toFixed(2)}
            {stake && stake.amount > 0 ? ` · stake ${money(stake.amount)}` : ""}
          </p>
        </section>
      ) : (
        <section className="border-b border-slate-rule p-4">
          <p className="text-[13px] leading-relaxed text-bone-dim">
            Add two or more legs from the board below. A parlay is only ever correct when every
            leg is independently +EV — this screen will not let you forget which ones are not.
          </p>
        </section>
      )}

      {legs.map((o) => (
        <LegRow
          key={key(o)}
          o={o}
          onRemove={() => setLegIds((ids) => ids.filter((i) => i !== key(o)))}
        />
      ))}

      {analysis && (
        <section className="border-b border-slate-rule p-4">
          <Row label={`Returns if all ${legs.length} land`} value={money(analysis.combinedOdds * (stake?.amount ?? 0))} />
          <Row label={`Chance all ${legs.length} land`} value={pct(analysis.combinedProbability)} />
          <p className="mt-3 text-[11px] leading-relaxed text-bone-faint">
            Correlated legs break the independence this arithmetic assumes. Two markets in the
            same fixture are not two bets.
          </p>
        </section>
      )}

      {candidates.length > 0 && (
        <section>
          <h2 className="border-b border-slate-rule px-4 py-2.5 text-[11px] text-bone-faint">
            {legs.length >= 1 ? "Add a leg — effect shown before you commit" : "Available from the board"}
          </h2>
          {candidates.map((o) => {
            const would = evWith(o);
            const harmful = would !== null && analysis !== null && would < analysis.ev;
            return (
              <button
                key={key(o)}
                type="button"
                onClick={() => setLegIds((ids) => [...ids, key(o)])}
                className={`flex w-full items-start gap-3 border-b border-slate-rule/70 p-4 text-left ${
                  harmful ? "bg-brick/[0.05]" : ""
                }`}
              >
                <span
                  className={`num w-[52px] shrink-0 text-[14px] ${
                    o.ev > 0 ? "text-chalk" : "text-brick"
                  }`}
                >
                  {signedPct(o.ev)}
                </span>
                <span className="flex-1">
                  <span className="block text-[13.5px] text-bone">{o.selection}</span>
                  <span className="mt-0.5 block text-[11px] text-bone-faint">
                    {o.sportLabel} {marketLabel(o.marketKey, o.point)} ·{" "}
                    <span className="num">{o.bestPrice.toFixed(2)}</span> {o.bestBookTitle}
                  </span>
                  {would !== null && analysis !== null && (
                    <span
                      className={`mt-1.5 block text-[11.5px] leading-relaxed ${
                        harmful ? "text-brick" : "text-bone-dim"
                      }`}
                    >
                      Combined EV would {harmful ? "fall" : "rise"} to {signedPct(would)}.
                    </span>
                  )}
                </span>
                <span aria-hidden className="text-[12px] text-bone-faint">
                  ＋
                </span>
              </button>
            );
          })}
        </section>
      )}

      {analysis && analysis.warnings.length > 0 && (
        <section className="p-4">
          <ul className="space-y-2">
            {analysis.warnings.map((w, i) => (
              <li key={i} className="border-l-2 border-brick-dim pl-2.5 text-[11.5px] leading-relaxed text-bone-dim">
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LegRow({ o, onRemove }: { o: Opportunity; onRemove: () => void }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-rule/70 p-4">
      <span className={`num w-[52px] shrink-0 text-[14px] ${o.ev > 0 ? "text-chalk" : "text-brick"}`}>
        {signedPct(o.ev)}
      </span>
      <div className="flex-1">
        <p className="text-[13.5px] text-bone">{o.selection}</p>
        <p className="mt-0.5 text-[11px] text-bone-faint">
          {o.sportLabel} {marketLabel(o.marketKey, o.point)} ·{" "}
          <span className="num">{o.bestPrice.toFixed(2)}</span> {o.bestBookTitle}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${o.selection}`}
        className="min-h-[44px] px-2 text-[12px] text-bone-faint hover:text-brick"
      >
        ✕
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 flex items-baseline text-[12.5px] first:mt-0">
      <span className="text-bone-dim">{label}</span>
      <span className="num ml-auto text-bone">{value}</span>
    </div>
  );
}
