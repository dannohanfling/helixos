import { NextResponse } from "next/server";
import { handleInbound } from "@/lib/webhooks";
import { reportError } from "@/lib/report-error";

/** POST /api/webhooks/community-loyalty with header `x-helix-secret` (or ?secret=). Events: pass.installed, points.earned. */
export async function POST(request: Request) {
  try {
    return await handleInbound("community_loyalty", request);
  } catch (e) {
    // A failed inbound (H-349 §2): Danno is told under this job's name; the sender gets a 500 and retries on its own schedule.
    reportError(e, { job: "webhook:community_loyalty" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
