"use server";

import { deletedTo } from "@/lib/deleted";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CONTENT_STATUSES } from "@/db/schema";
import { nowIso } from "@/lib/dates";
import { contentPoints } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";
import { redirect } from "next/navigation";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";
import { carriesUnreviewed, originAfterAccept, originAfterSave } from "@/lib/engine/provenance";
import { recordConfirm } from "@/lib/provenance";
import { createContentItem } from "@/lib/content-core";
import { markDraftEdited } from "@/lib/claude-drafts";

export async function createContentAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const title = str(formData, "title");
  if (!title) return;
  // The one add (src/lib/content-core.ts), the same the connector's idea_add uses.
  await createContentItem({ workspaceId, userId }, { title, status: str(formData, "status"), contentType: str(formData, "contentType"), platform: str(formData, "platform"), hasCta: formData.get("hasCta") === "on", hook: opt(formData, "hook"), body: opt(formData, "body"), cta: opt(formData, "cta"), postDate: opt(formData, "postDate"), postTime: str(formData, "postTime"), notes: opt(formData, "notes") });
  refresh();
}

export async function updateContentAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
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
  // Saved from the form opened with Claude's draft in it (H-184): that draft is settled as edited.
  const draftId = str(formData, "draftId");
  if (draftId) await markDraftEdited({ workspaceId, userId }, draftId, id, { name: v.actor.name, connector: false });
  refresh();
  if (held) redirect(`/content/${id}?gate=status&status=${wanted}`);
  if (draftId) redirect(`/content/${id}?draftNote=edited`);
}

/** Accept: the coach has read this post's AI draft and keeps it. One post per click; nothing accepts more than one. */
export async function acceptContentAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  await db.update(schema.contentItems).set({ origin: originAfterAccept(item.origin) }).where(eq(schema.contentItems.id, id));
  refresh();
}

export async function setContentStatusAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
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
  const { userId } = await ctx({ team: "allow" });
  await db.delete(schema.contentItems).where(and(eq(schema.contentItems.id, str(formData, "id")), eq(schema.contentItems.userId, userId)));
  refresh();
  // Back to the list, never left on the deleted post's own address (that was a 404, 22 Sep).
  redirect(deletedTo("/content", "post"));
}
