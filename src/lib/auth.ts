import "server-only";

/**
 * Authorisation.
 *
 * The distinction this module exists to enforce: being SIGNED IN is not the
 * same as being ALLOWED IN.
 *
 * Supabase Auth is scoped to the PROJECT, not to a schema. This project is
 * shared with a separate live application that has its own real users, so any
 * one of those users can obtain a perfectly valid session for this Supabase
 * project. If the terminal only checked "is there a session?", every user of
 * that other application would have an account here.
 *
 * So access is an explicit allowlist of owner emails, checked on the server on
 * every request. The list lives in the environment rather than the database,
 * which means changing who has access is a deploy rather than a row anybody
 * with database access could edit.
 */

import { createSupabaseServerClient } from "./supabase/server";
import { isAllowed, ownerEmails } from "./auth-policy";

export { isAllowed, ownerEmails };

export interface Viewer {
  id: string;
  email: string;
}

/**
 * The authorised viewer, or null.
 *
 * Uses `getClaims()`, which verifies the token's signature. `getSession()` must
 * never be used for this: it returns whatever is in the cookie without
 * validating it, so a forged cookie would pass.
 *
 * NOTE ON EMAIL AS THE KEY: the email comes from the verified token claims, not
 * from `user_metadata`. That matters -- `user_metadata` is user-editable and
 * appears in the JWT, so anyone could set their own display fields and walk
 * straight through an allowlist that trusted them.
 */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const claims = data.claims as { sub?: string; email?: string };
  if (!claims.sub || !isAllowed(claims.email)) return null;

  return { id: claims.sub, email: claims.email as string };
}

/**
 * The viewer, or an error.
 *
 * Every server action and every data read calls this. Middleware already
 * redirects unauthenticated requests, but middleware is a convenience for
 * humans, not a security boundary: a server action can be invoked directly. The
 * check has to live next to the data.
 */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    throw new Error("Not authorised.");
  }
  return viewer;
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
      ownerEmails().length > 0,
  );
}
