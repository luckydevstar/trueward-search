/**
 * Scrape from the terminal, without the app running.
 *
 * Uses the service-role key for the same reason the cron route does: there is
 * no session on a command line, so there is no auth.uid() for RLS to test.
 *
 *   npm run scrape                 # every source
 *   npm run scrape -- linkedin     # one or more by name
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const { scraperDb } = await import("../src/lib/supabase/scraper");
const { runAll, SOURCES } = await import("../src/lib/scrape/run.js");

const names = process.argv.slice(2);
const unknown = names.filter((n) => !SOURCES.some((s) => s.name === n));
if (unknown.length) {
  console.error(`Unknown source(s): ${unknown.join(", ")}`);
  console.error(`Known: ${SOURCES.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

const results = await runAll(scraperDb(), names.length ? names : undefined);
for (const r of results) {
  console.log(
    r.error
      ? `${r.source}: ${r.error}`
      : `${r.source}: fetched ${r.fetched}, passed ${r.accepted}, new ${r.inserted}`,
  );
}
