import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST, not GET: a link a browser can prefetch should never end a session.
 */
export async function POST(request: Request) {
  const db = await createClient();
  await db.auth.signOut();
  // 303 so the browser follows with GET rather than repeating the POST.
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
