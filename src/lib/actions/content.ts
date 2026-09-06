"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONTENT_STATUSES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { contentPoints } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";

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
    postAt: postDate ? `${postDate}T${str(formData, "postTime") || "09:00"}:00` : null,
    notes: opt(formData, "notes"),
    postedAt: status === "posted" ? nowIso() : null,
  });
  void v;
  refresh();
}

export async function updateContentAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const postDate = opt(formData, "postDate");
  const status = CONTENT_STATUSES.find((s) => s === str(formData, "status"));
  await db
    .update(schema.contentItems)
    .set({
      title: str(formData, "title") || undefined,
      contentType: str(formData, "contentType") || undefined,
      platform: str(formData, "platform") || undefined,
      hasCta: formData.get("hasCta") === "on",
      hook: opt(formData, "hook"),
      body: opt(formData, "body"),
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
}

export async function setContentStatusAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const status = CONTENT_STATUSES.find((s) => s === str(formData, "status"));
  if (!status) return;
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  await db
    .update(schema.contentItems)
    .set({ status, postedAt: status === "posted" ? (item.postedAt ?? nowIso()) : null, postLink: opt(formData, "postLink") ?? item.postLink })
    .where(eq(schema.contentItems.id, id));
  if (status === "posted") {
    await award({ workspaceId, userId }, "content", contentPoints(item.hasCta), `Posted: ${item.title}`, item.id);
  }
  refresh();
}

export async function deleteContentAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.contentItems).where(and(eq(schema.contentItems.id, str(formData, "id")), eq(schema.contentItems.userId, userId)));
  refresh();
}
