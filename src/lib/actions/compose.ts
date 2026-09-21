"use server";

import { redirect } from "next/navigation";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { THREADS_EXCLUSIVE, firstCommentRefusal, threadsRefusal } from "@/lib/engine/rung-drip";
import { dripSetup } from "@/lib/rung-drip";
import { CHANNELS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso, nowWallInTz } from "@/lib/dates";
import { draft } from "@/lib/ai";
import { CHANNEL_SPECS, formatClause, toneClause, type Channel } from "@/lib/engine/repurpose";
import { readRules } from "@/lib/engine/groups";
import { explainFabricated, findFabricated, stripFabricated, stripNote } from "@/lib/engine/blacklist";
import { type Target, channelTargets, draftFor, groupTargets, normaliseTargets, staggerSchedule } from "@/lib/engine/compose";
import { ILLUSTRATIVE_LABEL, mediaBlock, mediaUrlProblem } from "@/lib/engine/compose-media";
import { contentPoints } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";
import { background, pushSocialPost } from "@/lib/integrations";
import { ctx, str } from "@/lib/action-helpers";
import { carriesUnreviewed, gateLine, originAfterSave, variantName, type Gate } from "@/lib/engine/provenance";
import { recordConfirm } from "@/lib/provenance";

export type ComposePayload = {
  id?: string | null;
  title: string;
  hook: string;
  body: string;
  /** The call to action, its own field: composed onto each version at render, never appended to the body. */
  cta: string;
  /** The first comment under the post, for the Facebook page and Instagram pushes; blank sends none. */
  firstComment?: string;
  hasCta: boolean;
  mediaUrl: string;
  /** A proof attachment picked as the post's media. Verified here (the client's own, approved, a photo or video); never a public URL, never sent on. */
  mediaAttachmentId?: string | null;
  contentType: string;
  mode: "draft" | "schedule" | "now";
  /** Continue anyway: the coach saw the gate's line naming the AI drafts nobody reviewed and chose to send. Logged with who and when. */
  confirm?: boolean;
  targets: { key: string; channel: string; groupId: string; body: string; subject?: string; postAt?: string | null }[];
};

/**
 * `blocked`: nothing was saved; the text says which fabricated statistic and what to say instead, or which rule the picked file
 * carries. `gate`: nothing was saved either; the post or a version going out is an AI draft nobody has reviewed, named, and
 * the composer offers Review or Continue anyway (the same call again with `confirm`).
 */
export type ComposeResult = { id: string; scheduled: number; posted: number; pushed: number; blocked?: string; gate?: Gate };

const isChannel = (c: string): c is Channel => (CHANNELS as readonly string[]).includes(c);

/** The picked attachment, when it is a photo or video on one of this client's own approved proofs in this workspace. Anything else is nothing. */
async function pickedAttachment(id: string | null | undefined, workspaceId: string, userId: string) {
  if (!id) return null;
  const att = await db.query.proofAttachments.findFirst({ where: and(eq(schema.proofAttachments.id, id), eq(schema.proofAttachments.workspaceId, workspaceId)) });
  if (!att || att.kind === "document") return null;
  const proof = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, att.proofId), eq(schema.proofs.userId, userId), eq(schema.proofs.status, "approved")) });
  return proof ? att : null;
}

/** Saves the post and one variant per target. Schedules or marks posted; pushes scheduled channel posts to the Social Planner. */
export async function saveComposeAction(payload: ComposePayload): Promise<ComposeResult> {
  const { v, workspaceId, userId } = await ctx();
  // Block on truth, server-side as well: a fabricated statistic in any version saves nothing and says why.
  const everything = [payload.body, ...payload.targets.map((t) => t.body)].join("\n");
  const fabricated = findFabricated(everything);
  if (fabricated.length) {
    const quotes = (await db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, userId), eq(schema.proofs.status, "approved")) })).flatMap((p) => [p.quote, p.longVersion, p.shortVersion].filter((x): x is string => Boolean(x)));
    return { id: payload.id ?? "", scheduled: 0, posted: 0, pushed: 0, blocked: explainFabricated(fabricated, { text: everything, quotes }) };
  }
  // The picked file, if it is the client's to pick. A file that shows a result carries the dollar-figure rule: the gate is the
  // server's, not only the button's, so scheduling or posting without the marker saves nothing and says why. A draft may hold it.
  const attachment = await pickedAttachment(payload.mediaAttachmentId, workspaceId, userId);
  const mediaBlocked = payload.mode !== "draft" ? mediaBlock(attachment, [payload.body, ...payload.targets.map((t) => t.body)]) : null;
  if (mediaBlocked) return { id: payload.id ?? "", scheduled: 0, posted: 0, pushed: 0, blocked: mediaBlocked };
  // A typed address goes to the Social Planner as-is: it must be a public web address, never one of our private routes.
  const urlProblem = mediaUrlProblem(payload.mediaUrl, payload.mode !== "draft");
  if (urlProblem) return { id: payload.id ?? "", scheduled: 0, posted: 0, pushed: 0, blocked: urlProblem };
  // While the comment-ladder handoff is on, Threads is Community Loyalty's: the server refuses it as the chip does. The
  // refusal looks at the targets as they will be saved: a group id that is not the member's own is a plain channel post.
  const ownGroups = await db.query.groups.findMany({ where: eq(schema.groups.userId, userId) });
  const targets = normaliseTargets(payload.targets, ownGroups.map((g) => g.id));
  const dripOn = dripSetup(v.membership).on;
  const threads = payload.mode !== "draft" ? threadsRefusal(targets, dripOn) : null;
  if (threads) return { id: payload.id ?? "", scheduled: 0, posted: 0, pushed: 0, blocked: threads };
  // A ladder post's first comment is rung 1 and the drip supplies rung 1: the composer locks the field, and the server refuses
  // the same choice, in every mode, so a draft cannot carry one into a later schedule.
  const ladderPost = payload.id ? Boolean(await db.query.ladders.findFirst({ where: and(eq(schema.ladders.contentItemId, payload.id), eq(schema.ladders.userId, userId)), columns: { id: true } })) : false;
  const firstCommentProblem = firstCommentRefusal({ ladderPost, dripOn, firstComment: payload.firstComment });
  if (firstCommentProblem) return { id: payload.id ?? "", scheduled: 0, posted: 0, pushed: 0, blocked: firstCommentProblem };
  let id = payload.id ?? null;
  const existing = id ? await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, userId)) }) : null;
  if (!existing) id = null;
  const title = payload.title.trim() || payload.hook.trim().slice(0, 80) || "Untitled post";
  // The provenance gate, on the action that sends the post out: the post itself and every version going as it was stored, if a
  // model wrote it and nobody has read it, are named; nothing is saved until the coach reviews or continues anyway, and
  // continuing is logged with who and when. A draft save is not sending, and a version rewritten on the way was reviewed by the rewrite.
  if (payload.mode !== "draft") {
    const names: string[] = [];
    if (existing && carriesUnreviewed(existing.origin, existing.body, payload.body)) names.push(existing.title);
    for (const t of targets) {
      if (!isChannel(t.channel)) continue;
      const was = id ? await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, id), eq(schema.contentVariants.channel, t.channel), eq(schema.contentVariants.groupId, t.groupId)) }) : null;
      if (was && carriesUnreviewed(was.origin, was.body, t.body)) names.push(variantName(t, ownGroups.find((g) => g.id === t.groupId)?.name));
    }
    if (names.length && !payload.confirm) return { id: id ?? "", scheduled: 0, posted: 0, pushed: 0, gate: { line: gateLine(names.length), items: names } };
    if (names.length) await recordConfirm({ workspaceId, userId, userName: v.user.name }, payload.mode === "now" ? "post_now" : "post_schedule", id ?? "", names);
  }
  const firstAt = payload.targets.map((t) => t.postAt).filter(Boolean).sort()[0] ?? null;
  const status = payload.mode === "now" ? "posted" : payload.mode === "schedule" ? "scheduled" : "ready";
  const item = {
    title,
    hook: payload.hook.trim() || null,
    body: payload.body.trim() || null,
    cta: payload.cta.trim() || null,
    firstComment: (payload.firstComment ?? "").trim() || null,
    hasCta: payload.hasCta,
    // The typed URL is the only media the Social Planner is ever handed; the attachment is a private file and stays an id here.
    mediaUrl: payload.mediaUrl.trim() || null,
    mediaAttachmentId: attachment?.id ?? null,
    contentType: payload.contentType || "CTA Post",
    status: status as "posted" | "scheduled" | "ready",
    postAt: payload.mode === "schedule" ? firstAt : payload.mode === "now" ? nowWallInTz(v.tz) : null,
    postedAt: payload.mode === "now" ? nowIso() : null,
  };
  // A changed body is the coach's review of an AI draft; a post first written here is the coach's own.
  if (id && existing) await db.update(schema.contentItems).set({ ...item, origin: originAfterSave(existing.origin, existing.body, item.body), postedAt: item.postedAt ?? undefined }).where(eq(schema.contentItems.id, id));
  else {
    id = newId();
    await db.insert(schema.contentItems).values({ id, workspaceId, userId, platform: "FB Group", ...item, origin: "coach" });
  }

  let scheduled = 0;
  let posted = 0;
  let pushed = 0;
  for (const t of targets) {
    if (!isChannel(t.channel)) continue;
    const groupId = t.groupId;
    const vStatus = payload.mode === "now" ? "posted" : payload.mode === "schedule" ? "scheduled" : "draft";
    const row = { body: t.body, subject: t.subject ?? null, status: vStatus as "posted" | "scheduled" | "draft", postAt: payload.mode === "schedule" ? (t.postAt ?? firstAt) : null, postedAt: payload.mode === "now" ? nowIso() : null, generatedBy: "composer" };
    const existing = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, id), eq(schema.contentVariants.channel, t.channel), eq(schema.contentVariants.groupId, groupId)) });
    if (existing?.status === "posted" && payload.mode !== "now") continue;
    const variantId = existing?.id ?? newId();
    // A version's text from the composer is the coach's choice at the moment of sending; a stored AI draft it rewrites becomes edited,
    // an unchanged one keeps its mark, and a version first written here carries none (a rule or the coach composed it, in view).
    if (existing) await db.update(schema.contentVariants).set({ ...row, origin: originAfterSave(existing.origin, existing.body, t.body) }).where(eq(schema.contentVariants.id, existing.id));
    else await db.insert(schema.contentVariants).values({ id: variantId, contentItemId: id, userId, channel: t.channel, groupId, ...row });
    if (vStatus === "scheduled") scheduled++;
    if (vStatus === "posted") {
      posted++;
      if (groupId) await db.update(schema.groups).set({ lastPostedAt: nowIso() }).where(eq(schema.groups.id, groupId));
    }
    // Groups are posted by hand (Facebook has no group-posting API); channels go through the Social Planner when it's mapped.
    if (!groupId && vStatus !== "draft") {
      pushed++;
      // The first comment rides on the Facebook page and Instagram posts only: the two the comment ladder lives on.
      background(pushSocialPost({ workspaceId, userId, tz: v.tz }, { variantId, channel: t.channel, body: t.subject ? `${t.subject}\n\n${t.body}` : t.body, postAt: row.postAt, mediaUrl: item.mediaUrl, title, followUpComment: t.channel === "fb_page" || t.channel === "instagram" ? item.firstComment : null }));
    }
  }
  if (payload.mode === "now") await award({ workspaceId, userId }, "content", contentPoints(payload.hasCta), `Posted: ${title}`, `content:${id}`);
  void v;
  return { id, scheduled, posted, pushed };
}

/** Claude rewrites each target's draft in the coach's voice, respecting channel limits and group rules. Returns only the targets it improved. */
export async function polishTargetsAction(input: { title: string; hook: string; body: string; cta?: string; hasCta: boolean; targets: { key: string; channel: string; groupId: string; body: string }[] }): Promise<{ drafts: Record<string, { body: string; subject?: string }>; removed: string | null }> {
  const { v, userId } = await ctx();
  const groups = await db.query.groups.findMany({ where: eq(schema.groups.userId, userId) });
  const lines = input.targets.map((t) => {
    const spec = CHANNEL_SPECS.find((c) => c.key === t.channel);
    const g = t.groupId ? groups.find((x) => x.id === t.groupId) : null;
    const rules = g ? `Facebook group "${g.name}". Mission: ${g.mission ?? ""}. Admin values: ${g.adminValues ?? ""}. Rules: ${g.rules ?? ""}. Norms: ${g.postingNorms ?? ""}. ${g.kind === "own" ? "This is the author's own group: full CTA welcome." : "Guest post: value first, no links, no pitch."}${formatClause(spec)} Max ${spec?.maxChars} chars. Links: ${readRules(g).noLinks ? "none" : spec?.links}.` : `${spec?.label}.${toneClause(spec)}${formatClause(spec)} Max ${spec?.maxChars} chars. Links: ${spec?.links}.`;
    return `- ${t.key}: ${rules}\n  Current draft:\n${t.body}`;
  });
  const text = await draft(
    `You adapt one coaching post for several channels so each version is native to where it's read and built to earn comments, shares and DMs. Return ONLY a JSON object keyed by target key, each value {"body": string, "subject"?: string (email only)}. Keep every version inside its character limit.`,
    `Author: ${v.user.name}. Business: ${v.membership.businessName ?? ""}. Promise: ${v.membership.bigPromise ?? ""}\n\nSource title: ${input.title}\nHook: ${input.hook}\nBody:\n${input.body}\nHas CTA: ${input.hasCta}${input.cta?.trim() ? `\nCTA (the closing line, once, where a CTA belongs): ${input.cta.trim()}` : ""}\n\nTargets:\n${lines.join("\n\n")}`,
    8000,
    { feature: "composer_polish" },
  );
  if (!text) return { drafts: {}, removed: null };
  try {
    const drafts = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Record<string, { body: string; subject?: string }>;
    // A fabricated statistic the model wrote comes out of every version, and the composer says what went and why.
    const removed: ReturnType<typeof stripFabricated>["removed"] = [];
    for (const [k, d] of Object.entries(drafts)) {
      const r = stripFabricated(d.body ?? "");
      removed.push(...r.removed);
      drafts[k] = { ...d, body: r.text };
    }
    return { drafts, removed: stripNote(removed) };
  } catch {
    return { drafts: {}, removed: null };
  }
}

/** One click from the Distribute page: every channel plus your group and top 3, scheduled 45 minutes apart from a start time. */
export async function distributeAllAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const itemId = String(formData.get("contentItemId") ?? "");
  // A cleared date or time input submits "", which ?? would keep: an empty start would schedule nothing.
  const startDate = String(formData.get("startDate") || v.today);
  const startTime = String(formData.get("startTime") || "09:00");
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, itemId), eq(schema.contentItems.userId, userId)) });
  if (!item) return;
  const groups = await db.query.groups.findMany({ where: eq(schema.groups.userId, userId) });
  const picked = groups.filter((g) => g.kind === "own" || (g.kind === "prospect" && g.rank >= 1 && g.rank <= 3));
  // While the handoff is on, Threads is Community Loyalty's and is not part of "everywhere".
  const dripOn = dripSetup(v.membership).on;
  const targets: Target[] = [...groupTargets(picked), ...channelTargets().filter((t) => !(dripOn && t.channel === "threads"))];
  // A ladder post's first comment is the drip's rung 1: one click everywhere carries none, whatever the item held before the lock.
  const ladderPost = Boolean(await db.query.ladders.findFirst({ where: and(eq(schema.ladders.contentItemId, item.id), eq(schema.ladders.userId, userId)), columns: { id: true } }));
  const when = staggerSchedule(targets, `${startDate}T${startTime}:00`);
  const src = { title: item.title, hook: item.hook, body: item.body, hasCta: item.hasCta, ctaText: item.cta, hashtag: v.membership.passHashtag, firstName: v.user.name.split(" ")[0] };
  const result = await saveComposeAction({
    id: item.id,
    title: item.title,
    hook: item.hook ?? "",
    body: item.body ?? "",
    cta: item.cta ?? "",
    firstComment: ladderPost && dripOn ? "" : item.firstComment ?? "",
    hasCta: item.hasCta,
    mediaUrl: item.mediaUrl ?? "",
    mediaAttachmentId: item.mediaAttachmentId,
    contentType: item.contentType,
    mode: "schedule",
    confirm: str(formData, "confirm") === "1",
    targets: targets.map((t) => {
      const d = draftFor(src, t);
      return { key: t.key, channel: t.channel, groupId: t.groupId, body: d.body, subject: d.subject, postAt: when.get(t.key) ? `${when.get(t.key)}:00` : null };
    }),
  });
  // The gate is never silent either: the page that offered the button names the drafts and offers Review or Continue anyway.
  if (result.gate) redirect(`/content/${item.id}/repurpose?gate=distribute&items=${encodeURIComponent(result.gate.items.join("\n"))}&startDate=${encodeURIComponent(startDate)}&startTime=${encodeURIComponent(startTime)}`);
  // A block is never silent: the page that offered the button names it.
  if (result.blocked) redirect(`/content/${item.id}/repurpose?blocked=${result.blocked.startsWith(ILLUSTRATIVE_LABEL) ? "media" : mediaUrlProblem(item.mediaUrl ?? "") ? "url" : result.blocked === THREADS_EXCLUSIVE ? "threads" : "fabricated"}`);
  // Back to the page with a clean address: a gate or a block that was answered is not shown again on the next load.
  redirect(`/content/${item.id}/repurpose`);
}
