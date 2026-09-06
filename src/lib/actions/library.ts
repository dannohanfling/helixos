"use server";

import { and, eq, or, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { LIBRARY_KINDS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ctx, num, opt, refresh, str } from "./common";

function fields(fd: FormData) {
  const body = str(fd, "body");
  return {
    kind: LIBRARY_KINDS.find((k) => k === str(fd, "kind")) ?? "post",
    title: str(fd, "title") || body.split("\n")[0].slice(0, 80) || "Untitled",
    contentType: opt(fd, "contentType"),
    pillar: opt(fd, "pillar"),
    angle: opt(fd, "angle"),
    hook: opt(fd, "hook"),
    body,
    cta: opt(fd, "cta"),
    hasCta: fd.get("hasCta") === "on",
    useWhen: opt(fd, "useWhen"),
    whyItWorks: opt(fd, "whyItWorks"),
    example: opt(fd, "example"),
    tags: str(fd, "tags")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

/** Coach or member creates an entry. Coaches can share it with the whole workspace at creation. */
export async function createLibraryPostAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const f = fields(formData);
  if (!f.body && !f.hook) return;
  const shared = v.role === "coach" && formData.get("shared") === "on";
  const id = newId();
  await db.insert(schema.libraryPosts).values({ id, workspaceId, userId: shared ? null : userId, shared, source: shared ? "coach" : "mine", ...f });
  refresh();
  redirect(`/library/${id}`);
}

async function editable(id: string, userId: string, role: "coach" | "client", workspaceId: string) {
  const row = await db.query.libraryPosts.findFirst({ where: eq(schema.libraryPosts.id, id) });
  if (!row) return null;
  const mine = row.userId === userId;
  const coachOwned = role === "coach" && row.workspaceId === workspaceId && row.userId === null;
  return mine || coachOwned ? row : null;
}

export async function updateLibraryPostAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const row = await editable(id, userId, v.role, workspaceId);
  if (!row) return;
  const f = fields(formData);
  await db.update(schema.libraryPosts).set(f).where(eq(schema.libraryPosts.id, id));
  refresh();
}

export async function deleteLibraryPostAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const row = await editable(str(formData, "id"), userId, v.role, workspaceId);
  if (!row) return;
  await db.delete(schema.libraryPosts).where(eq(schema.libraryPosts.id, row.id));
  refresh();
  redirect("/library");
}

/** Coach shares one of their own entries with every member (or takes it back). */
export async function shareLibraryPostAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  if (v.role !== "coach") return;
  const id = str(formData, "id");
  const row = await db.query.libraryPosts.findFirst({ where: and(eq(schema.libraryPosts.id, id), or(eq(schema.libraryPosts.userId, userId), and(isNull(schema.libraryPosts.userId), eq(schema.libraryPosts.workspaceId, workspaceId)))) });
  if (!row) return;
  const share = str(formData, "shared") === "1";
  await db.update(schema.libraryPosts).set({ shared: share, userId: share ? null : userId, workspaceId, source: share ? "coach" : "mine" }).where(eq(schema.libraryPosts.id, id));
  refresh();
}

/** A member keeps one of their own posts as a template, with the numbers it earned. */
export async function saveContentToLibraryAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const itemId = str(formData, "contentItemId");
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, itemId), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  const existing = await db.query.libraryPosts.findFirst({ where: and(eq(schema.libraryPosts.userId, userId), eq(schema.libraryPosts.sourceContentId, itemId)) });
  if (existing) {
    await db.update(schema.libraryPosts).set({ title: item.title, hook: item.hook, body: item.body ?? "", hasCta: item.hasCta, contentType: item.contentType, engagements: item.engagements, leads: item.leads }).where(eq(schema.libraryPosts.id, existing.id));
    refresh();
    redirect(`/library/${existing.id}`);
  }
  const id = newId();
  await db.insert(schema.libraryPosts).values({ id, workspaceId, userId, kind: "post", shared: false, title: item.title, contentType: item.contentType, hook: item.hook, body: item.body ?? "", hasCta: item.hasCta, source: "mine", sourceContentId: itemId, engagements: item.engagements, leads: item.leads, tags: [item.platform] });
  refresh();
  redirect(`/library/${id}`);
}

/** Counts a use and opens the composer prefilled. */
export async function useLibraryPostAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const row = await db.query.libraryPosts.findFirst({ where: eq(schema.libraryPosts.id, id) });
  if (!row) return;
  const visible = row.userId === userId || (row.shared && (row.workspaceId === null || row.workspaceId === workspaceId));
  if (!visible) return;
  await db.update(schema.libraryPosts).set({ usedCount: sql`${schema.libraryPosts.usedCount} + 1` }).where(eq(schema.libraryPosts.id, id));
  void num;
  redirect(`/content/compose?from=${id}`);
}
