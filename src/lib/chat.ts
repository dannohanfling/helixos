/**
 * Community Loyalty web chat and SSO (revs 241, 243, 247), the server side. The coach sets it up on the Integrations page's
 * Community Loyalty card (widget id, the sub flow for members, a sealed secret, a sealed inbound webhook URL, on or off).
 * HelixOS then: renders the widget for signed-in members with a server-computed identifier hash, never while a coach is
 * switched into a client; turns the bot's "link this chat" request into a one-time link the member confirms; and posts
 * `link`, `unlink` and `progress` to the coach's bot. The secret and the URL never reach the browser, a log line or a page.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { hashSecret, open } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { getIntegration, logSync } from "@/lib/integrations";
import { appUrl } from "@/lib/branded-email";
import { LINK_TTL_MS, identifierHash, isFlowNs, isWidgetId, widgetSrc, type ChatChannel, type ChatEvent } from "@/lib/engine/chat";

export type ChatConfig = { on: boolean; widgetId: string | null; flowNs: string | null; secret: string | null; webhookUrl: string | null };

/** The workspace's chat settings, read once per request. An id that isn't one reads as unset rather than reaching a script tag. */
export const chatConfig = cache(async (workspaceId: string): Promise<ChatConfig> => {
  const integ = await getIntegration(workspaceId, "community_loyalty");
  const c = integ?.config ?? {};
  const widgetId = c.chatWidgetId && isWidgetId(c.chatWidgetId) ? c.chatWidgetId : null;
  const flowNs = c.chatFlowNs && isFlowNs(c.chatFlowNs) ? c.chatFlowNs : null;
  return { on: c.chatOn === "1", widgetId, flowNs, secret: open(c.chatSecret) || null, webhookUrl: open(c.chatWebhookUrl) || null };
});

export type ChatWidgetProps = { src: string; userId: string; name: string; email: string; hash: string; flowNs: string | null };

/**
 * What the widget needs for this page, or null when it must not load: chat off or not set up, or a coach switched into a
 * client's HelixOS (the chat would sign the coach in as the client). The hash is computed here, on the server, every render.
 */
export async function chatWidgetProps(v: Viewer): Promise<ChatWidgetProps | null> {
  // Nor for a team member (Danno, 6 Oct): the widget would sign them in to the chat as the owner.
  if (v.switchedInto || v.team) return null;
  const c = await chatConfig(v.workspace.id);
  if (!c.on || !c.widgetId || !c.secret) return null;
  return { src: widgetSrc(c.widgetId), userId: v.user.id, name: v.user.name, email: v.user.email.toLowerCase(), hash: identifierHash(v.user.id, c.secret), flowNs: c.flowNs };
}

type Payload = { event: ChatEvent } & Record<string, string | null>;

/**
 * One post to the coach's bot. Logged in the sync log as the event and the channel or reason only: never the email, never the
 * URL. A network failure or a 5xx is tried once more; a 4xx is the bot's answer and is not retried.
 */
export async function postChatWebhook(workspaceId: string, userId: string | null, payload: Payload): Promise<{ ok: boolean; note: string }> {
  const c = await chatConfig(workspaceId);
  const logged = { event: payload.event, ...(payload.channel ? { channel: payload.channel } : {}), ...(payload.reason ? { reason: payload.reason } : {}) };
  if (!c.webhookUrl) {
    await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "out", event: `chat.${payload.event}`, payload: logged, status: "skipped", note: "No inbound webhook URL on the Community Loyalty card." });
    return { ok: false, note: "Your coach's assistant isn't connected yet." };
  }
  let note = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(c.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-helix-event": payload.event }, body: JSON.stringify(payload), signal: ctrl.signal });
      clearTimeout(t);
      note = `${res.status} ${res.statusText}`.trim();
      if (res.ok) {
        await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "out", event: `chat.${payload.event}`, payload: logged, status: "sent", note });
        return { ok: true, note };
      }
      if (res.status < 500) break;
    } catch (e) {
      note = e instanceof Error && e.name === "AbortError" ? "timed out after 6 seconds" : "network error";
    }
  }
  await logSync({ workspaceId, userId, provider: "community_loyalty", direction: "out", event: `chat.${payload.event}`, payload: logged, status: "failed", note });
  return { ok: false, note: `Couldn't reach your coach's assistant (${note}).` };
}

/** The bot asked for a link: a fresh token, its hash stored, the URL for the bot to send. */
export async function startChatLink(workspaceId: string, userNs: string, channel: ChatChannel): Promise<{ url: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
  await db.insert(schema.chatLinks).values({ id: newId(), workspaceId, userNs, channel, tokenHash: hashSecret(token), expiresAt });
  await logSync({ workspaceId, provider: "community_loyalty", direction: "in", event: "chat.link_start", payload: { channel }, status: "received", note: `A ${channel} chat asked to be linked` });
  return { url: `${appUrl()}/link-chat/${token}`, expiresAt };
}

export async function chatLinkByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return (await db.query.chatLinks.findFirst({ where: eq(schema.chatLinks.tokenHash, hashSecret(token)) })) ?? null;
}

/** The member's linked chats, newest first. */
export async function linkedChats(workspaceId: string, userId: string) {
  return db.query.chatLinks.findMany({ where: and(eq(schema.chatLinks.workspaceId, workspaceId), eq(schema.chatLinks.userId, userId), isNotNull(schema.chatLinks.linkedAt), isNull(schema.chatLinks.unlinkedAt)), orderBy: desc(schema.chatLinks.linkedAt) });
}

export const stamp = nowIso;
