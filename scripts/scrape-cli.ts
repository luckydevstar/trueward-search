/**
 * Scrape from the terminal, without the app running.
 *
 *   npm run scrape                 # every source
 *   npm run scrape -- linkedin     # one or more by name
 *
 * The service-role client lives *here*, in a script you run by hand, and
 * nowhere under src/. That is deliberate and is the whole shape of the
 * decision: the app itself never holds a credential that bypasses RLS,
 * because the only thing that would need one — a scheduled run with nobody
 * behind it — does not exist. Refreshing is a button, pressed by an admin,
 * under their own session.
 *
 * A command line has no session either, hence the key. It is read from your
 * local .env and is not a deployment variable.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Scraping from the terminal needs NEXT_PUBLIC_SUPABASE_URL and " +
      "SUPABASE_SERVICE_ROLE_KEY in .env — there is no session to carry, so " +
      "RLS has to be bypassed.",
  );
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { runAll, SOURCES } = await import("../src/lib/scrape/run.js");

const names = process.argv.slice(2);
const unknown = names.filter((n) => !SOURCES.some((s) => s.name === n));
if (unknown.length) {
  console.error(`Unknown source(s): ${unknown.join(", ")}`);
  console.error(`Known: ${SOURCES.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

const results = await runAll(db, names.length ? names : undefined);
for (const r of results) {
  console.log(
    r.error
      ? `${r.source}: ${r.error}`
      : `${r.source}: fetched ${r.fetched}, passed ${r.accepted}, new ${r.inserted}`,
  );
}
