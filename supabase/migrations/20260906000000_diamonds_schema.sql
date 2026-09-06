-- Diamonds betting terminal: storage.
--
-- This database is shared with a live application (menlifoot) that owns 50
-- tables in `public`. Everything here therefore lives in its own `diamonds`
-- schema:
--
--   * no name can collide with an existing table
--   * the two applications stay visually separate in the dashboard
--   * the whole thing is removable with one statement if it is ever unwanted
--
-- This migration is STRICTLY ADDITIVE. It contains no drop, no alter of an
-- existing object, and no reference to anything in `public`. Every statement is
-- `if not exists`, so re-running it is safe.

create schema if not exists diamonds;

-- ---------------------------------------------------------------------------
-- bets: the bet log
--
-- The one table here whose contents cannot be regenerated. Odds and results can
-- always be re-fetched from a provider; a record of what you actually staked,
-- at what price, and what the market said was fair at that moment cannot.
-- ---------------------------------------------------------------------------
create table if not exists diamonds.bets (
  -- The application generates these ids client-side, so they are preserved on
  -- import rather than reassigned. Random-UUID index fragmentation is a real
  -- concern on large tables and a non-issue here: this is one person's bet log.
  id uuid primary key,

  placed_at timestamptz not null default now(),

  event_id text not null,
  sport_key text not null,
  sport_label text not null,
  fixture text not null,
  commence_time timestamptz not null,

  market_key text not null,
  selection text not null,
  point numeric,

  book text not null,
  -- Decimal price. A price of 1.0 or below would be a free bet, not a wager.
  odds numeric(10, 4) not null check (odds > 1),
  stake numeric(12, 2) not null check (stake > 0),

  -- What the sharp market said was fair AT BET TIME. Frozen deliberately:
  -- recomputing it later from a moved line would rewrite history and destroy
  -- the ledger's ability to judge the method.
  fair_at_bet numeric(6, 5) not null check (fair_at_bet > 0 and fair_at_bet < 1),
  ev_at_bet numeric(8, 5) not null,

  status text not null default 'open'
    check (status in ('open', 'won', 'lost', 'push', 'void')),
  settled_at timestamptz,
  returned numeric(12, 2) check (returned >= 0),

  -- Closing line, for CLV. The single most valuable field in the table and the
  -- only one that becomes unrecoverable once the event starts.
  closing_odds numeric(10, 4) check (closing_odds > 1),
  closing_market numeric(10, 4)[],
  closing_outcome_index integer check (closing_outcome_index >= 0),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A settled bet must record what came back; an open one must not.
  constraint bets_settled_has_return
    check ((status = 'open') = (returned is null))
);

-- Open bets are the working set: they need a closing price recorded before
-- kickoff and a result after. A partial index keeps that lookup tiny even as
-- settled history grows.
create index if not exists bets_open_by_kickoff
  on diamonds.bets (commence_time)
  where status = 'open';

create index if not exists bets_placed_at on diamonds.bets (placed_at desc);

-- CLV is computed only over bets that have a closing price, so index exactly
-- those rows rather than the whole table.
create index if not exists bets_with_closing
  on diamonds.bets (placed_at desc)
  where closing_odds is not null;

-- ---------------------------------------------------------------------------
-- results: completed matches, used to fit the rating models
-- ---------------------------------------------------------------------------
create table if not exists diamonds.results (
  id bigint generated always as identity primary key,

  -- Provider plus that provider's own id. Two sources (Big Balls, Sportradar)
  -- can describe the same fixture, so uniqueness is per source rather than
  -- global -- claiming a match across providers needs name reconciliation that
  -- does not exist yet.
  source text not null,
  source_id text not null,

  sport_id text not null,
  league text not null,
  home_team text not null,
  away_team text not null,
  home_score integer not null check (home_score >= 0),
  away_score integer not null check (away_score >= 0),
  completed_at timestamptz not null,
  ingested_at timestamptz not null default now(),

  constraint results_source_unique unique (source, source_id)
);

-- Model fitting always reads "this sport, in chronological order", and the
-- walk-forward backtest depends on that ordering, so the composite index is
-- built in exactly that shape.
create index if not exists results_sport_time
  on diamonds.results (sport_id, completed_at);

create index if not exists results_league_time
  on diamonds.results (league, completed_at);

-- ---------------------------------------------------------------------------
-- Access control
--
-- RLS is enabled with NO policies, which denies every request from `anon` and
-- `authenticated`. Only the service role -- which bypasses RLS and is used by
-- this local tool alone -- can read or write. That is correct here: a personal
-- bet log should never be reachable from a browser session belonging to the
-- other application sharing this database.
--
-- Enabling RLS without policies is deliberate, not an oversight.
-- ---------------------------------------------------------------------------
alter table diamonds.bets enable row level security;
alter table diamonds.results enable row level security;

-- Least privilege: the public API roles get no access to this schema at all.
revoke all on schema diamonds from anon, authenticated;
revoke all on all tables in schema diamonds from anon, authenticated;
