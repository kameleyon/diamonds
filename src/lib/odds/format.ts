/**
 * Odds format conversion.
 *
 * Decimal odds are the canonical internal representation: a decimal price `d`
 * means a 1-unit stake returns `d` units total (stake + profit). Every other
 * format is converted to decimal at the edge of the system.
 */

export type OddsFormat = "decimal" | "american" | "fractional";

/** Smallest decimal price we treat as valid. 1.0 would be a free bet. */
const MIN_DECIMAL = 1.0000001;

export function isValidDecimal(d: number): boolean {
  return Number.isFinite(d) && d > 1;
}

/**
 * American (moneyline) -> decimal.
 *   +150 => 2.50   (win 150 on a 100 stake)
 *   -200 => 1.50   (stake 200 to win 100)
 *
 * American odds are undefined in (-100, 100); books never quote there.
 */
export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american)) throw new Error(`Invalid American odds: ${american}`);
  if (american >= 100) return 1 + american / 100;
  if (american <= -100) return 1 + 100 / Math.abs(american);
  throw new Error(`American odds must be <= -100 or >= 100, got ${american}`);
}

/** Decimal -> American. Even money (2.0) conventionally renders as +100. */
export function decimalToAmerican(decimal: number): number {
  if (!isValidDecimal(decimal)) throw new Error(`Invalid decimal odds: ${decimal}`);
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

/** Fractional ("5/2", "evens") -> decimal. */
export function fractionalToDecimal(fractional: string): number {
  const s = fractional.trim().toLowerCase();
  if (s === "evens" || s === "evs" || s === "even") return 2;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`Invalid fractional odds: ${fractional}`);
  const [num, den] = [Number(m[1]), Number(m[2])];
  if (den === 0) throw new Error(`Fractional odds cannot have zero denominator: ${fractional}`);
  return 1 + num / den;
}

export function toDecimal(value: number | string, format: OddsFormat): number {
  switch (format) {
    case "decimal": {
      const d = Number(value);
      if (!isValidDecimal(d)) throw new Error(`Invalid decimal odds: ${value}`);
      return d;
    }
    case "american":
      return americanToDecimal(Number(value));
    case "fractional":
      return fractionalToDecimal(String(value));
  }
}

/**
 * Decimal price -> implied probability.
 *
 * NOTE: this is the *raw* implied probability and includes the bookmaker's
 * margin. Across a full market these sum to more than 1. Never treat this as a
 * fair probability -- run the market through `devig()` first.
 */
export function impliedProbability(decimal: number): number {
  if (!isValidDecimal(decimal)) throw new Error(`Invalid decimal odds: ${decimal}`);
  return 1 / decimal;
}

/** Probability -> fair decimal price (no margin). */
export function probabilityToDecimal(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`Probability must be in (0,1), got ${p}`);
  return 1 / p;
}

/** Probability -> fair American price. */
export function probabilityToAmerican(p: number): number {
  return decimalToAmerican(probabilityToDecimal(p));
}

/** Format a decimal price for display in the user's preferred notation. */
export function formatOdds(decimal: number, format: OddsFormat): string {
  switch (format) {
    case "decimal":
      return decimal.toFixed(2);
    case "american": {
      const a = decimalToAmerican(decimal);
      return a > 0 ? `+${a}` : `${a}`;
    }
    case "fractional": {
      const target = decimal - 1;
      let best = { num: 1, den: 1, err: Infinity };
      for (const den of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 25, 33, 40, 50, 100]) {
        const num = Math.round(target * den);
        if (num < 1) continue;
        const err = Math.abs(num / den - target);
        if (err < best.err) best = { num, den, err };
      }
      return `${best.num}/${best.den}`;
    }
  }
}

export { MIN_DECIMAL };
