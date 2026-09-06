import { listBets, summarize } from "@/lib/db/bet-store";
import { getViewer } from "@/lib/auth";
import { LedgerTable } from "@/components/ledger-table";
import { ProfitCurve } from "@/components/profit-curve";
import { money, pct, signedPct } from "@/lib/display";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  // Middleware keeps unauthorised browsers off this page; reading the viewer
  // here is what scopes the query to their rows.
  const viewer = await getViewer();
  const bets = await listBets(viewer?.id ?? null);
  const s = summarize(bets);

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      {/*
        CLV leads, not profit. Over any sample a personal bettor can realistically
        reach, profit is mostly variance -- putting it in the hero slot trains
        exactly the wrong instinct.
      */}
      <section className="border-b border-slate-rule pb-6">
        <h1 className="text-[13px] text-bone-faint">Closing line value</h1>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-10 gap-y-4">
          <div>
            <div
              className={`num text-[42px] leading-none ${
                s.clv.count === 0
                  ? "text-bone-faint"
                  : s.clv.averageClvPercent > 0
                    ? "text-chalk"
                    : "text-brick"
              }`}
            >
              {s.clv.count === 0 ? "—" : signedPct(s.clv.averageClvPercent, 2)}
            </div>
            <p className="mt-1.5 text-[11.5px] text-bone-faint">
              average price beaten, {s.clv.count} bet{s.clv.count === 1 ? "" : "s"} with a close
              recorded
            </p>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Metric
              label="Beat the close"
              value={s.clv.count ? pct(s.clv.beatCloseRate, 0) : "—"}
            />
            <Metric
              label="t-statistic"
              value={s.clv.tStatistic !== null ? s.clv.tStatistic.toFixed(1) : "—"}
              hint={s.clv.tStatistic !== null && Math.abs(s.clv.tStatistic) > 2 ? "significant" : "noise"}
            />
          </div>
        </div>

        <p className="mt-4 max-w-[76ch] text-[13px] leading-relaxed text-bone-dim">
          {s.clv.verdict}
        </p>
      </section>

      <section className="mt-6 border-b border-slate-rule pb-6">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <dl className="flex flex-wrap gap-x-9 gap-y-4">
            <Metric label="Profit" value={money(s.profit)} tone={s.profit >= 0 ? "good" : "bad"} big />
            <Metric label="ROI" value={s.settledBets ? signedPct(s.roi) : "—"} big />
            <Metric label="Staked" value={money(s.staked)} />
            <Metric label="Strike rate" value={s.settledBets ? pct(s.strikeRate, 0) : "—"} />
            <Metric label="Expected" value={money(s.expectedProfit)} hint="from edge at bet time" />
            <Metric label="Open" value={String(s.openBets)} />
          </dl>

          {s.curve.length > 1 && <ProfitCurve points={s.curve} />}
        </div>

        <p className="mt-4 max-w-[76ch] text-[13px] leading-relaxed text-bone-dim">{s.verdict}</p>
      </section>

      <div className="mt-6">
        {bets.length > 0 ? (
          <LedgerTable bets={bets} />
        ) : (
          <EmptyLedger />
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
  big,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
  big?: boolean;
}) {
  const color = tone === "good" ? "text-chalk" : tone === "bad" ? "text-brick" : "text-bone";
  return (
    <div>
      <dt className="text-[11.5px] text-bone-faint">{label}</dt>
      <dd className={`num ${big ? "text-[20px]" : "text-[15px]"} mt-0.5 ${color}`}>
        {value}
        {hint && <span className="ml-1.5 text-[11px] text-bone-faint">{hint}</span>}
      </dd>
    </div>
  );
}

function EmptyLedger() {
  return (
    <div className="border border-slate-rule px-6 py-10">
      <h2 className="text-[15px] text-bone">No bets logged yet.</h2>
      <p className="mt-2 max-w-[66ch] text-[13px] leading-relaxed text-bone-dim">
        Log a bet from the board and it lands here. The field that matters most is the closing
        price — record it just before kickoff, because books take the market down once play
        starts and the number is unrecoverable after that.
      </p>
    </div>
  );
}
