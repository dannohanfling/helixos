"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { GROUP_KINDS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { VOICE, draft } from "@/lib/ai";
import { alignPost } from "@/lib/engine/groups";
import { ctx, num, opt, refresh, str } from "./common";

function fields(fd: FormData) {
  return {
    name: str(fd, "name"),
    url: opt(fd, "url"),
    kind: GROUP_KINDS.find((k) => k === str(fd, "kind")) ?? "member",
    rank: num(fd, "rank"),
    mission: opt(fd, "mission"),
    description: opt(fd, "description"),
    audience: opt(fd, "audience"),
    adminName: opt(fd, "adminName"),
    adminValues: opt(fd, "adminValues"),
    rules: opt(fd, "rules"),
    postingNorms: opt(fd, "postingNorms"),
    whatWorks: opt(fd, "whatWorks"),
    memberCount: num(fd, "memberCount") || null,
    postsPerDay: num(fd, "postsPerDay") || null,
    rating: Math.min(5, num(fd, "rating")) || null,
    notes: opt(fd, "notes"),
  };
}

async function own(id: string, userId: string) {
  const g = await db.query.groups.findFirst({ where: and(eq(schema.groups.id, id), eq(schema.groups.userId, userId)) });
  if (!g) throw new Error("Group not found");
  return g;
}

/** Keeps the top-3 prospect list honest: ranks 1 to 3 are unique, anything else drops to 0. */
async function settleRanks(userId: string, keepId: string, rank: number) {
  if (rank < 1 || rank > 3) return;
  const clash = await db.query.groups.findMany({ where: and(eq(schema.groups.userId, userId), eq(schema.groups.kind, "prospect"), eq(schema.groups.rank, rank)) });
  for (const g of clash) if (g.id !== keepId) await db.update(schema.groups).set({ rank: 0 }).where(eq(schema.groups.id, g.id));
}

export async function createGroupAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const f = fields(formData);
  if (!f.name) return;
  const id = newId();
  if (f.kind !== "prospect") f.rank = 0;
  await db.insert(schema.groups).values({ id, workspaceId, userId, ...f });
  await settleRanks(userId, id, f.rank);
  refresh();
  redirect(`/groups/${id}`);
}

export async function updateGroupAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  const f = fields(formData);
  if (!f.name) return;
  if (f.kind !== "prospect") f.rank = 0;
  await db.update(schema.groups).set(f).where(eq(schema.groups.id, id));
  await settleRanks(userId, id, f.rank);
  refresh();
}

/** Quick promote/demote from the list: set kind and (for prospects) a rank slot. */
export async function setGroupSlotAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  const slot = str(formData, "slot");
  const [slotKind, slotRank] = slot.includes(":") ? slot.split(":") : [str(formData, "kind"), String(num(formData, "rank"))];
  const kind = GROUP_KINDS.find((k) => k === slotKind) ?? "member";
  const rank = kind === "prospect" ? Number(slotRank) || 0 : 0;
  await db.update(schema.groups).set({ kind, rank }).where(eq(schema.groups.id, id));
  await settleRanks(userId, id, rank);
  refresh();
}

export async function deleteGroupAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.groups).where(and(eq(schema.groups.id, str(formData, "id")), eq(schema.groups.userId, userId)));
  refresh();
  redirect("/groups");
}

export async function markPostedInGroupAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  await db.update(schema.groups).set({ lastPostedAt: nowIso() }).where(eq(schema.groups.id, id));
  refresh();
}

/** Group-aligned drafts for one content item: one variant per selected group, shaped to that group's mission, rules and admin. */
export async function generateGroupVariantsAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const itemId = str(formData, "contentItemId");
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, itemId), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  const ids = formData.getAll("groupIds").map(String).filter(Boolean);
  const useAi = str(formData, "ai") === "1";
  const all = await db.query.groups.findMany({ where: eq(schema.groups.userId, userId) });
  const chosen = all.filter((g) => ids.includes(g.id));
  const src = { title: item.title, hook: item.hook, body: item.body, hasCta: item.hasCta, firstName: v.user.name.split(" ")[0] };
  for (const g of chosen) {
    const aligned = alignPost(src, g);
    let body = aligned.body;
    let by = "rules";
    if (useAi) {
      const ai = await draft(
        `You adapt one coaching post for a specific Facebook group so it fits that group's mission, the admin's values, and its rules. ${VOICE} ${aligned.ctaAllowed ? "A soft call to action is allowed." : "No pitch, no links, no call to action: pure value and a question."} Return only the post.`,
        `Group: ${g.name}\nMission: ${g.mission ?? ""}\nDescription: ${g.description ?? ""}\nAudience: ${g.audience ?? ""}\nAdmin: ${g.adminName ?? ""}. What the admin values: ${g.adminValues ?? ""}\nRules: ${g.rules ?? ""}\nPosting norms: ${g.postingNorms ?? ""}\nWhat works here: ${g.whatWorks ?? ""}\n\nSource post title: ${item.title}\nHook: ${item.hook ?? ""}\nBody:\n${item.body ?? ""}\n\nRule-based draft to improve:\n${aligned.body}`,
        2500,
      );
      if (ai) {
        body = ai;
        by = "claude";
      }
    }
    const channel = g.kind === "own" ? ("fb_group" as const) : ("other_groups" as const);
    const existing = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, itemId), eq(schema.contentVariants.channel, channel), eq(schema.contentVariants.groupId, g.id)) });
    if (existing?.status === "posted") continue;
    if (existing) await db.update(schema.contentVariants).set({ body, generatedBy: by }).where(eq(schema.contentVariants.id, existing.id));
    else await db.insert(schema.contentVariants).values({ id: newId(), contentItemId: itemId, userId, channel, groupId: g.id, body, generatedBy: by });
  }
  refresh();
}
