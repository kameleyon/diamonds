import Link from "next/link";
import { buildSlate } from "@/lib/engine/slate";
import { DEFAULT_ENGINE_CONFIG, scanEvents } from "@/lib/engine/edge";
import { DEMO_EVENTS } from "@/lib/fixtures/demo-slate";
import { CheckForm } from "./check-form";
import { EdgeList } from "@/components/edge-list";
import { signedPct, money, timeUntil, marketLabel } from "@/lib/display";

export const dynamic = "force-dynamic";

/**
 * The landing screen.
 *
 * One question, one input. Below it, exactly two facts about the day — how many
 * prices are above fair value, and the single best one. Not a dashboard: the
 * board is one tap away for anyone who wants the full list.
 */
export default async function CheckPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const sp = await searchParams;
  const demo = sp.demo === "1";

  const slate = demo
    ? null
    : await buildSlate({ sports: ["nfl", "mlb", "soccer"], config: DEFAULT_ENGINE_CONFIG });

  const opportunities = demo ? scanEvents(DEMO_EVENTS, DEFAULT_ENGINE_CONFIG) : slate!.opportunities;

  /*
   * Whatever went wrong must be visible here.
   *
   * This page previously dropped the slate's errors, so an exhausted API quota
   * rendered as "0 prices above fair value" -- indistinguishable from a quiet
   * market. A tool built on auditable evidence cannot hide why it has nothing
   * to say.
   */
  const notices = slate?.errors ?? [];
  const stalePrices = Boolean(slate?.fromCache && (slate?.ageSeconds ?? 0) > 900);

  /*
   * "Best" means the best BET, not the biggest number.
   *
   * `opportunities` is sorted by raw EV, and the top of that list is reliably
   * the least trustworthy row: against a sharp reference a huge gap is evidence
   * of a stale or broken price, not of value. Promoting it here was showing a
   * +105% soccer moneyline priced by one soft book as the day's headline, while
   * the engine itself had graded it low confidence and staked it at zero.
   *
   * So the headline is the best row the engine actually believes.
   */
  const credible = opportunities.filter(
    (o) => o.confidence !== "low" && o.stake.amount > 0,
  );
  const best = credible[0];
  const strong = credible.filter((o) => o.ev >= 0.03).length;
  const suspectRows = opportunities.filter(
    (o) => !(o.confidence !== "low" && o.stake.amount > 0),
  );
  const suspect = suspectRows.length;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-49px)] max-w-[1400px] flex-col px-5">
      <div className="flex flex-1 items-center py-12 md:py-16">
        <div className="w-full max-w-[760px]">
          <h1 className="text-[28px] font-normal leading-tight tracking-[-0.01em] text-bone md:text-[34px]">
            Should you take this bet?
          </h1>
          <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-bone-dim md:text-[14.5px]">
            Paste it as you would say it. The engine prices it against the sharp market and tells
            you whether the number is worth the money — or, if the game has already played,
            whether it was worth it at the time.
          </p>

          <div className="mt-7">
            <CheckForm demo={demo} />
          </div>
        </div>
      </div>

      {notices.length > 0 && (
        <ul className="mb-6 space-y-1.5">
          {notices.map((n, i) => (
            <li
              key={i}
              className="border-l-2 border-brick-dim pl-3 text-[12.5px] leading-relaxed text-bone-dim"
            >
              <span className="text-bone-faint">{n.scope}:</span> {n.message}
            </li>
          ))}
        </ul>
      )}

      {/* Every edge, ranked. Showing one when there are fourteen answers the
          wrong question -- the point of the board is comparison. */}
      <div className="border-t border-slate-rule py-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="num text-[10px] tracking-[0.18em] text-bone-faint">
            TODAY
            {stalePrices && (
              <span className="ml-2 text-brick">
                · prices {Math.round((slate?.ageSeconds ?? 0) / 60)}m old
              </span>
            )}
          </p>
          <span className="num text-[26px] leading-none text-bone">{credible.length}</span>
          <span className="text-[13px] text-bone-dim">
            worth acting on
            {strong > 0 ? `, ${strong} at 3% or better` : ""}
          </span>
          <Link
            href="/board"
            className="ml-auto text-[12.5px] text-bone-faint hover:text-chalk"
          >
            Full board →
          </Link>
        </div>

        <div className="mt-4">
          {credible.length === 0 && suspect === 0 ? (
            <p className="max-w-[62ch] text-[13px] leading-relaxed text-bone-dim">
              Nothing is out of line right now. That is the usual result, and betting nothing is
              the correct response to it.
            </p>
          ) : (
            <EdgeList credible={credible} suspect={suspectRows} />
          )}
        </div>
      </div>
    </div>
  );
}
