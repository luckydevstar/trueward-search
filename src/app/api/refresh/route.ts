import { NextResponse } from "next/server";

import { asUser, fail, fromError } from "@/lib/http";
import { scraperDb } from "@/lib/supabase/scraper";
import { isRunning, runAll } from "@/lib/scrape/run";

/**
 * Scraping is slow — several boards, each throttling itself — so the function
 * is given the longest window the platform allows rather than the default
 * few seconds. Sources that finish record their own run row, so a run cut
 * short by the cap leaves the finished ones updated rather than losing
 * everything.
 */
export const maxDuration = 300;

/**
 * Two ways in, and they are not the same.
 *
 * A person pressing "Refresh now" runs as themselves, under RLS. The
 * scheduled run has nobody behind it and therefore needs the service-role
 * key — so it must prove it is the scheduler, with CRON_SECRET. Without that
 * secret set, the cron branch is refused outright rather than falling back to
 * an unauthenticated path that writes to the database.
 */
export async function POST(request: Request) {
  const header = request.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET;
  const isCron = Boolean(secret) && header === `Bearer ${secret}`;

  const body = await request.json().catch(() => null);
  const sources = Array.isArray(body?.sources) ? body.sources : undefined;

  let db;
  if (isCron) {
    db = scraperDb();
  } else {
    const auth = await asUser();
    if (auth.response) return auth.response;
    db = auth.db;
  }

  try {
    if (await isRunning(db)) {
      return NextResponse.json(
        { started: false, message: "A refresh is already running" },
        { status: 202 },
      );
    }
  } catch (error) {
    return fromError(error);
  }

  /*
   * Awaited, not fired and forgotten.
   *
   * On a serverless platform the process is frozen the moment the response is
   * returned, so a promise left running is a promise that silently stops
   * half-way. The client polls /api/status rather than waiting on this
   * response, so the long request costs it nothing.
   */
  try {
    const results = await runAll(db, sources);
    return NextResponse.json({ started: true, results });
  } catch (error) {
    return fromError(error);
  }
}

/** Vercel Cron issues GET, so it maps onto the same handler. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail("CRON_SECRET is not set, so scheduled runs are refused.", 503);
  if ((request.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return fail("Not the scheduler", 401);
  }
  return POST(new Request(request.url, { method: "POST", headers: request.headers, body: "{}" }));
}
