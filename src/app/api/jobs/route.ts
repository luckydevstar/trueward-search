import { NextResponse } from "next/server";

import { asUser, fail, fromError } from "@/lib/http";
import { insertJob, listJobs, updateJob, getJob } from "@/lib/db";

export async function GET(request: Request) {
  const auth = await asUser();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 2000);

  try {
    return NextResponse.json(
      await listJobs(auth.db, {
        status: url.searchParams.get("status") || "active",
        source: url.searchParams.get("source") || undefined,
        q: url.searchParams.get("q") || undefined,
        limit,
        offset: Number(url.searchParams.get("offset")) || 0,
      }),
    );
  } catch (error) {
    return fromError(error);
  }
}

/** Manual entry: a job found somewhere no scraper covers. */
export async function POST(request: Request) {
  const auth = await asUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const { title, url, company, location, salary, description, postedAt, notes } = body ?? {};

  if (!title?.trim() || !url?.trim()) return fail("title and url are required");
  if (!/^https?:\/\//i.test(url)) return fail("url must start with http(s)://");

  try {
    const id = await insertJob(
      auth.db,
      {
        source: "manual",
        // Timestamped rather than random, so two manual entries are distinct
        // and the id says when it was made.
        sourceId: `manual-${Date.now()}`,
        title,
        company,
        location,
        url,
        salary,
        description,
        postedAt: postedAt || new Date().toISOString(),
      },
      { manual: true },
    );
    if (!id) return fail("The job was not created", 500);
    const job = notes ? await updateJob(auth.db, id, { notes }) : await getJob(auth.db, id);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    return fromError(error);
  }
}
