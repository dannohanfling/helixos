import { NextResponse } from "next/server";
import { handleInbound } from "@/lib/webhooks";
import { reportError } from "@/lib/report-error";

/** POST /api/webhooks/ghl with header `x-helix-secret` (or ?secret=). Events: contact.created, appointment.booked, opportunity.*. */
export async function POST(request: Request) {
  try {
    return await handleInbound("gohighlevel", request);
  } catch (e) {
    // A failed inbound (H-349 §2): Danno is told under this job's name; the sender gets a 500 and retries on its own schedule.
    reportError(e, { job: "webhook:gohighlevel" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
