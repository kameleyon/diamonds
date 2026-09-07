import "server-only";

/**
 * Privileged Supabase client for the `diamonds` schema.
 *
 * `import "server-only"` is the first line on purpose. It makes importing this
 * module from a Client Component a BUILD ERROR rather than a runtime surprise,
 * which is the only reliable way to guarantee the secret key never reaches a
 * browser bundle. Do not remove it, and do not re-export anything from here
 * through a module a client component can reach.
 *
 * WHAT THIS KEY CAN DO: the secret key bypasses Row Level Security entirely and
 * has full access to EVERY schema in the project -- including the 33 tables
 * belonging to the separate application that shares this database. It is the
 * most dangerous value in the repository.
 *
 * So the rule is narrow and absolute: this client is only ever used to read and
 * write `diamonds` tables, always filtered by the authenticated user's id, and
 * only from code that has already checked the caller is authorised. RLS cannot
 * save us here -- it is bypassed -- so the filtering is the application's job.
 */

import { createClient } from "@supabase/supabase-js";

/*
 * The tables live in `public` with a `diamonds_` prefix, not in their own
 * schema. PostgREST serves only the schemas on the project's exposed list, and
 * that list is enforced for EVERY role -- the service role bypasses RLS, not
 * schema exposure. A dedicated schema would have needed a shared project
 * setting changed, and this database belongs to another live application too.
 */
export const TABLE_PREFIX = "diamonds_";

/**
 * The client type carries its schema as a type parameter, so a client bound to
 * `diamonds` is not assignable to the default `public` one. Deriving the type
 * from the factory keeps them in step instead of asserting them equal.
 */
type DiamondsClient = ReturnType<typeof createDiamondsClient>;

function createDiamondsClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
    auth: {
      // A service client has no user session and must never try to persist or
      // refresh one; doing so would let a stray session leak across requests.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing ${name}. Add it to .env.local. The Diamonds ledger cannot reach Postgres without it.`,
    );
  }
  return v.trim();
}

let cached: DiamondsClient | null = null;

/**
 * Because the tables now sit in the exposed `public` schema, RLS is the only
 * thing protecting them from a browser session -- it is load-bearing, not
 * defence in depth. This client bypasses it, so every query it makes must
 * filter by user id itself.
 */
export function adminDb(): DiamondsClient {
  cached ??= createDiamondsClient();
  return cached;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}
