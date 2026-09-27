import { NextResponse } from "next/server";

import { asUser, fromError } from "@/lib/http";
import { dismissJob, getJob } from "@/lib/db";

/** Bulk "clear everything I've seen". Jobs marked applied are left alone. */
export async function POST(request: Request) {
  const auth = await asUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];

  try {
    const dismissed: number[] = [];
    for (const id of ids) {
      // Checked one at a time because only `new` jobs are cleared — an
      // applied job in the selection is deliberately kept, and a bulk update
      // could not tell the difference in its result.
      const job = await getJob(auth.db, id);
      if (job?.status === "new" && (await dismissJob(auth.db, id))) dismissed.push(id);
    }
    return NextResponse.json({ dismissed });
  } catch (error) {
    return fromError(error);
  }
}
