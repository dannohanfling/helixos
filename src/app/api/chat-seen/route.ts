import { NextResponse } from "next/server";
import { apiViewer } from "@/lib/auth";
import { logSync } from "@/lib/integrations";
import { allow } from "@/lib/rate-limit";
import { cleanHost, isChatCause } from "@/lib/engine/chat-cause";

/**
 * The Ask page's one report on telling the chat who the member is (H-1199, plan H-1203): the cause only, with the blocked host
 * for a CSP block. Logged in the sync log with no member on the row, and as one server log line, so production shows whether
 * setUser runs, how, or what stops it. A coach switched in or a team member has no chat, so nothing is logged for them.
 */
export async function POST(request: Request) {
  const done = () => new NextResponse(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  const v = await apiViewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (v.switchedInto || v.team) return done();
  if (!(await allow(`chat-seen:${v.user.id}`, 10, 60 * 60 * 1000))) return new NextResponse(null, { status: 429 });
  let body: { cause?: unknown; host?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Send the cause." }, { status: 400 });
  }
  if (!isChatCause(body.cause)) return NextResponse.json({ error: "Send the cause." }, { status: 400 });
  const host = body.cause === "csp-blocked" ? cleanHost(body.host) : null;
  console.info(`[chat] identity ${body.cause}${host ? ` ${host}` : ""}`);
  // Inbound and not "chat.*": it is a report from the page, never a post to the bot, so the card's daily count never sees it.
  await logSync({ workspaceId: v.workspace.id, userId: null, provider: "community_loyalty", direction: "in", event: "widget.identity", payload: { cause: body.cause, ...(host ? { host } : {}) }, status: body.cause.startsWith("identified") ? "received" : "failed" });
  return done();
}
