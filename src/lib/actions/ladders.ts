"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { LADDER_AUDIENCES, LADDER_FORMAT_KEYS, LADDER_STATUSES, type LadderKeyword, type LadderStat } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { draft } from "@/lib/ai";
import { channelBodies, checklist, masterBlock, outputContract, parseLadderOutput, parseRungs, perPostInput, publishBlockers, scaffold, type Brief, type Parsed } from "@/lib/engine/ladder";
import { stripFabricated, stripNote } from "@/lib/engine/blacklist";
import { evidenceLines } from "@/lib/engine/evidence";
import { citableEvidence } from "@/lib/queries/evidence";
import { pushSocialPost } from "@/lib/integrations";
import { staleScheduledFor } from "@/lib/queries/ladders";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";

/**
 * The publish gate. Anything that pushes a ladder outward (to the composer, to ready/live/done, a rung marked posted)
 * runs the same checklist the page shows, against the ladder's own workspace, and is refused while any check FAILS.
 * Warns never block; saving, editing, regenerating, un-posting a rung and clearing are never gated. A refusal sends the
 * client back to the ladder with the failing checks named.
 */
async function blockersFor(l: schema.Ladder) {
  const [profile, proofs] = await Promise.all([
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, l.workspaceId), eq(schema.ladderProfiles.userId, l.userId)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, l.workspaceId), eq(schema.proofs.userId, l.userId), eq(schema.proofs.status, "approved")) }),
  ]);
  return publishBlockers(checklist(l, profile ?? null, proofs));
}
async function assertPublishable(l: schema.Ladder): Promise<void> {
  const blockers = await blockersFor(l);
  if (blockers.length) redirect(`/content/ladders/${l.id}?blocked=${encodeURIComponent(blockers.map((b) => b.key).join(","))}`);
}

async function own(id: string, userId: string) {
  const l = await db.query.ladders.findFirst({ where: and(eq(schema.ladders.id, id), eq(schema.ladders.userId, userId)) });
  if (!l) redirect("/content/ladders");
  return l;
}

function lines(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** "KEYWORD — what it's for", one per line. */
function parseKeywords(text: string): LadderKeyword[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [k, ...rest] = l.split(/\s+[—–-]+\s+|:\s+/);
      return { keyword: k.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""), use: rest.join(" ").trim() || "default" };
    })
    .filter((k) => k.keyword);
}
/** "the stat (source, year)", one per line. */
function parseStats(text: string): LadderStat[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      return m ? { stat: m[1].trim(), source: m[2].trim() } : { stat: l, source: "" };
    });
}

export async function saveLadderProfileAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const values = {
    productName: opt(formData, "productName"),
    productPitch: opt(formData, "productPitch"),
    priceLine: opt(formData, "priceLine"),
    trialLine: opt(formData, "trialLine"),
    keywords: parseKeywords(str(formData, "keywords")),
    scarcityLine: opt(formData, "scarcityLine"),
    bannedPhrases: lines(formData, "bannedPhrases"),
    verifiedStats: parseStats(str(formData, "verifiedStats")),
    claimsRules: opt(formData, "claimsRules"),
    originStory: opt(formData, "originStory"),
    positioningLine: opt(formData, "positioningLine"),
    handle: opt(formData, "handle"),
  };
  const existing = await db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, workspaceId), eq(schema.ladderProfiles.userId, userId)) });
  if (existing) await db.update(schema.ladderProfiles).set(values).where(eq(schema.ladderProfiles.id, existing.id));
  else await db.insert(schema.ladderProfiles).values({ id: newId(), workspaceId, userId, ...values });
  refresh();
  redirect("/content/ladders");
}

/** A fabricated statistic the model wrote comes out of every field, and the notes say what went and why. The client's own words are never edited here. */
function scrub(parsed: Parsed): Parsed {
  const removed: ReturnType<typeof stripFabricated>["removed"] = [];
  const take = (text: string) => {
    const r = stripFabricated(text);
    removed.push(...r.removed);
    return r.text;
  };
  const out: Parsed = { ...parsed, copy: take(parsed.copy), rungs: parsed.rungs.map((r) => ({ ...r, body: take(r.body) })), igCaption: take(parsed.igCaption), threadsChain: parsed.threadsChain.map(take) };
  const note = stripNote(removed);
  return note ? { ...out, notes: [out.notes, note].filter(Boolean).join("\n") } : out;
}

async function generate(workspaceId: string, userId: string, brief: Brief): Promise<{ parsed: Parsed; generatedBy: string }> {
  const [profile, proofs, membership, user, evidence] = await Promise.all([
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, workspaceId), eq(schema.ladderProfiles.userId, userId)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, workspaceId), eq(schema.proofs.userId, userId), eq(schema.proofs.status, "approved")) }),
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) }),
    db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
    citableEvidence(userId),
  ]);
  const member = { name: user?.name ?? "the coach", businessName: membership?.businessName, bigPromise: membership?.bigPromise };
  const system = `${masterBlock(profile ?? null, proofs, member, evidenceLines(evidence))}\n\n${outputContract()}`;
  const text = await draft(system, perPostInput(brief), 8000, { feature: "ladder" });
  if (text) {
    const parsed = scrub(parseLadderOutput(text));
    if (parsed.rungs.length >= 3 && parsed.copy) return { parsed, generatedBy: "claude" };
    // The model refused (stop rule) or answered outside the contract: keep what it said as the notes on a skeleton.
    const sk = scaffold(brief, profile ?? null, proofs);
    return { parsed: { ...sk, notes: `Claude did not return a full ladder. Its answer:\n${text.slice(0, 2000)}` }, generatedBy: "claude-partial" };
  }
  return { parsed: scaffold(brief, profile ?? null, proofs), generatedBy: "scaffold" };
}

/** The magnet a ladder offers, when it does: its keyword replaces whatever was picked, so a comment always routes to the magnet. */
async function magnetFor(userId: string, id: string | null): Promise<{ id: string; title: string; promise: string; keyword: string } | null> {
  if (!id) return null;
  const m = await db.query.leadMagnets.findFirst({ where: and(eq(schema.leadMagnets.id, id), eq(schema.leadMagnets.userId, userId)) });
  return m ? { id: m.id, title: m.title, promise: m.promise, keyword: m.keyword } : null;
}

async function briefFrom(fd: FormData, userId: string): Promise<Brief & { leadMagnetId: string | null }> {
  const magnet = await magnetFor(userId, opt(fd, "leadMagnetId"));
  return {
    format: LADDER_FORMAT_KEYS.find((f) => f === str(fd, "format")) ?? "method_resource",
    topic: str(fd, "topic"),
    audience: LADDER_AUDIENCES.find((a) => a === str(fd, "audience")) ?? "warm",
    keyword: magnet?.keyword ?? (str(fd, "keyword").toUpperCase().replace(/[^A-Z0-9]/g, "") || "NONE"),
    sourceMaterial: opt(fd, "sourceMaterial"),
    realNumbers: opt(fd, "realNumbers"),
    leadMagnet: magnet ? { title: magnet.title, promise: magnet.promise } : null,
    leadMagnetId: magnet?.id ?? null,
  };
}

export async function createLadderAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const { leadMagnet, ...brief } = await briefFrom(formData, userId);
  if (!brief.topic) return;
  const { parsed, generatedBy } = await generate(workspaceId, userId, { ...brief, leadMagnet });
  const id = newId();
  await db.insert(schema.ladders).values({
    id,
    workspaceId,
    userId,
    ...brief,
    postName: parsed.postName,
    headline: parsed.headline,
    altHeadlines: parsed.altHeadlines,
    hook: parsed.hook,
    copy: parsed.copy,
    rungs: parsed.rungs,
    dmKeyword: parsed.dmKeyword,
    carousel: parsed.carousel,
    igCaption: parsed.igCaption,
    threadsChain: parsed.threadsChain,
    notes: [parsed.screenshotText ? `SCREENSHOT TEXT:\n${parsed.screenshotText}` : "", parsed.notes].filter(Boolean).join("\n\n") || null,
    generatedBy,
  });
  refresh();
  redirect(`/content/ladders/${id}`);
}

/** Runs the brief again (with any edits to it) and replaces every generated field. Live-posting progress is reset. */
export async function regenerateLadderAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const l = await own(str(formData, "id"), userId);
  const magnet = await magnetFor(userId, l.leadMagnetId);
  const brief: Brief = { format: l.format, topic: str(formData, "topic") || l.topic, audience: l.audience, keyword: magnet?.keyword ?? l.keyword, sourceMaterial: opt(formData, "sourceMaterial") ?? l.sourceMaterial, realNumbers: opt(formData, "realNumbers") ?? l.realNumbers, leadMagnet: magnet ? { title: magnet.title, promise: magnet.promise } : null };
  const { parsed, generatedBy } = await generate(workspaceId, userId, brief);
  await db
    .update(schema.ladders)
    .set({ topic: brief.topic, keyword: brief.keyword, sourceMaterial: brief.sourceMaterial ?? null, realNumbers: brief.realNumbers ?? null, postName: parsed.postName, headline: parsed.headline, altHeadlines: parsed.altHeadlines, hook: parsed.hook, copy: parsed.copy, rungs: parsed.rungs, dmKeyword: parsed.dmKeyword, carousel: parsed.carousel, igCaption: parsed.igCaption, threadsChain: parsed.threadsChain, notes: parsed.notes || null, generatedBy, status: "draft", launchedAt: null })
    .where(eq(schema.ladders.id, l.id));
  refresh();
}

/** Saves the client's edits. Rungs arrive as one block ("1. …" separated by ---) and are re-split; posted marks survive by rung number. */
export async function updateLadderAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const l = await own(str(formData, "id"), userId);
  const posted = new Map(l.rungs.map((r) => [r.n, r.postedAt ?? null]));
  const rungs = parseRungs(str(formData, "rungs")).map((r) => ({ ...r, postedAt: posted.get(r.n) ?? null }));
  await db
    .update(schema.ladders)
    .set({
      postName: str(formData, "postName") || l.postName,
      headline: str(formData, "headline"),
      altHeadlines: lines(formData, "altHeadlines"),
      hook: str(formData, "hook"),
      copy: str(formData, "copy"),
      rungs,
      dmKeyword: str(formData, "dmKeyword"),
      keyword: str(formData, "dmKeyword").toUpperCase().replace(/[^A-Z0-9]/g, "") || "NONE",
      carousel: lines(formData, "carousel"),
      igCaption: str(formData, "igCaption"),
      threadsChain: str(formData, "threadsChain")
        .split(/^\s*-{3,}\s*$/m)
        .map((t) => t.trim())
        .filter(Boolean),
      notes: opt(formData, "notes"),
      realNumbers: opt(formData, "realNumbers"),
    })
    .where(eq(schema.ladders.id, l.id));
  if (l.status === "ready") {
    const fresh = await db.query.ladders.findFirst({ where: eq(schema.ladders.id, l.id) });
    if (fresh && (await blockersFor(fresh)).length) await db.update(schema.ladders).set({ status: "draft" }).where(eq(schema.ladders.id, l.id));
  }
  refresh();
}

export async function setLadderStatusAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const l = await own(str(formData, "id"), userId);
  const status = LADDER_STATUSES.find((s) => s === str(formData, "status"));
  if (!status) return;
  if (status !== "draft") await assertPublishable(l);
  await db.update(schema.ladders).set({ status, launchedAt: status === "live" ? (l.launchedAt ?? nowIso()) : status === "draft" ? null : l.launchedAt }).where(eq(schema.ladders.id, l.id));
  refresh();
}

/** Live posting: marks one rung posted (starting the clock on the first), or clears them all. */
export async function markRungAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const l = await own(str(formData, "id"), userId);
  const n = Number(str(formData, "n"));
  const reset = str(formData, "clearAll") === "1"; // never name a field "reset": it shadows form.reset(), which React calls after actions
  const target = l.rungs.find((r) => r.n === n);
  const posting = !reset && Boolean(target) && !target!.postedAt;
  if (posting) await assertPublishable(l); // un-posting is never gated
  const rungs = reset ? l.rungs.map((r) => ({ ...r, postedAt: null })) : l.rungs.map((r) => (r.n === n ? { ...r, postedAt: r.postedAt ? null : nowIso() } : r));
  const allDone = rungs.length > 0 && rungs.every((r) => r.postedAt);
  // Clearing a live run lands on "ready" only if the ladder would pass today; otherwise it is a draft again.
  const afterReset = l.status === "live" || l.status === "done" ? ((await blockersFor(l)).length ? "draft" : "ready") : l.status;
  await db
    .update(schema.ladders)
    .set({ rungs, launchedAt: reset ? null : (l.launchedAt ?? nowIso()), status: reset ? afterReset : allDone ? "done" : "live" })
    .where(eq(schema.ladders.id, l.id));
  refresh();
}

/**
 * Creates (or refreshes) the content item and channel drafts, then opens the composer so the client can schedule it everywhere.
 * A channel post that is already scheduled or posted is never touched here: the ladder page and the composer warn that it
 * still carries the older text, and only "Push the update to GoHighLevel" (the client's choice) replaces it.
 */
export async function sendLadderToComposerAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const l = await own(str(formData, "id"), userId);
  await assertPublishable(l);
  let itemId = l.contentItemId;
  const existing = itemId ? await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, itemId), eq(schema.contentItems.userId, userId)) }) : null;
  const item = { title: l.postName || l.topic, hook: l.hook || null, body: l.copy || null, hasCta: l.keyword !== "NONE", contentType: "Comment Ladder", notes: l.notes };
  if (existing) await db.update(schema.contentItems).set(item).where(eq(schema.contentItems.id, existing.id));
  else {
    itemId = newId();
    await db.insert(schema.contentItems).values({ id: itemId, workspaceId, userId, platform: "FB Personal", status: "ready", ...item });
    await db.update(schema.ladders).set({ contentItemId: itemId }).where(eq(schema.ladders.id, l.id));
  }
  for (const c of channelBodies(l)) {
    const v = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, itemId!), eq(schema.contentVariants.channel, c.channel), eq(schema.contentVariants.groupId, "")) });
    if (v?.status === "posted" || v?.status === "scheduled") continue;
    if (v) await db.update(schema.contentVariants).set({ body: c.body, generatedBy: "ladder" }).where(eq(schema.contentVariants.id, v.id));
    else await db.insert(schema.contentVariants).values({ id: newId(), contentItemId: itemId!, userId, channel: c.channel, groupId: "", body: c.body, generatedBy: "ladder" });
  }
  refresh();
  redirect(`/content/${itemId}/compose`);
}

/**
 * The client's choice, from the warning on the ladder page or in the composer: every scheduled channel post that still
 * carries older text takes the ladder's current text. Posts the Social Planner holds are edited there in place under the
 * same id (no second copy); the rest are scheduled here and pasted by hand, so only their text changes. Gated like every
 * other outward step, and the schedule itself (dates, targets) is never altered.
 */
export async function pushLadderUpdateAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const l = await own(str(formData, "id"), userId);
  const back = str(formData, "back").startsWith("/") ? str(formData, "back") : `/content/ladders/${l.id}`;
  await assertPublishable(l);
  const item = l.contentItemId ? await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, l.contentItemId), eq(schema.contentItems.userId, userId)) }) : null;
  const stale = item ? await staleScheduledFor(l) : [];
  let pushed = 0;
  for (const s of stale) {
    await db.update(schema.contentVariants).set({ body: s.body, generatedBy: "ladder" }).where(eq(schema.contentVariants.id, s.variantId));
    if (s.inGhl && (await pushSocialPost({ workspaceId, userId }, { variantId: s.variantId, channel: s.channel, body: s.body, postAt: s.postAt, mediaUrl: item?.mediaUrl, title: item?.title }))) pushed++;
  }
  refresh();
  const sep = back.includes("?") ? "&" : "?";
  redirect(`${back}${sep}pushed=${stale.length}&ghl=${pushed}`);
}

export async function deleteLadderAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const l = await own(str(formData, "id"), userId);
  await db.delete(schema.ladders).where(eq(schema.ladders.id, l.id));
  refresh();
  redirect("/content/ladders");
}
