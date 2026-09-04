"use client";

import { useState, useTransition } from "react";
import type { Bet } from "@/lib/db/bet-store";
import { settleBetAction, deleteBetAction, setClosingLineAction } from "@/app/ledger/actions";
import { money, pct, signedPct, american, kickoff, marketLabel } from "@/lib/display";

/**
 * The ledger.
 *
 * Open bets sit at the top because they are the ones needing action -- a
 * closing price to record before kickoff, or a result to settle. Settled bets
 * are history and can wait below.
 */
export function LedgerTable({ bets }: { bets: Bet[] }) {
  const open = bets.filter((b) => b.status === "open");
  const settled = bets.filter((b) => b.status !== "open");

  return (
    <div className="space-y-8">
      {open.length > 0 && (
        <Section title="Open" subtitle="Record the closing price before kickoff — after that it is gone.">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <Head settledView={false} />
            <tbody>
              {open.map((b) => (
                <OpenRow key={b.id} bet={b} />
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {settled.length > 0 && (
        <Section title="Settled" subtitle={`${settled.length} bet${settled.length === 1 ? "" : "s"} closed out.`}>
          <table className="w-full min-w-[900px] border-collapse text-left">
            <Head settledView />
            <tbody>
              {settled.map((b) => (
                <SettledRow key={b.id} bet={b} />
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 pb-2">
        <h2 className="text-[14px] text-bone">{title}</h2>
        <p className="text-[11.5px] text-bone-faint">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Head({ settledView }: { settledView: boolean }) {
  return (
    <thead>
      <tr className="border-y border-slate-rule text-[11.5px] text-bone-faint">
        <th scope="col" className="py-2 pr-3 font-medium">Bet</th>
        <th scope="col" className="py-2 pr-3 font-medium">Fixture</th>
        <th scope="col" className="py-2 pr-3 text-right font-medium">Price</th>
        <th scope="col" className="py-2 pr-3 text-right font-medium">Stake</th>
        <th scope="col" className="py-2 pr-3 text-right font-medium">Edge</th>
        <th scope="col" className="py-2 pr-3 text-right font-medium">Close</th>
        <th scope="col" className="py-2 pr-3 text-right font-medium">
          {settledView ? "Result" : "Settle"}
        </th>
      </tr>
    </thead>
  );
}

function Cells({ bet }: { bet: Bet }) {
  return (
    <>
      <td className="py-3 pr-3">
        <div className="text-[13.5px] text-bone">{bet.selection}</div>
        <div className="mt-0.5 text-[11.5px] text-bone-faint">
          {marketLabel(bet.marketKey, bet.point)} · {bet.book}
        </div>
      </td>
      <td className="py-3 pr-3">
        <div className="text-[13px] text-bone-dim">{bet.fixture}</div>
        <div className="num mt-0.5 text-[11.5px] text-bone-faint">
          {bet.sportLabel} {kickoff(bet.commenceTime)}
        </div>
      </td>
      <td className="num py-3 pr-3 text-right text-[13.5px] text-bone">
        {bet.odds.toFixed(2)}
        <div className="text-[11px] text-bone-faint">{american(bet.odds)}</div>
      </td>
      <td className="num py-3 pr-3 text-right text-[13.5px] text-bone">{money(bet.stake)}</td>
      <td className="num py-3 pr-3 text-right text-[13px] text-bone-dim">
        {signedPct(bet.evAtBet)}
        <div className="text-[11px] text-bone-faint">fair {pct(bet.fairAtBet)}</div>
      </td>
    </>
  );
}

function OpenRow({ bet }: { bet: Bet }) {
  const [pending, start] = useTransition();

  return (
    <tr className="border-b border-slate-rule/70 align-top">
      <Cells bet={bet} />
      <td className="py-3 pr-3 text-right">
        <ClosingInput bet={bet} />
      </td>
      <td className="py-3 pr-3 text-right">
        <div className="flex justify-end gap-1.5">
          {(["won", "lost", "push"] as const).map((status) => (
            <button
              key={status}
              type="button"
              disabled={pending}
              onClick={() => start(() => void settleBetAction(bet.id, status))}
              className={`border px-2 py-0.5 text-[11.5px] transition-colors disabled:opacity-50 ${
                status === "won"
                  ? "border-slate-rule text-bone-dim hover:border-chalk hover:text-chalk"
                  : status === "lost"
                    ? "border-slate-rule text-bone-dim hover:border-brick hover:text-brick"
                    : "border-slate-rule text-bone-faint hover:text-bone-dim"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
        <DeleteButton id={bet.id} />
      </td>
    </tr>
  );
}

function SettledRow({ bet }: { bet: Bet }) {
  const pnl = (bet.returned ?? 0) - bet.stake;
  const clv = bet.closingOdds ? bet.odds / bet.closingOdds - 1 : null;

  return (
    <tr className="border-b border-slate-rule/70 align-top">
      <Cells bet={bet} />
      <td className="py-3 pr-3 text-right">
        {bet.closingOdds ? (
          <>
            <div className="num text-[13px] text-bone-dim">{bet.closingOdds.toFixed(2)}</div>
            <div className={`num text-[11px] ${clv && clv > 0 ? "text-chalk" : "text-brick"}`}>
              {clv !== null ? signedPct(clv, 2) : ""}
            </div>
          </>
        ) : (
          <span className="text-[11.5px] text-bone-faint">not recorded</span>
        )}
      </td>
      <td className="py-3 pr-3 text-right">
        <div
          className={`num text-[13.5px] ${
            bet.status === "won" ? "text-chalk" : bet.status === "lost" ? "text-brick" : "text-bone-dim"
          }`}
        >
          {pnl > 0 ? `+${money(pnl)}` : money(pnl)}
        </div>
        <div className="text-[11px] text-bone-faint">{bet.status}</div>
        <DeleteButton id={bet.id} />
      </td>
    </tr>
  );
}

function ClosingInput({ bet }: { bet: Bet }) {
  const [value, setValue] = useState(bet.closingOdds ? String(bet.closingOdds) : "");
  const [pending, start] = useTransition();

  function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 1) return;
    start(() => void setClosingLineAction(bet.id, n));
  }

  return (
    <input
      type="number"
      step="0.01"
      min="1.01"
      value={value}
      disabled={pending}
      placeholder="closing"
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && save()}
      aria-label={`Closing decimal price for ${bet.selection}`}
      className="num w-20 border-b border-slate-rule bg-transparent pb-0.5 text-right text-[13px] text-bone placeholder:text-bone-faint focus:border-verdigris focus:outline-none disabled:opacity-50"
    />
  );
}

function DeleteButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-1.5 text-[11px] text-bone-faint hover:text-brick"
      >
        remove
      </button>
    );
  }

  return (
    <span className="mt-1.5 flex justify-end gap-2 text-[11px]">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => void deleteBetAction(id))}
        className="text-brick hover:underline disabled:opacity-50"
      >
        delete
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-bone-faint hover:text-bone-dim">
        keep
      </button>
    </span>
  );
}
