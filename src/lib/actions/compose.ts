"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { CHANNELS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { VOICE, draft } from "@/lib/ai";
import { CHANNEL_SPECS, type Channel } from "@/lib/engine/repurpose";
import { channelTargets, draftFor, groupTargets, staggerSchedule, type Target } from "@/lib/engine/compose";
import { contentPoints } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";
import { background, pushSocialPost } from "@/lib/integrations";
import { ctx } from "./common";

export type ComposePayload = {
  id?: string | null;
  title: string;
  hook: string;
  body: string;
  hasCta: boolean;
  mediaUrl: string;
  contentType: string;
  mode: "draft" | "schedule" | "now";
  targets: { key: string; channel: string; groupId: string; body: string; subject?: string; postAt?: string | null }[];
};

export type ComposeResult = { id: string; scheduled: number; posted: number; pushed: number };

const isChannel = (c: string): c is Channel => (CHANNELS as readonly string[]).includes(c);

/** Saves the post and one variant per target. Schedules or marks posted; pushes scheduled channel posts to the Social Planner. */
export async function saveComposeAction(payload: ComposePayload): Promise<ComposeResult> {
  const { v, workspaceId, userId } = await ctx();
  const title = payload.title.trim() || payload.hook.trim().slice(0, 80) || "Untitled post";
  const firstAt = payload.targets.map((t) => t.postAt).filter(Boolean).sort()[0] ?? null;
  const status = payload.mode === "now" ? "posted" : payload.mode === "schedule" ? "scheduled" : "ready";
  const item = {
    title,
    hook: payload.hook.trim() || null,
    body: payload.body.trim() || null,
    hasCta: payload.hasCta,
    mediaUrl: payload.mediaUrl.trim() || null,
    contentType: payload.contentType || "CTA Post",
    status: status as "posted" | "scheduled" | "ready",
    postAt: payload.mode === "schedule" ? firstAt : payload.mode === "now" ? nowIso().slice(0, 19) : null,
    postedAt: payload.mode === "now" ? nowIso() : null,
  };
  let id = payload.id ?? null;
  if (id) {
    const existing = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)) });
    if (!existing) id = null;
  }
  if (id) await db.update(schema.contentItems).set({ ...item, postedAt: item.postedAt ?? undefined }).where(eq(schema.contentItems.id, id));
  else {
    id = newId();
    await db.insert(schema.contentItems).values({ id, workspaceId, userId, platform: "FB Group", ...item });
  }

  let scheduled = 0;
  let posted = 0;
  let pushed = 0;
  const ownGroups = await db.query.groups.findMany({ where: eq(schema.groups.userId, userId) });
  for (const t of payload.targets) {
    if (!isChannel(t.channel)) continue;
    const groupId = t.groupId && ownGroups.some((g) => g.id === t.groupId) ? t.groupId : "";
    const vStatus = payload.mode === "now" ? "posted" : payload.mode === "schedule" ? "scheduled" : "draft";
    const row = { body: t.body, subject: t.subject ?? null, status: vStatus as "posted" | "scheduled" | "draft", postAt: payload.mode === "schedule" ? (t.postAt ?? firstAt) : null, postedAt: payload.mode === "now" ? nowIso() : null, generatedBy: "composer" };
    const existing = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, id), eq(schema.contentVariants.channel, t.channel), eq(schema.contentVariants.groupId, groupId)) });
    if (existing?.status === "posted" && payload.mode !== "now") continue;
    const variantId = existing?.id ?? newId();
    if (existing) await db.update(schema.contentVariants).set(row).where(eq(schema.contentVariants.id, existing.id));
    else await db.insert(schema.contentVariants).values({ id: variantId, contentItemId: id, userId, channel: t.channel, groupId, ...row });
    if (vStatus === "scheduled") scheduled++;
    if (vStatus === "posted") {
      posted++;
      if (groupId) await db.update(schema.groups).set({ lastPostedAt: nowIso() }).where(eq(schema.groups.id, groupId));
    }
    // Groups are posted by hand (Facebook has no group-posting API); channels go through the Social Planner when it's mapped.
    if (!groupId && vStatus !== "draft") {
      pushed++;
      background(pushSocialPost({ workspaceId, userId }, { variantId, channel: t.channel, body: t.subject ? `${t.subject}\n\n${t.body}` : t.body, postAt: row.postAt, mediaUrl: item.mediaUrl, title }));
    }
  }
  if (payload.mode === "now") await award({ workspaceId, userId }, "content", contentPoints(payload.hasCta), `Posted: ${title}`, `content:${id}`);
  void v;
  return { id, scheduled, posted, pushed };
}

/** Claude rewrites each target's draft in the coach's voice, respecting channel limits and group rules. Returns only the targets it improved. */
export async function polishTargetsAction(input: { title: string; hook: string; body: string; hasCta: boolean; targets: { key: string; channel: string; groupId: string; body: string }[] }): Promise<Record<string, { body: string; subject?: string }>> {
  const { v, userId } = await ctx();
  const groups = await db.query.groups.findMany({ where: eq(schema.groups.userId, userId) });
  const lines = input.targets.map((t) => {
    const spec = CHANNEL_SPECS.find((c) => c.key === t.channel);
    const g = t.groupId ? groups.find((x) => x.id === t.groupId) : null;
    const rules = g ? `Facebook group "${g.name}". Mission: ${g.mission ?? ""}. Admin values: ${g.adminValues ?? ""}. Rules: ${g.rules ?? ""}. Norms: ${g.postingNorms ?? ""}. ${g.kind === "own" ? "This is the author's own group: full CTA welcome." : "Guest post: value first, no links, no pitch."}` : `${spec?.label}. ${spec?.tone} Max ${spec?.maxChars} chars. Links: ${spec?.links}.`;
    return `- ${t.key}: ${rules}\n  Current draft:\n${t.body}`;
  });
  const text = await draft(
    `You adapt one coaching post for several channels so each version is native to where it's read and built to earn comments, shares and DMs. ${VOICE} Return ONLY a JSON object keyed by target key, each value {"body": string, "subject"?: string (email only)}. Keep every version inside its character limit.`,
    `Author: ${v.user.name}. Business: ${v.membership.businessName ?? ""}. Promise: ${v.membership.bigPromise ?? ""}\n\nSource title: ${input.title}\nHook: ${input.hook}\nBody:\n${input.body}\nHas CTA: ${input.hasCta}\n\nTargets:\n${lines.join("\n\n")}`,
    8000,
  );
  if (!text) return {};
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, { body: string; subject?: string }>;
  } catch {
    return {};
  }
}

/** One click from the Distribute page: every channel plus your group and top 3, scheduled 45 minutes apart from a start time. */
export async function distributeAllAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const itemId = String(formData.get("contentItemId") ?? "");
  const startDate = String(formData.get("startDate") ?? v.today);
  const startTime = String(formData.get("startTime") ?? "09:00");
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, itemId), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  const groups = await db.query.groups.findMany({ where: eq(schema.groups.userId, userId) });
  const picked = groups.filter((g) => g.kind === "own" || (g.kind === "prospect" && g.rank >= 1 && g.rank <= 3));
  const targets: Target[] = [...groupTargets(picked), ...channelTargets()];
  const when = staggerSchedule(targets, `${startDate}T${startTime}:00`);
  const src = { title: item.title, hook: item.hook, body: item.body, hasCta: item.hasCta, hashtag: v.membership.passHashtag, firstName: v.user.name.split(" ")[0] };
  await saveComposeAction({
    id: item.id,
    title: item.title,
    hook: item.hook ?? "",
    body: item.body ?? "",
    hasCta: item.hasCta,
    mediaUrl: item.mediaUrl ?? "",
    contentType: item.contentType,
    mode: "schedule",
    targets: targets.map((t) => {
      const d = draftFor(src, t);
      return { key: t.key, channel: t.channel, groupId: t.groupId, body: d.body, subject: d.subject, postAt: when.get(t.key) ? `${when.get(t.key)}:00` : null };
    }),
  });
}
