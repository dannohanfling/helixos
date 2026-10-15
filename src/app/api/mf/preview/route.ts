import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { composePage, setupFor } from "@/lib/mf/data";
import { savePreview } from "@/lib/mf/preview";
import { DAILY_CAP_DEFAULT, MF_MAX, clip, cleanFirstName } from "@/lib/engine/magic-funnel";

/** The preview runs the writer's calls (the profile, the page, the checks' rewrite): well over a plain action's time. */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * The preview, streamed (H-142): one line of JSON per step as the writer goes, so the page shows the default copy at once,
 * the profile when read, the first draft when written, and the final page after the checks, with the code that opens it as
 * the real page. The member's own session; a coach switched in may run it (nothing is stored on the client's record); a
 * team member may not. Nothing of the prospect's words is logged.
 */
export async function POST(request: Request) {
  const v = await apiViewer();
  if (!v) return Response.json({ error: "Sign in first." }, { status: 401, headers: { "cache-control": "private, no-store" } });
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Say who the page is for." }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : "");
  const m = { workspaceId: v.workspace.id, userId: v.user.id };
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, str("webinarId")), eq(schema.webinars.workspaceId, m.workspaceId), eq(schema.webinars.userId, m.userId)) });
  if (!w) return Response.json({ error: "That webinar isn't yours." }, { status: 404 });
  const setup = await setupFor(m, w.id);
  if (!setup) return Response.json({ error: "Save the setup first, then preview it." }, { status: 409 });
  const pain = clip(str("pain"), MF_MAX.pain);
  const industry = clip(str("industry"), MF_MAX.industry);
  const summary = clip(str("summary"), MF_MAX.summary);
  if (!pain && !summary) return Response.json({ error: "Type their biggest pain or a sample conversation." }, { status: 400 });
  const firstName = cleanFirstName(str("firstName")) || "Sam";
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        send({ kind: "started", at: Date.now() });
        const r = await composePage({ member: m, tz: v.tz, cap: v.membership.mfDailyCap ?? DAILY_CAP_DEFAULT, webinar: w, setup, firstName, said: { pain, industry, summary }, custom: {}, on: (e) => send(e) });
        const code = await savePreview(m, { webinarId: w.id, firstName, pitch: r.pitch, sources: r.sources });
        send({ kind: "final", profile: r.profile, pitch: r.pitch, sources: r.sources, status: r.status, note: r.note, failed: r.failed, code });
      } catch (e) {
        console.error("[mf] preview failed", JSON.stringify({ name: (e as { name?: string })?.name ?? "error" }));
        send({ kind: "error", error: "The writer didn't answer. Try again in a moment." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "private, no-store", "x-accel-buffering": "no" } });
}
