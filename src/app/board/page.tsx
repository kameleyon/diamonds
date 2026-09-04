import Link from "next/link";
import { buildSlate, type SlateResult } from "@/lib/engine/slate";
import { DEFAULT_ENGINE_CONFIG, scanEvents } from "@/lib/engine/edge";
import { DEMO_EVENTS } from "@/lib/fixtures/demo-slate";
import { DEFAULT_STAKE_CONFIG } from "@/lib/odds/ev";
import { SPORTS, SPORT_IDS, sportForKey, type SportId } from "@/lib/sports/registry";
import type { DevigMethod } from "@/lib/odds/devig";
import { BoardTable } from "@/components/board-table";
import { BoardControls } from "@/components/board-controls";
import { money, pct } from "@/lib/display";

// Lines move constantly; a cached board is a misleading board.
export const dynamic = "force-dynamic";

interface SearchParams {
  sports?: string;
  bankroll?: string;
  kelly?: string;
  devig?: string;
  minEv?: string;
  demo?: string;
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const sports = parseSports(sp.sports);
  const bankroll = clampNumber(sp.bankroll, 100, 10_000_000, 1000);
  const kelly = clampNumber(sp.kelly, 0.05, 1, 0.25);
  const minEv = clampNumber(sp.minEv, 0, 0.5, 0.02);
  const devigMethod = parseDevig(sp.devig);

  const engineConfig = {
    ...DEFAULT_ENGINE_CONFIG,
    devigMethod,
    minEv,
    bankroll,
    stake: { ...DEFAULT_STAKE_CONFIG, kellyMultiplier: kelly },
  };

  // Demo mode is opt-in only and never stands in for a failed live fetch. If
  // real data breaks, the board must show the break.
  const isDemo = sp.demo === "1";
  // The sport toggles must behave identically in demo mode, otherwise the
  // controls appear broken the first time anyone tries them.
  const demoEvents = DEMO_EVENTS.filter((e) => {
    const spec = sportForKey(e.sport_key);
    return spec ? sports.includes(spec.id) : false;
  });

  const slate: SlateResult = isDemo
    ? {
        opportunities: scanEvents(demoEvents, engineConfig),
        events: demoEvents,
        competitions: [],
        creditsSpent: 0,
        quota: { remaining: null, used: null, lastCost: null, checkedAt: null },
        errors: [],
        needsSetup: false,
      }
    : await buildSlate({ sports, config: engineConfig });

  if (slate.needsSetup) return <NeedsSetup />;

  const staked = slate.opportunities.reduce((a, o) => a + o.stake.amount, 0);

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-6">
      {isDemo && (
        <p className="mb-4 border-l-2 border-chalk bg-chalk/5 py-2 pl-3 text-[12.5px] text-bone-dim">
          <span className="text-chalk">Demo slate.</span> These are hand-built prices for trying
          the board out, not live lines. Remove{" "}
          <code className="num text-bone">?demo=1</code> to read the real market.
        </p>
      )}

      <BoardControls
        sports={sports}
        bankroll={bankroll}
        kelly={kelly}
        devig={devigMethod}
        minEv={minEv}
      />

      <dl className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y border-slate-rule py-3">
        <Stat label="Edges found" value={String(slate.opportunities.length)} />
        <Stat label="Fixtures scanned" value={String(slate.events.length)} />
        <Stat label="Total at risk" value={money(staked)} />
        <Stat
          label="Credits this refresh"
          value={String(slate.creditsSpent)}
          hint={
            slate.quota.remaining !== null
              ? `${slate.quota.remaining} left this month`
              : undefined
          }
        />
      </dl>

      {slate.errors.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {slate.errors.map((e, i) => (
            <li key={i} className="border-l-2 border-brick-dim pl-3 text-[12.5px] text-bone-dim">
              <span className="text-bone-faint">{e.scope}:</span> {e.message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        {slate.opportunities.length > 0 ? (
          <BoardTable opportunities={slate.opportunities} />
        ) : (
          <NoEdges
            scanned={slate.events.length}
            minEv={minEv}
            hadErrors={slate.errors.length > 0}
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[11.5px] text-bone-faint">{label}</dt>
      <dd className="num text-[14px] text-bone">
        {value}
        {hint && <span className="ml-1.5 text-[11.5px] text-bone-faint">{hint}</span>}
      </dd>
    </div>
  );
}

/**
 * An empty board is the normal state, not a failure. Most of the time no book
 * is out of line, and saying so plainly is more useful than an apologetic
 * blank screen -- the alternative is loosening the filter until noise appears,
 * which is exactly the habit this tool exists to prevent.
 */
function NoEdges({
  scanned,
  minEv,
  hadErrors,
}: {
  scanned: number;
  minEv: number;
  hadErrors: boolean;
}) {
  return (
    <div className="border border-slate-rule px-6 py-10">
      <h2 className="text-[15px] text-bone">No price is far enough out of line right now.</h2>
      <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-bone-dim">
        {scanned > 0 ? (
          <>
            Scanned {scanned} fixture{scanned === 1 ? "" : "s"} and found nothing clearing{" "}
            <span className="num">{pct(minEv)}</span>. That is the usual result — books agree
            with each other most of the time, and the honest response is to bet nothing.
          </>
        ) : hadErrors ? (
          <>No fixtures came back. The notes above say why.</>
        ) : (
          <>
            No fixtures are scheduled in the selected sports. Widen the selection or come back
            closer to a matchday.
          </>
        )}
      </p>
      <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-bone-faint">
        Lowering the edge threshold will produce rows, but they will mostly be devig noise
        rather than opportunities.
      </p>
    </div>
  );
}

function NeedsSetup() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 py-16">
      <div className="max-w-[62ch]">
        <h1 className="text-[22px] text-bone">Add an odds key to start.</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-bone-dim">
          The board reads live prices from The Odds API. Without a key there is nothing to
          compare, so every other screen stays empty too.
        </p>
        <Link
          href="/setup"
          className="mt-5 inline-block border border-chalk px-4 py-2 text-[13px] text-chalk hover:bg-chalk hover:text-slate-ground"
        >
          Open setup
        </Link>
      </div>
    </div>
  );
}

function parseSports(raw?: string): SportId[] {
  if (!raw) return ["nfl", "mlb", "soccer"];
  const wanted = raw.split(",").filter((s): s is SportId => s in SPORTS);
  return wanted.length > 0 ? wanted : SPORT_IDS;
}

function parseDevig(raw?: string): DevigMethod {
  const valid: DevigMethod[] = ["shin", "power", "multiplicative", "additive"];
  return valid.includes(raw as DevigMethod) ? (raw as DevigMethod) : "shin";
}

function clampNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
