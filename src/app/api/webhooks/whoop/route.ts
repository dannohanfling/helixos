import { NextResponse } from "next/server";
import { handleWhoopEvent } from "@/lib/body-whoop";
import { WEBHOOK_TYPES, type WebhookEvent } from "@/lib/engine/body-whoop";
import { webhookOk } from "@/lib/whoop";
import { allow, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/webhooks/whoop: WHOOP's webhook, proved by `X-WHOOP-Signature` (HMAC-SHA256 of the timestamp and the raw body with
 * this app's client secret) and `X-WHOOP-Signature-Timestamp`. `{ user_id, id, type }`: the member is found by WHOOP user id,
 * the one resource fetched and written. Always 200 once proved, so WHOOP doesn't retry what we chose to skip; 401 otherwise.
 */
export async function POST(request: Request) {
  if (!(await allow(`whoop:ip:${await clientIp()}`, 600, 60 * 60 * 1000))) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const raw = await request.text();
  if (!webhookOk(request.headers.get("x-whoop-signature-timestamp"), request.headers.get("x-whoop-signature"), raw)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let event: WebhookEvent = {};
  try {
    event = JSON.parse(raw) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (!event.type || !(WEBHOOK_TYPES as readonly string[]).includes(event.type)) return NextResponse.json({ ok: true, skipped: "type" });
  try {
    const handled = await handleWhoopEvent(event);
    return NextResponse.json({ ok: true, handled });
  } catch {
    // A pull that failed (WHOOP down, a token gone): say so without detail; the next sync catches up.
    return NextResponse.json({ ok: true, handled: false });
  }
}
