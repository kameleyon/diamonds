-- Diamonds: ownership and access control.
--
-- Still strictly additive, and still confined to the `diamonds` schema. Nothing
-- here touches `public` or any object belonging to the application that shares
-- this database.
--
-- THREAT MODEL, stated plainly because it drives every choice below:
--
--   1. The `diamonds` schema is NOT exposed to the Data API. PostgREST serves
--      only the schemas listed in the project's API settings, and this is not
--      one of them, so `anon` and `authenticated` cannot reach these tables
--      through the REST endpoint at all. Exposing it would be a project-wide
--      change affecting the other application, so it stays unexposed.
--
--   2. Server-side application code reaches the schema with the secret key.
--      That key bypasses RLS, so RLS is not what protects the data from the
--      application -- application-level auth is. RLS here is defence in depth:
--      it means that IF the schema were ever exposed, or a session key leaked,
--      the tables are already scoped correctly rather than wide open.
--
--   3. `results` deliberately has no owner. Match scores are impersonal public
--      facts, expensive to collect and useless to hide. `bets` is the private
--      data, and it is the table that gets ownership.

-- ---------------------------------------------------------------------------
-- Ownership on the private table
-- ---------------------------------------------------------------------------

alter table diamonds.bets
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Owner-scoped reads are the only query shape this table has, so the index
-- leads with user_id.
create index if not exists bets_user_placed
  on diamonds.bets (user_id, placed_at desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- Every policy below follows three rules that are easy to get wrong:
--
--   * `TO authenticated` rather than `auth.role() = 'authenticated'`. The
--     latter is deprecated, and it breaks silently when anonymous sign-ins are
--     enabled -- anonymous users carry the `authenticated` Postgres role and
--     would pass the check without being genuinely signed in.
--
--   * `TO authenticated` ALONE is authentication without authorisation. Each
--     policy pairs it with an ownership predicate, or any signed-in user could
--     read every other user's bets.
--
--   * UPDATE carries both USING and WITH CHECK. Without WITH CHECK a user can
--     hand a row to someone else by rewriting its user_id. USING controls which
--     rows may be updated; WITH CHECK controls what they may become.
--
-- `auth.uid()` is wrapped in a scalar subselect so Postgres evaluates it once
-- per statement instead of once per row.
-- ---------------------------------------------------------------------------

drop policy if exists bets_select_own on diamonds.bets;
create policy bets_select_own on diamonds.bets
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists bets_insert_own on diamonds.bets;
create policy bets_insert_own on diamonds.bets
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists bets_update_own on diamonds.bets;
create policy bets_update_own on diamonds.bets
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists bets_delete_own on diamonds.bets;
create policy bets_delete_own on diamonds.bets
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Results are shared reference data: readable by any signed-in user, writable
-- only by the backfill running under the secret key (which bypasses RLS). No
-- insert/update/delete policy exists for `authenticated`, so those are denied.
drop policy if exists results_select_authenticated on diamonds.results;
create policy results_select_authenticated on diamonds.results
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
--
-- SECURITY INVOKER, not DEFINER. A DEFINER function runs with its creator's
-- privileges and would silently bypass RLS; this one needs no elevation, and
-- reaching for DEFINER to sidestep a permission error is how access control
-- quietly disappears.
--
-- The search_path is pinned so the function cannot be hijacked by a shadowing
-- object in a caller-controlled schema.
-- ---------------------------------------------------------------------------
create or replace function diamonds.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bets_set_updated_at on diamonds.bets;
create trigger bets_set_updated_at
  before update on diamonds.bets
  for each row execute function diamonds.set_updated_at();

-- Least privilege, restated after adding objects: the public API roles get
-- nothing in this schema beyond what the policies above allow, and the function
-- is not a public entry point.
revoke all on function diamonds.set_updated_at() from public, anon, authenticated;
