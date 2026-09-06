"use client";

/**
 * Browser Supabase client. Auth only.
 *
 * This client carries the PUBLISHABLE key, which is designed to be public: it
 * can do nothing that Row Level Security does not permit. It is used purely to
 * sign in and out. It cannot reach the `diamonds` schema, which is not exposed
 * to the Data API at all -- ledger reads and writes go through server code.
 */

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
