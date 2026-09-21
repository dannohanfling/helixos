"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONTENT_STATUSES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { contentPoints } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";
import { redirect } from "next/navigation";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";
import { carriesUnreviewed, originAfterAccept, originAfterSave } from "@/lib/engine/provenance";
import { recordConfirm } from "@/lib/provenance";

export async function createContentAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const title = str(formData, "title");
  if (!title) return;
  const postDate = opt(formData, "postDate");
  const status = CONTENT_STATUSES.find((s) => s === str(formData, "status")) ?? (postDate ? "scheduled" : "idea");
  await db.insert(schema.contentItems).values({
    id: newId(),
    workspaceId,
    userId,
    title,
    status,
    contentType: str(formData, "contentType") || "CTA Post",
    platform: str(formData, "platform") || "FB Group",
    hasCta: formData.get("hasCta") === "on",
    hook: opt(formData, "hook"),
    body: opt(formData, "body"),
    cta: opt(formData, "cta"),
    postAt: postDate ? `${postDate}T${str(formData, "postTime") || "09:00"}:00` : null,
    notes: opt(formData, "notes"),
    postedAt: status === "posted" ? nowIso() : null,
  });
  void v;
  refresh();
}

export async function updateContentAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const postDate = opt(formData, "postDate");
  const wanted = CONTENT_STATUSES.find((s) => s === str(formData, "status"));
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  const body = opt(formData, "body");
  // Scheduled or posted is the post going out. An AI draft nobody has read, sent as it stands, is held: the rest of the form
  // saves, the status stays, and the page names the draft with Review or Continue anyway. confirm=1 is logged with who and when.
  const goingOut = (wanted === "scheduled" || wanted === "posted") && wanted !== item.status;
  const unread = carriesUnreviewed(item.origin, item.body, body);
  const held = goingOut && unread && str(formData, "confirm") !== "1";
  const status = held ? undefined : wanted;
  if (goingOut && unread && !held) await recordConfirm({ workspaceId, userId, userName: v.user.name }, "post_status", item.id, [item.title]);
  await db
    .update(schema.contentItems)
    .set({
      title: str(formData, "title") || undefined,
      contentType: str(formData, "contentType") || undefined,
      platform: str(formData, "platform") || undefined,
      hasCta: formData.get("hasCta") === "on",
      hook: opt(formData, "hook"),
      body,
      origin: originAfterSave(item.origin, item.body, body),
      cta: opt(formData, "cta"),
      postAt: postDate ? `${postDate}T${str(formData, "postTime") || "09:00"}:00` : null,
      postLink: opt(formData, "postLink"),
      engagements: num(formData, "engagements"),
      views: num(formData, "views"),
      leads: num(formData, "leads"),
      notes: opt(formData, "notes"),
      ...(status ? { status } : {}),
    })
    .where(and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)));
  refresh();
  if (held) redirect(`/content/${id}?gate=status&status=${wanted}`);
}

/** Accept: the coach has read this post's AI draft and keeps it. One post per click; nothing accepts more than one. */
export async function acceptContentAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  await db.update(schema.contentItems).set({ origin: originAfterAccept(item.origin) }).where(eq(schema.contentItems.id, id));
  refresh();
}

export async function setContentStatusAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const status = CONTENT_STATUSES.find((s) => s === str(formData, "status"));
  if (!status) return;
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  // The same gate as the form's status: a quick status change from the board or Today sends the post to its page to see the line.
  if ((status === "scheduled" || status === "posted") && status !== item.status && carriesUnreviewed(item.origin, item.body, item.body)) {
    if (str(formData, "confirm") !== "1") redirect(`/content/${id}?gate=status&status=${status}`);
    await recordConfirm({ workspaceId, userId, userName: v.user.name }, "post_status", item.id, [item.title]);
  }
  await db
    .update(schema.contentItems)
    .set({ status, postedAt: status === "posted" ? (item.postedAt ?? nowIso()) : null, postLink: opt(formData, "postLink") ?? item.postLink })
    .where(eq(schema.contentItems.id, id));
  if (status === "posted") {
    await award({ workspaceId, userId }, "content", contentPoints(item.hasCta), `Posted: ${item.title}`, item.id);
  }
  refresh();
  // A confirmed send returns to the post at a clean address, so the answered gate is not shown again.
  if (str(formData, "confirm") === "1") redirect(`/content/${id}`);
}

export async function deleteContentAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.contentItems).where(and(eq(schema.contentItems.id, str(formData, "id")), eq(schema.contentItems.userId, userId)));
  refresh();
}
