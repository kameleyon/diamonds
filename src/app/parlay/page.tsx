import { buildSlate } from "@/lib/engine/slate";
import { DEFAULT_ENGINE_CONFIG, scanEvents } from "@/lib/engine/edge";
import { DEMO_EVENTS } from "@/lib/fixtures/demo-slate";
import { ParlayBuilder } from "@/components/mobile/parlay-builder";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Parlay builder.
 *
 * Legs are drawn from the same slate the board scans, so a leg can only be
 * added if the engine already priced it and found an edge. That is deliberate:
 * a parlay assembled from arbitrary picks has no EV to compound, and this
 * screen's entire argument is about compounding.
 */
export default async function ParlayPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const sp = await searchParams;
  const config = { ...DEFAULT_ENGINE_CONFIG, minEv: 0.01, bankroll: 1000 };

  const opportunities =
    sp.demo === "1"
      ? scanEvents(DEMO_EVENTS, config)
      : (await buildSlate({ sports: ["nfl", "mlb", "soccer"], config })).opportunities;

  if (opportunities.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-5 py-10">
        <div className="max-w-[62ch] border border-slate-rule px-6 py-10">
          <h1 className="text-[15px] text-bone">Nothing to parlay.</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-bone-dim">
            Legs come from the board, and the board has no prices above fair value right now. A
            parlay built from bets that are not individually +EV compounds the house edge rather
            than yours.
          </p>
          <Link
            href="/board"
            className="mt-5 inline-block border border-slate-rule px-4 py-2 text-[13px] text-bone-dim hover:border-verdigris hover:text-bone"
          >
            Back to the board
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[560px] md:px-5 md:py-6">
      <ParlayBuilder opportunities={opportunities} />
    </div>
  );
}
