import { handleInbound } from "@/lib/webhooks";

/** POST /api/webhooks/ghl with header `x-helix-secret` (or ?secret=). Events: contact.created, appointment.booked, opportunity.*. */
export async function POST(request: Request) {
  return handleInbound("gohighlevel", request);
}
