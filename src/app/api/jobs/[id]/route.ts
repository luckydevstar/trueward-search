import { NextResponse } from "next/server";

import { asUser, fail, fromError } from "@/lib/http";
import { STATUSES, deleteJob, dismissJob, getJob, updateJob } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

/**
 * One job, in full.
 *
 * The list only carries a 400-character snippet, because shipping every
 * description to render a list would be most of the payload for none of the
 * page. Expanding a row asks for the rest, once.
 */
export async function GET(_request: Request, { params }: Context) {
  const auth = await asUser();
  if (auth.response) return auth.response;

  try {
    const job = await getJob(auth.db, Number((await params).id));
    return job ? NextResponse.json(job) : fail("Not found", 404);
  } catch (error) {
    return fromError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await asUser();
  if (auth.response) return auth.response;

  const id = Number((await params).id);
  const patch = (await request.json().catch(() => null)) ?? {};

  if (patch.status && !(STATUSES as readonly string[]).includes(patch.status)) {
    return fail(`status must be one of ${STATUSES.join(", ")}`);
  }
  if (patch.url && !/^https?:\/\//i.test(patch.url)) {
    return fail("url must start with http(s)://");
  }

  try {
    if (!(await getJob(auth.db, id))) return fail("Not found", 404);
    return NextResponse.json(await updateJob(auth.db, id, patch));
  } catch (error) {
    return fromError(error);
  }
}

/**
 * Scraped jobs are soft-deleted (status=dismissed) so later scrapes do not
 * bring them back. `?permanent=1` hard-deletes and is only allowed for
 * manually added jobs, which nothing will re-add.
 */
export async function DELETE(request: Request, { params }: Context) {
  const auth = await asUser();
  if (auth.response) return auth.response;

  const id = Number((await params).id);
  try {
    const job = await getJob(auth.db, id);
    if (!job) return fail("Not found", 404);

    const permanent = new URL(request.url).searchParams.get("permanent");
    const ok =
      permanent && job.manual ? await deleteJob(auth.db, id) : await dismissJob(auth.db, id);
    return NextResponse.json({ ok });
  } catch (error) {
    return fromError(error);
  }
}
