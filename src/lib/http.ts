import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** One error shape for the whole API: `{ error }` plus a status. */
export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export function missingEnv(): string[] {
  return REQUIRED.filter((name) => !process.env[name]);
}

/**
 * The client for a request made by a person, plus the refusal if there isn't
 * one.
 *
 * The proxy has already turned anonymous /api requests into 401s, so this is
 * the second of two checks rather than the only one — but it is the one that
 * cannot be skipped by a route the proxy's matcher stops covering.
 */
export async function asUser() {
  const missing = missingEnv();
  if (missing.length) {
    return {
      response: fail(
        `The server is missing ${missing.join(" and ")}. Set ${
          missing.length > 1 ? "them" : "it"
        } in the deployment's environment variables and redeploy.`,
        503,
      ),
    };
  }

  const db = await createClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return { response: fail("Not signed in", 401) };
  return { db, userId: data.claims.sub as string };
}

/**
 * Turns a thrown query error into a status and a sentence.
 *
 * The missing-table case is named because it is the one a correct deployment
 * still hits — on the first deploy, before the schema has been run.
 */
export function fromError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Could not find the table|relation .* does not exist/i.test(message)) {
    return fail(
      "The search tables aren't in the database yet — run supabase/schema.sql in the Supabase SQL editor.",
      503,
    );
  }
  return fail(message, 500);
}
