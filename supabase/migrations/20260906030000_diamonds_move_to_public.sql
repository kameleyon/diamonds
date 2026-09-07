-- Move the Diamonds tables into `public`, prefixed.
--
-- WHY: PostgREST serves only the schemas on the project's exposed list
-- (`public, graphql_public`). That list is enforced for EVERY role, including
-- the service role — bypassing RLS is not the same as bypassing schema
-- exposure. So the whole application data layer failed with PGRST106, silently
-- in the cache's case, because a cache is written to treat errors as a miss.
--
-- Adding `diamonds` to the exposed list would have fixed it, but that is a
-- shared project setting and applying it restarts PostgREST for the other
-- application on this database. Prefixed tables in `public` need no shared
-- configuration change at all.
--
-- STILL ADDITIVE: creates new tables, copies rows, touches nothing that
-- belongs to the other application. The original `diamonds` schema is left in
-- place rather than dropped.
--
-- SECURITY NOTE — this is the important consequence of the move. In the
-- unexposed `diamonds` schema, RLS was defence in depth: the schema being
-- invisible to PostgREST was the outer gate. In `public` there is no outer
-- gate, so RLS is now the ONLY thing between these tables and any browser
-- holding the publishable key. The policies below are therefore load-bearing,
-- and the `anon`/`authenticated` grants stay revoked so that even a policy
-- mistake leaves a second barrier standing.

-- ---------------------------------------------------------------------------
-- bets: the private table
-- ---------------------------------------------------------------------------
create table if not exists public.diamonds_bets (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete cascade,
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
  odds numeric(10, 4) not null check (odds > 1),
  stake numeric(12, 2) not null check (stake > 0),

  fair_at_bet numeric(6, 5) not null check (fair_at_bet > 0 and fair_at_bet < 1),
  ev_at_bet numeric(8, 5) not null,

  status text not null default 'open'
    check (status in ('open', 'won', 'lost', 'push', 'void')),
  settled_at timestamptz,
  returned numeric(12, 2) check (returned >= 0),

  closing_odds numeric(10, 4) check (closing_odds > 1),
  closing_market numeric(10, 4)[],
  closing_outcome_index integer check (closing_outcome_index >= 0),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint diamonds_bets_settled_has_return
    check ((status = 'open') = (returned is null))
);

create index if not exists diamonds_bets_user_placed
  on public.diamonds_bets (user_id, placed_at desc);
create index if not exists diamonds_bets_open_by_kickoff
  on public.diamonds_bets (commence_time) where status = 'open';

-- ---------------------------------------------------------------------------
-- results: shared reference data
-- ---------------------------------------------------------------------------
create table if not exists public.diamonds_results (
  id bigint generated always as identity primary key,
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
  constraint diamonds_results_source_unique unique (source, source_id)
);

create index if not exists diamonds_results_sport_time
  on public.diamonds_results (sport_id, completed_at);

-- ---------------------------------------------------------------------------
-- odds cache: shared across serverless instances
-- ---------------------------------------------------------------------------
create table if not exists public.diamonds_odds_cache (
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  credits_spent integer not null default 0
);

create index if not exists diamonds_odds_cache_freshness
  on public.diamonds_odds_cache (cache_key, fetched_at desc);

-- ---------------------------------------------------------------------------
-- Carry the existing rows across. Idempotent, so re-running is safe.
-- ---------------------------------------------------------------------------
-- Columns are listed explicitly. `select *` is POSITIONAL, and the source
-- table gained user_id via ALTER TABLE, so it sits last there and second here
-- -- which silently maps a uuid onto a timestamp column.
insert into public.diamonds_bets
  (id, user_id, placed_at, event_id, sport_key, sport_label, fixture,
   commence_time, market_key, selection, point, book, odds, stake,
   fair_at_bet, ev_at_bet, status, settled_at, returned, closing_odds,
   closing_market, closing_outcome_index, notes, created_at, updated_at)
  select
    id, user_id, placed_at, event_id, sport_key, sport_label, fixture,
    commence_time, market_key, selection, point, book, odds, stake,
    fair_at_bet, ev_at_bet, status, settled_at, returned, closing_odds,
    closing_market, closing_outcome_index, notes, created_at, updated_at
  from diamonds.bets
  on conflict (id) do nothing;

insert into public.diamonds_results
  (source, source_id, sport_id, league, home_team, away_team,
   home_score, away_score, completed_at, ingested_at)
  select source, source_id, sport_id, league, home_team, away_team,
         home_score, away_score, completed_at, ingested_at
  from diamonds.results
  on conflict (source, source_id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security. Load-bearing now, not defence in depth.
-- ---------------------------------------------------------------------------
alter table public.diamonds_bets enable row level security;
alter table public.diamonds_results enable row level security;
alter table public.diamonds_odds_cache enable row level security;

-- Owner-scoped. `TO authenticated` alone would be authentication without
-- authorisation; UPDATE needs WITH CHECK as well as USING, or a row can be
-- reassigned to another user.
drop policy if exists diamonds_bets_select_own on public.diamonds_bets;
create policy diamonds_bets_select_own on public.diamonds_bets
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists diamonds_bets_insert_own on public.diamonds_bets;
create policy diamonds_bets_insert_own on public.diamonds_bets
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists diamonds_bets_update_own on public.diamonds_bets;
create policy diamonds_bets_update_own on public.diamonds_bets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists diamonds_bets_delete_own on public.diamonds_bets;
create policy diamonds_bets_delete_own on public.diamonds_bets
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Results are impersonal match facts; writes stay service-role only.
drop policy if exists diamonds_results_select on public.diamonds_results;
create policy diamonds_results_select on public.diamonds_results
  for select to authenticated using (true);

-- The cache gets NO policies: only the service role touches it.

-- ---------------------------------------------------------------------------
-- Second barrier: no table privileges for the public API roles at all, so a
-- future policy mistake still cannot expose these rows.
-- ---------------------------------------------------------------------------
revoke all on public.diamonds_bets from anon;
revoke all on public.diamonds_results from anon;
revoke all on public.diamonds_odds_cache from anon, authenticated;

-- updated_at maintenance. SECURITY INVOKER with a pinned search_path: a
-- DEFINER function here would silently run with elevated rights.
create or replace function public.diamonds_set_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists diamonds_bets_set_updated_at on public.diamonds_bets;
create trigger diamonds_bets_set_updated_at
  before update on public.diamonds_bets
  for each row execute function public.diamonds_set_updated_at();

revoke all on function public.diamonds_set_updated_at() from public, anon, authenticated;
