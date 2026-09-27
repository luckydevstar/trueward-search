import { NextResponse } from "next/server";

import { asUser, fromError } from "@/lib/http";
import { updateJob } from "@/lib/db";

/** Undo for the bulk dismiss above. */
export async function POST(request: Request) {
  const auth = await asUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];

  try {
    for (const id of ids) await updateJob(auth.db, id, { status: "new" });
    return NextResponse.json({ restored: ids.length });
  } catch (error) {
    return fromError(error);
  }
}
