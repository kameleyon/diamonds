/**
 * Bet log types, shared by both storage backends.
 *
 * Kept apart from either implementation so the file store and the Postgres
 * store cannot drift into two subtly different contracts.
 */

export type BetStatus = "open" | "won" | "lost" | "push" | "void";

export interface Bet {
  id: string;
  placedAt: string;

  eventId: string;
  sportKey: string;
  sportLabel: string;
  fixture: string;
  commenceTime: string;

  marketKey: string;
  selection: string;
  point?: number;

  book: string;
  /** Decimal price actually taken. */
  odds: number;
  stake: number;

  /** What the sharp market said was fair when the bet went on. */
  fairAtBet: number;
  evAtBet: number;

  status: BetStatus;
  settledAt?: string;
  /** Total returned including stake. 0 for a loss, stake for a push. */
  returned?: number;

  /** Closing price for the same selection at the same book. */
  closingOdds?: number;
  /** Full closing market, so the close can be devigged properly. */
  closingMarket?: number[];
  closingOutcomeIndex?: number;

  notes?: string;
}

/** A bet as supplied by the caller: the store assigns id, timestamp and status. */
export type NewBet = Omit<Bet, "id" | "placedAt" | "status">;
