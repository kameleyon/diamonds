import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sign out.
 *
 * POST only. A GET sign-out is CSRF-triggerable by any page that can embed an
 * image pointing at it -- a nuisance rather than a breach, but there is no
 * reason to accept it.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}
