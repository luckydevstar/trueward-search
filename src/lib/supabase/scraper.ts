import { createClient } from "@supabase/supabase-js";

/**
 * The one client that bypasses RLS, for the one job that has no person
 * behind it.
 *
 * A scheduled scrape has no session, so there is no `auth.uid()` for the
 * policies in supabase/schema.sql to test — it needs the service-role key.
 * That key is the thing worth being careful about: it can read every table in
 * a database that also stores candidate SSNs.
 *
 * Two things keep it narrow. It is only ever reached from the cron branch of
 * /api/refresh, which requires CRON_SECRET; and the manual "Refresh now"
 * button does *not* use it — that runs as the signed-in admin, under RLS,
 * because there is a person there to be.
 *
 * Built lazily: `next build` imports every route module to collect its
 * configuration, and a client constructed at module scope would run during
 * the build, before any environment existed.
 */
let client: ReturnType<typeof createClient> | null = null;

export function scraperDb() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Scheduled scraping needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
