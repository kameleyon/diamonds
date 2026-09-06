"use client";

import { useState, useTransition } from "react";
import type { Bet } from "@/lib/db/bet-types";
import { settleBetAction, deleteBetAction, setClosingLineAction } from "@/app/ledger/actions";
import { money, signedPct, kickoff, timeUntil, marketLabel } from "@/lib/display";

/**
 * The ledger on a phone.
 *
 * Open bets lead, because they are the only rows you can still act on: a
 * closing price has to be recorded before kickoff or it is gone forever, and
 * a settled bet is history. Settled rows move behind a tab rather than sitting
 * above the work.
 *
 * Each open row shows the ONE action it currently needs -- record the close,
 * or settle it -- rather than a full toolbar on every row.
 */
export function LedgerCards({ bets }: { bets: Bet[] }) {
  const [tab, setTab] = useState<"open" | "settled">("open");

  const open = bets.filter((b) => b.status === "open");
  const settled = bets.filter((b) => b.status !== "open");
  const rows = tab === "open" ? open : settled;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Bet status"
        className="flex border-y border-slate-rule"
      >
        <Tab active={tab === "open"} onClick={() => setTab("open")} label={`Open ${open.length}`} />
        <Tab
          active={tab === "settled"}
          onClick={() => setTab("settled")}
          label={`Settled ${settled.length}`}
        />
      </div>

      {tab === "open" && open.length > 0 && (
        <p className="px-4 py-2.5 text-[11px] text-bone-faint">
          Record the closing price before kickoff — after that it is gone.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-[13px] leading-relaxed text-bone-dim">
          {tab === "open"
            ? "No open bets. Log one from the board."
            : "Nothing settled yet."}
        </p>
      ) : (
        <ul>
          {rows.map((b) => (
            <li key={b.id}>
              {tab === "open" ? <OpenRow bet={b} /> : <SettledRow bet={b} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex-1 border-b-2 py-[11px] text-[12.5px] transition-colors ${
        active ? "border-chalk text-bone" : "border-transparent text-bone-faint"
      }`}
    >
      {label}
    </button>
  );
}

function OpenRow({ bet }: { bet: Bet }) {
  const [pending, start] = useTransition();
  const [entering, setEntering] = useState(false);
  const [closing, setClosing] = useState("");
  const [error, setError] = useState<string | null>(null);

  const started = new Date(bet.commenceTime).getTime() <= Date.now();
  const hasClose = bet.closingOdds !== undefined;
  const clv = hasClose ? bet.odds / (bet.closingOdds as number) - 1 : null;

  function saveClose() {
    const n = Number(closing);
    if (!Number.isFinite(n) || n <= 1) {
      setError("Enter a decimal price above 1.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await setClosingLineAction(bet.id, n);
      if (!r.ok) setError(r.error);
      else setEntering(false);
    });
  }

  return (
    <div className="flex items-start gap-3 border-t border-slate-rule/70 p-4">
      <div className="flex-1">
        <p className="text-[13.5px] text-bone">{bet.selection}</p>
        <p className="mt-0.5 text-[11.5px] text-bone-faint">
          {marketLabel(bet.marketKey, bet.point)} · {bet.book} ·{" "}
          <span className="num">{bet.odds.toFixed(2)}</span>
        </p>
        <p className="num mt-0.5 text-[11px] text-bone-faint">
          {money(bet.stake)} ·{" "}
          {hasClose ? (
            <>
              closed {(bet.closingOdds as number).toFixed(2)} ·{" "}
              <span className={clv && clv > 0 ? "text-chalk" : "text-brick"}>
                {signedPct(clv as number, 2)} CLV
              </span>
            </>
          ) : (
            <>
              {signedPct(bet.evAtBet)} at bet · {kickoff(bet.commenceTime)}
            </>
          )}
        </p>

        {entering && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="1.01"
              autoFocus
              value={closing}
              onChange={(e) => setClosing(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && saveClose()}
              placeholder="closing"
              aria-label={`Closing price for ${bet.selection}`}
              className="num w-24 border-b border-slate-rule bg-transparent pb-1 text-[13px] text-bone placeholder:text-bone-faint focus:border-verdigris focus:outline-none"
            />
            <button
              type="button"
              onClick={saveClose}
              disabled={pending}
              className="min-h-[40px] border border-chalk px-2.5 text-[11.5px] text-chalk disabled:opacity-40"
            >
              Save
            </button>
          </div>
        )}
        {error && <p className="mt-1 text-[11px] text-brick">{error}</p>}
      </div>

      {/* One action, chosen by what the bet actually needs next. */}
      <div className="flex shrink-0 gap-1.5">
        {!hasClose && !entering ? (
          <button
            type="button"
            onClick={() => setEntering(true)}
            className={`min-h-[40px] border px-2.5 text-[11.5px] ${
              started
                ? "border-slate-rule text-bone-faint"
                : "border-chalk text-chalk"
            }`}
          >
            {started ? "Add close" : `${timeUntil(bet.commenceTime)} out`}
          </button>
        ) : hasClose ? (
          (["won", "lost"] as const).map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() => start(() => void settleBetAction(bet.id, s))}
              className="min-h-[40px] border border-slate-rule px-2.5 text-[11.5px] text-bone-dim hover:border-verdigris disabled:opacity-40"
            >
              {s}
            </button>
          ))
        ) : null}
      </div>
    </div>
  );
}

function SettledRow({ bet }: { bet: Bet }) {
  const [pending, start] = useTransition();
  const pnl = (bet.returned ?? 0) - bet.stake;
  const clv = bet.closingOdds ? bet.odds / bet.closingOdds - 1 : null;

  return (
    <div className="flex items-start gap-3 border-t border-slate-rule/70 p-4">
      <div className="flex-1">
        <p className="text-[13.5px] text-bone">{bet.selection}</p>
        <p className="mt-0.5 text-[11.5px] text-bone-faint">
          {marketLabel(bet.marketKey, bet.point)} · {bet.book} ·{" "}
          <span className="num">{bet.odds.toFixed(2)}</span>
          {bet.closingOdds ? (
            <>
              {" "}
              · closed <span className="num">{bet.closingOdds.toFixed(2)}</span>
            </>
          ) : null}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => void deleteBetAction(bet.id))}
          className="mt-1 text-[11px] text-bone-faint hover:text-brick disabled:opacity-40"
        >
          remove
        </button>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={`num text-[14px] ${
            bet.status === "won" ? "text-chalk" : bet.status === "lost" ? "text-brick" : "text-bone-dim"
          }`}
        >
          {pnl > 0 ? `+${money(pnl)}` : money(pnl)}
        </p>
        {clv !== null && (
          <p className={`num text-[10.5px] ${clv > 0 ? "text-chalk" : "text-brick"}`}>
            {signedPct(clv, 2)} CLV
          </p>
        )}
      </div>
    </div>
  );
}
