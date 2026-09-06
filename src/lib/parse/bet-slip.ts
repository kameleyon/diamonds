/**
 * Bet-slip parser.
 *
 * Turns how people actually write bets -- "Alabama o3.5 1U", "Chiefs ML 2u",
 * "Under 8.5 Dodgers -110" -- into something the engine can price.
 *
 * The design principle is the same one that governs the board: SURFACE
 * UNCERTAINTY RATHER THAN GUESSING SILENTLY. `o3.5` on a college football team
 * is a team total; the same token in soccer is almost certainly the game total.
 * A parser that quietly picks one and hands back a confident price is worse
 * than one that says which reading it took and flags that there was a choice.
 *
 * So every inference that could reasonably have gone another way is recorded in
 * `ambiguities`, and the UI shows what was READ before what was DECIDED.
 *
 * Strategy: extract the unambiguous pieces by pattern first (stake, then price,
 * then market and line), removing each as it is found, and treat whatever text
 * survives as the team or player. Parsing token-by-token instead means a bare
 * "u" is simultaneously a units marker and the word "under", which is exactly
 * the collision that makes hand-rolled slip parsers unreliable.
 */

export type BetMarket = "moneyline" | "total" | "spread" | "unknown";
export type BetSide = "over" | "under" | "team";

export interface ParsedBet {
  /** Exactly what the user typed, untouched. */
  raw: string;
  /** Best guess at the team or player named. */
  subject?: string;
  market: BetMarket;
  side?: BetSide;
  /** Total or handicap line: 3.5, -3.5, 8.5. */
  line?: number;
  /** Price as decimal odds, if one was given. */
  price?: number;
  /** Stake in units, when written as "1u" / "2U". */
  stakeUnits?: number;
  /** Stake in currency, when written as "$50". */
  stakeAmount?: number;
  /** How much of the string was understood. */
  confidence: "high" | "medium" | "low";
  /** Readings that could legitimately have gone another way. */
  ambiguities: string[];
  /** Tokens the parser could not account for. */
  unparsed: string[];
}

function americanToDecimal(a: number): number {
  return a >= 100 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

export function parseBetSlip(input: string): ParsedBet {
  const raw = input.trim();
  const ambiguities: string[] = [];
  const unparsed: string[] = [];

  const result: ParsedBet = {
    raw,
    market: "unknown",
    confidence: "low",
    ambiguities,
    unparsed,
  };
  if (!raw) return result;

  let rest = ` ${raw} `;
  const cut = (re: RegExp, take: (m: RegExpMatchArray) => void): boolean => {
    const m = rest.match(re);
    if (!m) return false;
    take(m);
    rest = rest.replace(re, " ");
    return true;
  };

  // 1. Stake. Digits followed by a unit marker, or a currency amount. Taken
  //    first because a trailing "u" is otherwise indistinguishable from
  //    "under".
  cut(/\s(\d+(?:\.\d+)?)\s*(?:u|units?)\b/i, (m) => {
    result.stakeUnits = Number(m[1]);
  });
  cut(/\s\$\s*(\d+(?:\.\d+)?)\b/, (m) => {
    result.stakeAmount = Number(m[1]);
  });

  // 2. Price. American odds are signed and >= 100 in magnitude; a handicap
  //    never is. That single rule separates "-110" from "-3.5" reliably.
  cut(/\s([+-]\d{3,})\b/, (m) => {
    result.price = americanToDecimal(Number(m[1]));
  });

  // 3. Market and line.
  const overUnder = rest.match(/\s(o|ov|over|u|un|under)\s*(\d+(?:\.\d+)?)\b/i);
  if (overUnder) {
    result.market = "total";
    result.side = /^(o|ov|over)$/i.test(overUnder[1]) ? "over" : "under";
    result.line = Number(overUnder[2]);
    rest = rest.replace(overUnder[0], " ");
  } else if (cut(/\s(ml|moneyline|money|h2h)\b/i, () => {})) {
    result.market = "moneyline";
  } else {
    // A signed small number is a handicap.
    cut(/\s([+-]\d+(?:\.\d+)?)\b/, (m) => {
      result.market = "spread";
      result.line = Number(m[1]);
    });
  }

  // A decimal price may still be sitting there written plainly (1.83, 2.10).
  if (result.price === undefined) {
    cut(/\s(\d\.\d{1,3})\b/, (m) => {
      result.price = Number(m[1]);
    });
  }

  // 4. Whatever text survives is the subject.
  const leftovers = rest.trim().split(/\s+/).filter(Boolean);
  const words = leftovers.filter((w) => /^[A-Za-z][A-Za-z.'&-]*$/.test(w));
  for (const w of leftovers) {
    if (!words.includes(w)) unparsed.push(w);
  }
  if (words.length) result.subject = words.join(" ");

  /*
   * A name on its own is not a bet. Assuming a moneyline requires SOME betting
   * signal -- a stake, a price, or a market word -- otherwise "hello there"
   * parses as a confident wager on a team called Hello There.
   */
  const hasBettingSignal =
    result.stakeUnits !== undefined ||
    result.stakeAmount !== undefined ||
    result.price !== undefined ||
    result.line !== undefined;

  if (result.market === "unknown" && result.subject && hasBettingSignal) {
    result.market = "moneyline";
    ambiguities.push("No market named; read as a moneyline.");
  }

  // The reading that most often goes wrong, called out explicitly.
  if (result.market === "total" && result.subject) {
    ambiguities.push(
      `"${result.subject}" with a total could be that team's own total or the whole game's. ` +
        `Read as the team total — change it if you meant the game.`,
    );
  }

  result.confidence = grade(result);
  return result;
}

function grade(b: ParsedBet): ParsedBet["confidence"] {
  if (b.market === "unknown" || !b.subject) return "low";
  if (b.unparsed.length > 0) return "medium";
  if (b.market === "moneyline") return b.ambiguities.length ? "medium" : "high";
  if (b.line === undefined) return "low";
  // A total always carries the team-vs-game note; that alone should not
  // demote an otherwise cleanly-read slip.
  return b.ambiguities.length > 1 ? "medium" : "high";
}

/** One-line plain-English restatement, for the "read as" line in the UI. */
export function describeParsedBet(b: ParsedBet): string {
  if (b.market === "unknown" || !b.subject) return "Could not read this as a bet.";

  const stake =
    b.stakeUnits !== undefined
      ? `${b.stakeUnits} unit${b.stakeUnits === 1 ? "" : "s"}`
      : b.stakeAmount !== undefined
        ? `$${b.stakeAmount}`
        : null;

  const core =
    b.market === "moneyline"
      ? `${b.subject} to win`
      : b.market === "total"
        ? `${b.subject} · team total ${b.side === "under" ? "Under" : "Over"} ${b.line}`
        : `${b.subject} ${b.line! > 0 ? "+" : ""}${b.line}`;

  const price = b.price ? ` at ${b.price.toFixed(2)}` : "";
  return stake ? `${core}${price} · ${stake}` : `${core}${price}`;
}
