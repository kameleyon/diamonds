import "server-only";

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Used to read WHO the caller is. It holds the publishable key and the user's
 * session, not the secret key, so it is subject to RLS like any other client.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // `getAll` / `setAll` is the current contract. The older
      // get/set/remove trio is typed as *Deprecated in @supabase/ssr and
      // mishandles multi-part auth cookies.
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. This is expected and
            // safe to ignore: the middleware refreshes the session, so the
            // write here is redundant rather than load-bearing.
          }
        },
      },
    },
  );
}
