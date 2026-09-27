"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase in the browser, for the one job that has to happen there: signing
 * in, so the session lands in cookies the server can then read.
 *
 * Everything else still goes through the BFF in src/app/api/ — this is not a
 * second data path.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
