import type { Opportunity } from "@/lib/engine/edge";
import { ValueLadder, LadderLegend } from "./value-ladder";
import { LogBetButton } from "./log-bet-button";
import { ExplainButton } from "./explain-button";
import { pct, signedPct, money, american, kickoff, timeUntil, marketLabel, matchup } from "@/lib/display";

/**
 * The board.
 *
 * A table, not a grid of cards. The entire task is comparing edges against each
 * other down a column, and cards would break that scan. Labels sit left,
 * numerals right, and every claimed edge carries its evidence on the line
 * beneath it -- an edge you cannot audit is an edge you should not take.
 */
export function BoardTable({ opportunities }: { opportunities: Opportunity[] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-6 pb-3">
        <p className="text-[13px] text-bone-dim">
          {opportunities.length} price{opportunities.length === 1 ? "" : "s"} above fair value,
          best first.
        </p>
        <LadderLegend />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="border-y border-slate-rule text-[11.5px] text-bone-faint">
              <th scope="col" className="py-2 pr-3 font-medium">
                Edge
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Fixture
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Bet
              </th>
              <th scope="col" className="w-[178px] py-2 pr-3 font-medium">
                Value
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Fair
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Price
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Stake
              </th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <Row key={`${o.eventId}-${o.marketKey}-${o.selection}-${o.point ?? ""}`} o={o} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ o }: { o: Opportunity }) {
  const offeredImplied = 1 / o.bestPrice;
  const hasNotes = o.warnings.length > 0;

  return (
    <tr className="border-b border-slate-rule/70 align-top">
      <td className="py-3 pr-3">
        <div
          className={`num text-[17px] font-medium leading-none ${
            o.confidence === "low" ? "text-chalk-dim" : "text-chalk"
          }`}
        >
          {signedPct(o.ev)}
        </div>
        <ConfidenceMark confidence={o.confidence} />
      </td>

      <td className="py-3 pr-3">
        <div className="text-[13.5px] text-bone">{matchup(o.homeTeam, o.awayTeam)}</div>
        <div className="mt-0.5 text-[11.5px] text-bone-faint">
          {o.sportLabel} <span className="num">{kickoff(o.commenceTime)}</span> ·{" "}
          <span className="num">{timeUntil(o.commenceTime)}</span> out
        </div>
      </td>

      <td className="py-3 pr-3">
        <div className="text-[13.5px] text-bone">{o.selection}</div>
        <div className="mt-0.5 text-[11.5px] text-bone-faint">
          {marketLabel(o.marketKey, o.point)}
        </div>
      </td>

      <td className="py-3 pr-3">
        <ValueLadder fair={o.fairProbability} offeredImplied={offeredImplied} />
        <div className="mt-0.5 text-[11px] text-bone-faint">
          {o.fairSource === "pinnacle"
            ? "Pinnacle"
            : o.fairSource === "sharp-consensus"
              ? `${o.booksCounted} sharp books`
              : `${o.booksCounted} soft books`}
        </div>
      </td>

      <td className="py-3 pr-3 text-right">
        <div className="num text-[13.5px] text-bone">{pct(o.fairProbability)}</div>
        <div className="num mt-0.5 text-[11px] text-bone-faint">
          need {pct(offeredImplied)}
        </div>
      </td>

      <td className="py-3 pr-3 text-right">
        <div className="num text-[13.5px] text-bone">{o.bestPrice.toFixed(2)}</div>
        <div className="mt-0.5 text-[11px] text-bone-faint">
          <span className="num">{american(o.bestPrice)}</span> · {o.bestBookTitle}
        </div>
      </td>

      <td className="py-3 pr-3 text-right">
        <div className="num text-[13.5px] text-bone">{money(o.stake.amount)}</div>
        <div className="num mt-0.5 text-[11px] text-bone-faint">
          {o.stake.limitedBy === "not-credible" ? (
            <span className="text-brick">not credible</span>
          ) : (
            pct(o.stake.fraction, 2)
          )}
        </div>
        <LogBetButton opportunity={o} />
        <ExplainButton opportunity={o} />
        {hasNotes && (
          <details className="mt-1.5 text-right">
            <summary className="cursor-pointer list-none text-[11px] text-brick hover:text-bone-dim">
              {o.warnings.length} caveat{o.warnings.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1.5 space-y-1 text-left text-[11.5px] leading-snug text-bone-dim">
              {o.warnings.map((w, i) => (
                <li key={i} className="border-l border-brick-dim pl-2">
                  {w}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
    </tr>
  );
}

/**
 * Confidence is about the quality of the evidence, not the size of the edge, so
 * it is drawn as filled ticks rather than a coloured badge -- a badge would
 * compete with the edge figure it is qualifying.
 */
function ConfidenceMark({ confidence }: { confidence: Opportunity["confidence"] }) {
  const filled = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  return (
    <div className="mt-1.5 flex items-center gap-[3px]" title={`${confidence} confidence evidence`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={`h-[3px] w-[7px] ${i < filled ? "bg-verdigris" : "bg-slate-rule-strong"}`}
        />
      ))}
      <span className="sr-only">{confidence} confidence</span>
    </div>
  );
}
