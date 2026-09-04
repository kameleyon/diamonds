/** Display formatting. Kept apart from the maths so rounding never leaks into it. */

import { decimalToAmerican } from "./odds/format";

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x: number, digits = 1): string {
  const s = (x * 100).toFixed(digits);
  return x > 0 ? `+${s}%` : `${s}%`;
}

export function money(x: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: x >= 100 ? 0 : 2,
  }).format(x);
}

export function american(decimal: number): string {
  const a = decimalToAmerican(decimal);
  return a > 0 ? `+${a}` : `${a}`;
}

/** "Sun 13:00" for anything this week, "12 Sep 13:00" beyond it. */
export function kickoff(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const withinWeek = d.getTime() - now.getTime() < 6 * 86_400_000;
  return d.toLocaleString("en-GB", {
    weekday: withinWeek ? "short" : undefined,
    day: withinWeek ? undefined : "numeric",
    month: withinWeek ? undefined : "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function timeUntil(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms < 0) return "live";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const MARKET_LABELS: Record<string, string> = {
  h2h: "Moneyline",
  spreads: "Spread",
  totals: "Total",
  outrights: "Outright",
};

export function marketLabel(key: string, point?: number): string {
  const base =
    MARKET_LABELS[key] ??
    key
      .replace(/^player_/, "")
      .replace(/^batter_/, "")
      .replace(/^pitcher_/, "")
      .replace(/_/g, " ");

  if (point === undefined) return base;

  // A leading "+" means "giving points" and only makes sense on a handicap.
  // On a total or a player line the number is a threshold, not an adjustment,
  // so "Total +8.5" reads as a spread and is actively misleading.
  const signed = key === "spreads";
  return `${base} ${signed && point > 0 ? "+" : ""}${point}`;
}

export function matchup(home: string | null, away: string | null): string {
  if (!home || !away) return "—";
  return `${away} at ${home}`;
}
