import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { logSync } from "@/lib/integrations";
import { verifyStandardWebhook, type RawMeeting } from "@/lib/engine/recordings";
import { FATHOM_PROVIDER, ingestMeeting } from "@/lib/recordings";

/**
 * POST /api/webhooks/fathom/<connection id>: Fathom's call when one of the coach's recordings is ready. The connection id in the
 * path names the workspace (Fathom can't send headers of ours); the call proves itself with the Standard Webhooks signature over
 * the raw body, verified with the secret Fathom gave when the webhook was registered (sealed on the connection). Nothing is
 * accepted unsigned. The payload is the meeting with its summary and action items; the transcript is never in it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  if (!/^[\w-]+$/.test(connectionId)) return NextResponse.json({ error: "unknown connection" }, { status: 404 });
  const conn = await db.query.fathomWorkspaceConnections.findFirst({ where: eq(schema.fathomWorkspaceConnections.id, connectionId) });
  if (!conn) return NextResponse.json({ error: "unknown connection" }, { status: 404 });
  const raw = await request.text();
  const secret = open(conn.webhookSecretEncrypted) ?? "";
  const check = verifyStandardWebhook(secret, { id: request.headers.get("webhook-id"), timestamp: request.headers.get("webhook-timestamp"), signature: request.headers.get("webhook-signature") }, raw);
  if (!check.ok) {
    await logSync({ workspaceId: conn.workspaceId, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.webhook", payload: { bytes: raw.length }, status: "failed", note: `Refused: ${check.reason}` });
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let body: RawMeeting = {};
  try {
    body = raw ? (JSON.parse(raw) as RawMeeting) : {};
  } catch {
    body = {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  const out = await ingestMeeting(conn, body, "webhook");
  if (!out) {
    await logSync({ workspaceId: conn.workspaceId, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.webhook", payload: {}, status: "skipped", note: "No recording id in the payload" });
    return NextResponse.json({ ok: true, note: "no recording id" });
  }
  const note = `${out.created ? "New" : "Known"} recording, ${out.recording.status}${out.steps ? `, ${out.steps} step${out.steps === 1 ? "" : "s"} suggested` : ""}`;
  await logSync({ workspaceId: conn.workspaceId, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.webhook", payload: { recordingId: out.recording.id, status: out.recording.status, titleMatch: out.recording.titleMatch }, status: "received", note });
  await db.update(schema.fathomWorkspaceConnections).set({ lastSyncAt: nowIso() }).where(eq(schema.fathomWorkspaceConnections.id, conn.id));
  return NextResponse.json({ ok: true, note });
}
