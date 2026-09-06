import type { Opportunity } from "@/lib/engine/edge";
import { PriceTrack } from "./price-track";
import { LogBetButton } from "../log-bet-button";
import { pct, signedPct, money, timeUntil, marketLabel } from "@/lib/display";

/**
 * The board on a phone.
 *
 * The desktop table is a comparison instrument -- seven columns you scan down.
 * That does not survive a 390px screen, so the phone gets a different
 * structure rather than a squashed table: one card per opportunity, with the
 * edge at headline scale and the evidence on a footer line.
 *
 * What does NOT change is which claims are visible. Every caveat the desktop
 * board shows appears here too, above the stake rather than behind a tap. A
 * mobile layout that hides the warnings to save space would invert the whole
 * point of the app.
 */
export function BoardCards({ opportunities }: { opportunities: Opportunity[] }) {
  return (
    <div>
      <Legend />
      <ul>
        {opportunities.map((o) => (
          <li key={`${o.eventId}-${o.marketKey}-${o.selection}-${o.point ?? ""}`}>
            <BoardCard o={o} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3.5 border-b border-slate-rule px-4 py-2.5 text-[10.5px] text-bone-faint">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[11px] w-px bg-verdigris" />
        sharp fair
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[7px] w-[7px] rotate-45 bg-chalk" />
        on offer
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-[3px] w-3.5 bg-chalk" />
        edge
      </span>
    </div>
  );
}

function BoardCard({ o }: { o: Opportunity }) {
  const offeredImplied = 1 / o.bestPrice;
  const suspect = o.confidence === "low";
  const soon = new Date(o.commenceTime).getTime() - Date.now() < 4 * 3_600_000;

  const fairSourceLabel =
    o.fairSource === "pinnacle"
      ? "Pinnacle"
      : o.fairSource === "sharp-consensus"
        ? `${o.booksCounted} sharp`
        : `${o.booksCounted} soft`;

  return (
    <article className="border-b border-slate-rule/70 p-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[15.5px] text-bone">{o.selection}</h3>
        <span
          className={`num ml-auto text-[19px] font-medium ${
            suspect ? "text-chalk-dim" : "text-chalk"
          }`}
        >
          {signedPct(o.ev)}
        </span>
      </div>

      <p className="mt-[3px] text-[11.5px] text-bone-faint">
        {marketLabel(o.marketKey, o.point)} · {o.sportLabel}
        {o.awayTeam && o.homeTeam ? ` · ${o.awayTeam} at ${o.homeTeam}` : ""} ·{" "}
        <span className={`num ${soon ? "text-brick" : ""}`}>{timeUntil(o.commenceTime)} out</span>
      </p>

      <PriceTrack
        fair={o.fairProbability}
        offeredImplied={offeredImplied}
        price={o.bestPrice}
        book={o.bestBookTitle}
        fairSource={fairSourceLabel}
        muted={suspect}
      />

      {/* The evidence footer. Confidence, then either the stake or the reason
          there is no stake -- never a bare number with the caveat elsewhere. */}
      <div className="mt-3 border-t border-slate-rule pt-[11px]">
        {o.warnings.length > 0 ? (
          <div className="flex items-start gap-2.5">
            <ConfidenceTicks confidence={o.confidence} className="pt-1" />
            <p className="text-[11.5px] leading-relaxed text-brick">
              {o.warnings[0]}{" "}
              {o.stake.amount <= 0 && (
                <span className="text-bone-dim">Stake held at {money(0)}.</span>
              )}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <ConfidenceTicks confidence={o.confidence} />
            <span className="text-[11px] text-bone-dim">{evidenceSummary(o)}</span>
            <span className="num ml-auto text-[13px] text-bone">{money(o.stake.amount)}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-4">
        <LogBetButton opportunity={o} />
        <span className="num text-[11px] text-bone-faint">
          need {pct(offeredImplied)} · fair {pct(o.fairProbability)}
        </span>
      </div>
    </article>
  );
}

/** Plain-language reading of where the fair price came from. */
function evidenceSummary(o: Opportunity): string {
  if (o.fairSource === "pinnacle") return "Pinnacle reference";
  if (o.fairSource === "sharp-consensus") return `${o.booksCounted} sharp books`;
  return `exchange, no Pinnacle`;
}

function ConfidenceTicks({
  confidence,
  className = "",
}: {
  confidence: Opportunity["confidence"];
  className?: string;
}) {
  const filled = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  return (
    <div className={`flex shrink-0 gap-[3px] ${className}`} title={`${confidence} confidence`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={`h-[3px] w-2 ${i < filled ? "bg-verdigris" : "bg-slate-rule-strong"}`}
        />
      ))}
      <span className="sr-only">{confidence} confidence evidence</span>
    </div>
  );
}
