"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Bottom tab bar. Phone only.
 *
 * Thumb-reachable navigation, which the top rail is not on a phone. The active
 * tab is marked with a chalk rule along its top edge rather than a filled pill,
 * matching how the desktop rail marks its active section.
 *
 * Hit targets are the full tab height (>=44px) rather than just the label.
 */
const TABS = [
  { href: "/board", label: "Board" },
  { href: "/parlay", label: "Parlay" },
  { href: "/ledger", label: "Ledger" },
  { href: "/model", label: "Model" },
] as const;

export function TabBar() {
  const pathname = usePathname();

  // No chrome on the sign-in screens: nothing to navigate to yet.
  if (pathname === "/login" || pathname.startsWith("/auth/")) return null;

  return (
    <nav
      aria-label="Sections"
      className="sticky bottom-0 z-10 flex border-t border-slate-rule bg-slate-ground md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={[
              "relative flex-1 py-[11px] pb-[13px] text-center text-[11px] transition-colors",
              active ? "text-chalk" : "text-bone-faint",
            ].join(" ")}
          >
            {active && <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-chalk" />}
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
