import { NextResponse } from "next/server";
import { integrationForSecret } from "@/lib/webhooks";
import { allow, clientIp } from "@/lib/rate-limit";
import { isChatChannel } from "@/lib/engine/chat";
import { startChatLink } from "@/lib/chat";
import { CHAT_CHANNELS } from "@/db/schema";

/**
 * POST /api/chat-link/start, from the coach's Community Loyalty bot, with the workspace's inbound secret as `x-helix-secret`
 * (the same one the pass and points webhooks use) and `{ "user_ns": "...", "channel": "messenger" }`. Answers `{ url,
 * expires_at }`: a one-time link, good for ten minutes, that the bot sends to the person. Chat channels only: email and SMS
 * run through GoHighLevel (rev 247). Limits: 5 links per chat contact an hour, 60 per workspace an hour.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-helix-secret") ?? "";
  if (!secret) return NextResponse.json({ error: new URL(request.url).searchParams.has("secret") ? "send the secret as the x-helix-secret header, not in the URL" : "missing x-helix-secret header" }, { status: 401 });
  if (!(await allow(`chatlink:ip:${await clientIp()}`, 120, 60 * 60 * 1000))) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const integ = await integrationForSecret("community_loyalty", secret);
  if (!integ) return NextResponse.json({ error: "unknown secret" }, { status: 401 });
  let body: { user_ns?: unknown; channel?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const userNs = typeof body.user_ns === "string" ? body.user_ns.trim() : "";
  const channel = typeof body.channel === "string" ? body.channel.trim().toLowerCase() : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userNs)) return NextResponse.json({ error: "user_ns is required: the chat contact's id" }, { status: 400 });
  if (!isChatChannel(channel)) return NextResponse.json({ error: `channel must be one of ${CHAT_CHANNELS.join(", ")}` }, { status: 400 });
  const [perNs, perWs] = await Promise.all([allow(`chatlink:ns:${integ.workspaceId}:${userNs}`, 5, 60 * 60 * 1000), allow(`chatlink:ws:${integ.workspaceId}`, 60, 60 * 60 * 1000)]);
  if (!perNs || !perWs) return NextResponse.json({ error: "too many links asked for; try again in an hour" }, { status: 429 });
  const link = await startChatLink(integ.workspaceId, userNs, channel);
  return NextResponse.json({ url: link.url, expires_at: link.expiresAt });
}
