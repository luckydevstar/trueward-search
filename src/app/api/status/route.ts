import { NextResponse } from "next/server";

import { asUser, fromError } from "@/lib/http";
import { counts, getRuns } from "@/lib/db";
import { SOURCES, isRunning } from "@/lib/scrape/run";

export async function GET() {
  const auth = await asUser();
  if (auth.response) return auth.response;

  try {
    const [runs, jobCounts, running] = await Promise.all([
      getRuns(auth.db),
      counts(auth.db),
      isRunning(auth.db),
    ]);

    return NextResponse.json({
      running,
      sources: SOURCES.map((s) => ({
        name: s.name,
        label: s.label,
        enabled: s.enabled ? s.enabled() : true,
        disabledReason: s.enabled && !s.enabled() ? s.disabledReason : null,
      })),
      runs,
      counts: jobCounts,
    });
  } catch (error) {
    return fromError(error);
  }
}
