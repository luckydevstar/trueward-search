import { NextResponse } from "next/server";

import { asUser, fromError } from "@/lib/http";
import { isRunning, runAll } from "@/lib/scrape/run";

/**
 * Scraping is slow — several boards, each throttling itself — so the function
 * is given the longest window the platform allows rather than the default few
 * seconds. Each source records its own run row as it finishes, so a run cut
 * short by the cap leaves the sources that completed updated rather than
 * losing the lot.
 *
 * On a Vercel Hobby plan the real cap is 60s regardless of this number, which
 * will usually cut a full sweep short. Refreshing again picks up where it
 * left off — the sources that finished are skipped by their own `known` sets
 * — or narrow the run by passing `{ "sources": ["linkedin"] }`.
 */
export const maxDuration = 300;

/**
 * Scrape now.
 *
 * There is one way in and it is a person pressing the button: the run uses
 * the signed-in admin's own client, so RLS applies exactly as it does to
 * every other request.
 *
 * That is the whole reason this app holds **no service-role key**. A
 * scheduled run would have nobody behind it and therefore no `auth.uid()` for
 * the policies to test, which is what would force one in — so there is no
 * schedule, by choice. A key that bypasses RLS on a database that also stores
 * candidate SSNs has no business in a web deployment if nothing needs it.
 */
export async function POST(request: Request) {
  const auth = await asUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const sources = Array.isArray(body?.sources) ? body.sources : undefined;

  try {
    if (await isRunning(auth.db)) {
      return NextResponse.json(
        { started: false, message: "A refresh is already running" },
        { status: 202 },
      );
    }

    /*
     * Awaited, not fired and forgotten.
     *
     * On a serverless platform the process is frozen the moment the response
     * is returned, so a promise left running is a promise that silently stops
     * half-way. The client polls /api/status rather than waiting on this
     * response, so the long request costs it nothing.
     */
    const results = await runAll(auth.db, sources);
    return NextResponse.json({ started: true, results });
  } catch (error) {
    return fromError(error);
  }
}
