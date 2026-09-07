import Link from "next/link";
import { buildSlate } from "@/lib/engine/slate";
import { DEFAULT_ENGINE_CONFIG, scanEvents } from "@/lib/engine/edge";
import { DEMO_EVENTS } from "@/lib/fixtures/demo-slate";
import { CheckForm } from "./check-form";
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
  const suspect = opportunities.length - credible.length;

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

      {/* The day, in two facts. */}
      <div className="flex flex-col border-t border-slate-rule md:flex-row">
        <div className="border-b border-slate-rule py-6 md:w-[380px] md:border-b-0 md:border-r md:pr-8">
          <p className="num text-[10px] tracking-[0.18em] text-bone-faint">
            TODAY
            {stalePrices && (
              <span className="ml-2 text-brick">
                · prices {Math.round((slate?.ageSeconds ?? 0) / 60)}m old
              </span>
            )}
          </p>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="num text-[42px] leading-[0.9] text-bone">
              {credible.length}
            </span>
            <span className="text-[13.5px] text-bone-dim">prices above fair value</span>
          </div>
          <p className="mt-3 max-w-[46ch] text-[12.5px] leading-relaxed text-bone-faint">
            {credible.length === 0
              ? "Nothing credible is out of line right now. That is the usual result, and betting nothing is the correct response to it."
              : `${strong} clear 3% or better.`}
            {suspect > 0 &&
              ` ${suspect} more looked like edges but rest on thin or broken evidence — the board says which.`}
          </p>
        </div>

        <div className="flex-1 py-6 md:pl-8">
          <p className="num text-[10px] tracking-[0.18em] text-bone-faint">BEST TODAY</p>
          {best ? (
            <>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="num text-[28px] leading-none text-chalk">
                  {signedPct(best.ev)}
                </span>
                <span className="text-[15px] text-bone">{best.selection}</span>
                <span className="text-[12.5px] text-bone-faint">
                  {marketLabel(best.marketKey, best.point)} · {best.sportLabel} ·{" "}
                  <span className="num">{timeUntil(best.commenceTime)} out</span>
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-[12px] text-bone-dim">
                  {best.fairSource === "pinnacle"
                    ? "Pinnacle reference"
                    : `${best.booksCounted} books`}
                </span>
                <span className="num text-[13px] text-bone">
                  {best.bestPrice.toFixed(2)} {best.bestBookTitle}
                </span>
                <span className="num ml-auto text-[13px] text-bone">
                  {money(best.stake.amount)}
                </span>
              </div>
            </>
          ) : (
            <p className="mt-3 max-w-[52ch] text-[13px] leading-relaxed text-bone-dim">
              {suspect > 0
                ? `Nothing worth showing. ${suspect} price${suspect === 1 ? "" : "s"} looked mispriced but rest on a single book or a stale line — large gaps against a sharp market are broken data, not value. `
                : "No edge to show. "}
              <Link href="/board" className="text-chalk hover:underline">
                Open the board
              </Link>{" "}
              to see what was scanned.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
