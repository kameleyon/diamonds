"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The top rail.
 *
 * Three destinations, named the way the work is actually named: the board is
 * where live prices are read, the model is where the forecast comes from, the
 * ledger is where the money is recorded. Deliberately thin -- this is a tool
 * bar, not a header, and every pixel it takes is a pixel off the board.
 */
const TABS = [
  { href: "/board", label: "Board", hint: "Live mispriced lines" },
  { href: "/model", label: "Model", hint: "Forecasts by fixture" },
  { href: "/ledger", label: "Ledger", hint: "Bets, P&L and closing line value" },
] as const;

export function TopRail() {
  const pathname = usePathname();

  // On the sign-in screen there is nothing to navigate to and nothing to sign
  // out of; showing the full rail there offers dead links and implies a session
  // that does not exist.
  const signedOut = pathname === "/login" || pathname.startsWith("/auth/");
  if (signedOut) {
    return (
      <header className="border-b border-slate-rule">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2.5 px-5 py-3 text-bone">
          <ChalkDiamond />
          <span
            className="text-[15px] font-semibold tracking-[0.14em]"
            style={{ fontStretch: "112%" }}
          >
            DIAMONDS
          </span>
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-slate-rule">
      <div className="mx-auto flex max-w-[1400px] items-stretch gap-8 px-5">
        <Link
          href="/board"
          className="flex items-center gap-2.5 py-3 text-bone hover:text-chalk"
          aria-label="Diamonds home"
        >
          <ChalkDiamond />
          <span
            className="text-[15px] font-semibold tracking-[0.14em]"
            style={{ fontStretch: "112%" }}
          >
            DIAMONDS
          </span>
        </Link>

        {/* Phones navigate from the bottom tab bar, which is thumb-reachable;
            showing both would duplicate the same four destinations. */}
        <nav className="hidden items-stretch md:flex" aria-label="Sections">
          {TABS.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                title={tab.hint}
                aria-current={active ? "page" : undefined}
                className={[
                  "relative flex items-center px-4 text-[13.5px] transition-colors",
                  active ? "text-bone" : "text-bone-faint hover:text-bone-dim",
                ].join(" ")}
              >
                {tab.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 bottom-0 h-px bg-chalk"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {/* A real form POST: sign-out must not be reachable by a GET. */}
          <form action="/auth/signout" method="post" className="flex items-center">
            <button
              type="submit"
              className="text-[13px] text-bone-faint transition-colors hover:text-bone-dim"
            >
              Sign out
            </button>
          </form>
          <Link
            href="/setup"
            className={[
              "text-[13px] transition-colors",
              pathname === "/setup" ? "text-bone" : "text-bone-faint hover:text-bone-dim",
            ].join(" ")}
          >
            Setup
          </Link>
        </div>
      </div>
    </header>
  );
}

/** A chalk diamond: the mark, drawn rather than typed so it aligns optically. */
function ChalkDiamond() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" aria-hidden>
      <path
        d="M6.5 1L12 7.5L6.5 14L1 7.5L6.5 1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
