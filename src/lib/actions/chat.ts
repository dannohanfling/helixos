"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ctx, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { linkState } from "@/lib/engine/chat";
import { chatLinkByToken, postChatWebhook } from "@/lib/chat";

/**
 * "Tap to confirm it's you" (rev 241): the signed-in member ties a chat to their account. Only their own verified email is ever
 * sent, and only after the bot's webhook took it; a link that failed to post can be tried again until it expires.
 */
export async function confirmChatLinkAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "Linked chats are {first}'s own: they can't be changed from their HelixOS." });
  const token = str(formData, "token");
  const row = await chatLinkByToken(token);
  if (!row) redirect("/settings?chat=missing#linked-chats");
  const state = linkState(row!, workspaceId, Date.now());
  if (state !== "ok") redirect(`/link-chat/${token}`);
  const sent = await postChatWebhook(workspaceId, userId, { event: "link", user_ns: row!.userNs, channel: row!.channel, email: v.user.email.toLowerCase(), name: v.user.name, at: nowIso() });
  if (!sent.ok) redirect(`/link-chat/${token}?error=${encodeURIComponent(sent.note)}`);
  const at = nowIso();
  await db.update(schema.chatLinks).set({ userId, usedAt: at, linkedAt: at }).where(and(eq(schema.chatLinks.id, row!.id), isNull(schema.chatLinks.usedAt)));
  redirect("/settings?chat=linked#linked-chats");
}

/** "Let my coach's assistant know my progress" (rev 241): the member's own switch, on by default. */
export async function setChatProgressShareAction(formData: FormData): Promise<void> {
  const { v, workspaceId } = await ctx({ whileSwitched: "refuse", reason: "That's {first}'s own consent to give, so it can't be changed from their HelixOS." });
  const on = str(formData, "chatProgressShare") === "on";
  if (v.membership.chatProgressShare !== on) await db.update(schema.memberships).set({ chatProgressShare: on }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, workspaceId)));
  redirect(`/settings?chat=${on ? "share-on" : "share-off"}#linked-chats`);
}

/** The member's own choice, always honoured here; the bot is told, and a failed telling is in the coach's sync log. */
export async function unlinkChatAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "Linked chats are {first}'s own: they can't be changed from their HelixOS." });
  const id = str(formData, "id");
  const row = await db.query.chatLinks.findFirst({ where: and(eq(schema.chatLinks.id, id), eq(schema.chatLinks.workspaceId, workspaceId), eq(schema.chatLinks.userId, userId), isNull(schema.chatLinks.unlinkedAt)) });
  if (!row) redirect("/settings#linked-chats");
  await db.update(schema.chatLinks).set({ unlinkedAt: nowIso() }).where(eq(schema.chatLinks.id, row!.id));
  await postChatWebhook(workspaceId, userId, { event: "unlink", user_ns: row!.userNs, channel: row!.channel, email: v.user.email.toLowerCase(), at: nowIso() });
  redirect("/settings?chat=unlinked#linked-chats");
}
