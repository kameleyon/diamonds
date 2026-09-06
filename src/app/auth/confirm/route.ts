import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowed } from "@/lib/auth-policy";

/**
 * Magic-link callback.
 *
 * Verifies the one-time token, then checks the allowlist and signs the user
 * straight back out if they are not on it. Without that second step, anyone
 * with an account on this shared Supabase project would end up holding a valid
 * session cookie for this app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/board";

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  if (!token_hash || !type) return fail("Invalid sign-in link.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) return fail(error.message);

  if (!isAllowed(data.user?.email)) {
    // Valid credentials, wrong person. Drop the session immediately rather than
    // leaving a usable cookie behind.
    await supabase.auth.signOut();
    return fail("That address is not permitted to use this terminal.");
  }

  // Only ever redirect to a path on this origin; an absolute URL here would be
  // an open redirect.
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/board";
  return NextResponse.redirect(`${origin}${target}`);
}
