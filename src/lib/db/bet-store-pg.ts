import "server-only";

/**
 * Postgres-backed bet log.
 *
 * Every function here takes the viewer's id and scopes its query by it. That
 * is not belt-and-braces on top of RLS -- it is the ONLY thing enforcing
 * ownership on this path, because the secret key bypasses RLS entirely. The
 * policies on `diamonds.bets` protect the table if it is ever reached with a
 * user session; they do nothing for a service-role query. Dropping a
 * `.eq("user_id", ...)` here would expose every user's bets, silently.
 */

import { adminDb } from "../supabase/admin";
import type { Bet, BetStatus, NewBet } from "./bet-types";

const TABLE = "diamonds_bets";

/** DB row shape. snake_case, as Postgres stores it. */
interface Row {
  id: string;
  placed_at: string;
  event_id: string;
  sport_key: string;
  sport_label: string;
  fixture: string;
  commence_time: string;
  market_key: string;
  selection: string;
  point: number | null;
  book: string;
  odds: number | string;
  stake: number | string;
  fair_at_bet: number | string;
  ev_at_bet: number | string;
  status: BetStatus;
  settled_at: string | null;
  returned: number | string | null;
  closing_odds: number | string | null;
  closing_market: (number | string)[] | null;
  closing_outcome_index: number | null;
  notes: string | null;
}

/**
 * Postgres returns `numeric` as a STRING to preserve exact precision, which
 * JavaScript's number type cannot always represent. Converting at the boundary
 * is required -- left as strings, `stake * odds` silently becomes concatenation.
 */
const num = (v: number | string | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

function toBet(r: Row): Bet {
  return {
    id: r.id,
    placedAt: r.placed_at,
    eventId: r.event_id,
    sportKey: r.sport_key,
    sportLabel: r.sport_label,
    fixture: r.fixture,
    commenceTime: r.commence_time,
    marketKey: r.market_key,
    selection: r.selection,
    point: num(r.point),
    book: r.book,
    odds: num(r.odds) as number,
    stake: num(r.stake) as number,
    fairAtBet: num(r.fair_at_bet) as number,
    evAtBet: num(r.ev_at_bet) as number,
    status: r.status,
    settledAt: r.settled_at ?? undefined,
    returned: num(r.returned),
    closingOdds: num(r.closing_odds),
    closingMarket: r.closing_market?.map((v) => Number(v)),
    closingOutcomeIndex: r.closing_outcome_index ?? undefined,
    notes: r.notes ?? undefined,
  };
}

export async function listBetsPg(userId: string): Promise<Bet[]> {
  const { data, error } = await adminDb()
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("placed_at", { ascending: false });

  if (error) throw new Error(`Could not read the bet log: ${error.message}`);
  return (data as Row[]).map(toBet);
}

export async function addBetPg(userId: string, input: NewBet): Promise<Bet> {
  const { data, error } = await adminDb()
    .from(TABLE)
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      placed_at: new Date().toISOString(),
      event_id: input.eventId,
      sport_key: input.sportKey,
      sport_label: input.sportLabel,
      fixture: input.fixture,
      commence_time: input.commenceTime,
      market_key: input.marketKey,
      selection: input.selection,
      point: input.point ?? null,
      book: input.book,
      odds: input.odds,
      stake: input.stake,
      fair_at_bet: input.fairAtBet,
      ev_at_bet: input.evAtBet,
      status: "open",
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Could not log the bet: ${error.message}`);
  return toBet(data as Row);
}

/**
 * Settlement derives the return from the status rather than accepting a figure
 * from the caller, so a mistyped payout cannot corrupt the P&L record.
 */
export async function settleBetPg(
  userId: string,
  id: string,
  status: Exclude<BetStatus, "open">,
): Promise<Bet> {
  const existing = await getOwnBet(userId, id);

  const returned =
    status === "won"
      ? existing.stake * existing.odds
      : status === "push" || status === "void"
        ? existing.stake
        : 0;

  const { data, error } = await adminDb()
    .from(TABLE)
    .update({ status, returned, settled_at: new Date().toISOString() })
    .eq("id", id)
    // The ownership filter is repeated on the UPDATE itself. Checking ownership
    // in the read above and omitting it here would leave a race in which the
    // row could change hands between the two statements.
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(`Could not settle the bet: ${error.message}`);
  return toBet(data as Row);
}

export async function setClosingLinePg(
  userId: string,
  id: string,
  closingOdds: number,
  closingMarket?: number[],
): Promise<Bet> {
  const { data, error } = await adminDb()
    .from(TABLE)
    .update({ closing_odds: closingOdds, closing_market: closingMarket ?? null })
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(`Could not record the closing line: ${error.message}`);
  return toBet(data as Row);
}

export async function deleteBetPg(userId: string, id: string): Promise<void> {
  const { error } = await adminDb().from(TABLE).delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error(`Could not remove the bet: ${error.message}`);
}

async function getOwnBet(userId: string, id: string): Promise<Bet> {
  const { data, error } = await adminDb()
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  // A missing row and a row belonging to someone else are reported identically
  // and deliberately: distinguishing them would confirm the existence of
  // another user's bet.
  if (error || !data) throw new Error(`No such bet.`);
  return toBet(data as Row);
}
