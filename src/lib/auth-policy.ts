/**
 * The allowlist, as pure logic.
 *
 * Deliberately free of `server-only`, `next/headers`, and any Supabase import
 * so it can be used from middleware, which runs in a restricted runtime and
 * breaks on transitive Node-only imports. `lib/auth.ts` builds on this; keep
 * that dependency one-way.
 */

/** Emails permitted to use this terminal. */
export function ownerEmails(): string[] {
  return (process.env.DIAMONDS_OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * With no allowlist configured, NOTHING is authorised.
 *
 * Failing closed is deliberate. An empty variable is far more likely to be a
 * misconfigured deploy than an intention to let the world in, and the cost of
 * guessing wrong is handing a stranger the bet log.
 */
export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = ownerEmails();
  if (allow.length === 0) return false;
  return allow.includes(email.toLowerCase());
}
