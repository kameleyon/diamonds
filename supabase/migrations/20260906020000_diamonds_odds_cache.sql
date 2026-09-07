-- Shared odds cache.
--
-- Still additive, still confined to the `diamonds` schema.
--
-- WHY THIS EXISTS: the odds client caches responses in memory with a 60-second
-- TTL, which works locally and does almost nothing in production. Each Vercel
-- request can land on a different serverless instance with a cold, empty cache,
-- so in practice every page view re-bought the whole slate. At roughly 40
-- credits per scan against a 500/month free tier, that consumed the month in a
-- day.
--
-- A cache in Postgres is shared across every instance, so the second viewer in
-- a ten-minute window costs nothing.

create table if not exists diamonds.odds_cache (
  -- The request shape being cached: sports, regions and markets, normalised.
  cache_key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  -- What the fetch cost, so spend stays auditable rather than guessed at.
  credits_spent integer not null default 0
);

-- Reads are always "is the newest entry for this key still fresh", so the
-- index leads with the key and orders by time.
create index if not exists odds_cache_freshness
  on diamonds.odds_cache (cache_key, fetched_at desc);

-- Same posture as the rest of the schema: RLS on, no policies, so only the
-- service role reaches it. Cached odds are not secret, but there is no reason
-- for a browser session to read them directly either.
alter table diamonds.odds_cache enable row level security;

revoke all on diamonds.odds_cache from anon, authenticated;
