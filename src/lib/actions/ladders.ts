"use server";

import { deletedTo } from "@/lib/deleted";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { dripSetup } from "@/lib/rung-drip";
import { KEYWORD_KINDS, LADDER_AUDIENCES, LADDER_FORMAT_KEYS, LADDER_STATUSES, type KeywordKind, type LadderKeyword, type LadderStat } from "@/db/schema";
import { pushKeywordFields } from "@/lib/community-loyalty";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { draft } from "@/lib/ai";
import { channelBodies, checklist, masterBlock, outputContract, parseLadderOutput, parseRungs, perPostInput, publishBlockers, scaffold, type Brief, type Parsed } from "@/lib/engine/ladder";
import { stripFabricated, stripNote } from "@/lib/engine/blacklist";
import { mediaBlock } from "@/lib/engine/compose-media";
import { evidenceLines } from "@/lib/engine/evidence";
import { citableEvidence } from "@/lib/queries/evidence";
import { pushSocialPost } from "@/lib/integrations";
import { staleScheduledFor } from "@/lib/queries/ladders";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { draftAvatarBrief } from "@/lib/avatars";
import { generateBackground, graphicStep, makeGraphic, ownImage } from "@/lib/graphic";
import { headlineChoices } from "@/lib/engine/graphic";
import { randomBytes } from "node:crypto";
import { graphicPublicPath, shipRuns } from "@/lib/engine/ship";
import { shipFacts } from "@/lib/queries/ship";
import { handOffLadder } from "@/lib/rung-drip";
import { nowFor } from "@/lib/engine/channel-outcome";
import { connectionFor } from "@/lib/ghl";
import { recordReadback } from "@/lib/planner-status";

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
  if (!l) redirect(deletedTo("/content/ladders", "ladder"));
  return l;
}

function lines(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The keyword rows (L1, rev 562): kw_<i>_keyword, _use, _target (product | magnet:<id> | conversation), _line, _kind, _tag.
 * A magnet must be the member's own; a row with no keyword is dropped; a keyword repeated keeps its first row.
 */
async function parseKeywordRows(fd: FormData, userId: string): Promise<LadderKeyword[]> {
  const magnets = await db.query.leadMagnets.findMany({ where: eq(schema.leadMagnets.userId, userId), columns: { id: true } });
  const out: LadderKeyword[] = [];
  for (let i = 0; i < 40; i++) {
    const raw = fd.get(`kw_${i}_keyword`);
    if (raw === null) continue;
    const keyword = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!keyword || out.some((k) => k.keyword === keyword)) continue;
    const t = str(fd, `kw_${i}_target`);
    const line = opt(fd, `kw_${i}_line`)?.trim().slice(0, 300) || null;
    const target: LadderKeyword["target"] = t === "product" ? { kind: "product" } : t.startsWith("magnet:") && magnets.some((m) => m.id === t.slice(7)) ? { kind: "magnet", magnetId: t.slice(7) } : t === "conversation" ? { kind: "conversation", line } : null;
    const kind = (KEYWORD_KINDS as readonly string[]).includes(str(fd, `kw_${i}_kind`)) ? (str(fd, `kw_${i}_kind`) as KeywordKind) : "both";
    out.push({ keyword, use: opt(fd, `kw_${i}_use`)?.trim().slice(0, 200) || "default", target, kind, tag: opt(fd, `kw_${i}_tag`)?.trim().slice(0, 80) || null });
  }
  return out;
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
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const values = {
    productName: opt(formData, "productName"),
    productPitch: opt(formData, "productPitch"),
    priceLine: opt(formData, "priceLine"),
    trialLine: opt(formData, "trialLine"),
    keywords: await parseKeywordRows(formData, userId),
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
  // Who the post is for: the member's Primary avatar in their own words, when they've written one (rev 501 §6).
  const avatar = await draftAvatarBrief({ workspaceId, userId }, null);
  const text = await draft(system, [perPostInput(brief), avatar].filter(Boolean).join("\n\n"), 8000, { feature: "ladder" });
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
  const { workspaceId, userId } = await ctx({ team: "allow" });
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
  // Ship a ladder step 1 (rev 583 #1): the graphic in the same go, from the photo picked or the one the headline suggests.
  // A skeleton's headline is still brackets: nothing to draw yet; the member makes it from the ladder page once written.
  if (str(formData, "makeGraphic") === "1" && parsed.headline.trim() && !/\[/.test(parsed.headline)) {
    const m = { workspaceId, userId };
    const row = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, id) }))!;
    const step = await graphicStep(m, parsed.headline);
    const picked = str(formData, "photoImageId").trim();
    const photoId = picked ? (step.choices.find((c) => c.id === picked)?.id ?? null) : step.suggestedId;
    await makeGraphic(m, row, { photoImageId: photoId, headline: parsed.headline, strongFade: false, aiBackground: step.aiAllowed });
  }
  refresh();
  redirect(`/content/ladders/${id}`);
}

/** Runs the brief again (with any edits to it) and replaces every generated field. Live-posting progress is reset. */
export async function regenerateLadderAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
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
  const { userId } = await ctx({ team: "allow" });
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
  const { userId } = await ctx({ team: "allow" });
  const l = await own(str(formData, "id"), userId);
  const status = LADDER_STATUSES.find((s) => s === str(formData, "status"));
  if (!status) return;
  if (status !== "draft") await assertPublishable(l);
  await db.update(schema.ladders).set({ status, launchedAt: status === "live" ? (l.launchedAt ?? nowIso()) : status === "draft" ? null : l.launchedAt }).where(eq(schema.ladders.id, l.id));
  refresh();
}

/** Live posting: marks one rung posted (starting the clock on the first), or clears them all. */
export async function markRungAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
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
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const l = await own(str(formData, "id"), userId);
  await assertPublishable(l);
  const itemId = await ensureLadderItem(l, workspaceId, userId);
  refresh();
  redirect(`/content/${itemId}/compose`);
}

/** The ladder's content item and one draft per channel, made or refreshed; a scheduled or posted channel draft is never touched. */
async function ensureLadderItem(l: schema.Ladder, workspaceId: string, userId: string): Promise<string> {
  let itemId = l.contentItemId;
  const existing = itemId ? await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, itemId), eq(schema.contentItems.userId, userId)) }) : null;
  // The ladder composes the post and its channel bodies from what the coach built: rule, never gated.
  // The ladder's graphic is the post's picture on every image channel (rev 515): picked here, no re-upload; a remake follows.
  const item = { title: l.postName || l.topic, hook: l.hook || null, body: l.copy || null, hasCta: l.keyword !== "NONE", contentType: "Comment Ladder", notes: l.notes, origin: "rule" as const, ...(l.graphicImageId ? { mediaAttachmentId: `img:${l.graphicImageId}` } : {}) };
  if (existing) await db.update(schema.contentItems).set(item).where(eq(schema.contentItems.id, existing.id));
  else {
    itemId = newId();
    await db.insert(schema.contentItems).values({ id: itemId, workspaceId, userId, platform: "FB Personal", status: "ready", ...item });
    await db.update(schema.ladders).set({ contentItemId: itemId }).where(eq(schema.ladders.id, l.id));
  }
  for (const c of channelBodies(l)) {
    const v = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, itemId!), eq(schema.contentVariants.channel, c.channel), eq(schema.contentVariants.groupId, "")) });
    if (v?.status === "posted" || v?.status === "scheduled") continue;
    if (v) await db.update(schema.contentVariants).set({ body: c.body, generatedBy: "ladder", origin: "rule" }).where(eq(schema.contentVariants.id, v.id));
    else await db.insert(schema.contentVariants).values({ id: newId(), contentItemId: itemId!, userId, channel: c.channel, groupId: "", body: c.body, generatedBy: "ladder", origin: "rule" });
  }
  return itemId!;
}

/**
 * The client's choice, from the warning on the ladder page or in the composer: every scheduled channel post that still
 * carries older text takes the ladder's current text. Posts the Social Planner holds are edited there in place under the
 * same id (no second copy); the rest are scheduled here and pasted by hand, so only their text changes. Gated like every
 * other outward step, and the schedule itself (dates, targets) is never altered.
 */
export async function pushLadderUpdateAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "Nothing is sent or published as {first} from their HelixOS. They can do it themselves.", team: "allow" });
  const l = await own(str(formData, "id"), userId);
  const back = str(formData, "back").startsWith("/") ? str(formData, "back") : `/content/ladders/${l.id}`;
  await assertPublishable(l);
  const item = l.contentItemId ? await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, l.contentItemId), eq(schema.contentItems.userId, userId)) }) : null;
  const stale = item ? await staleScheduledFor(l) : [];
  // The item may carry a picked file that shows a result: the rewritten bodies must still say illustrative, or nothing is pushed.
  const picked = item?.mediaAttachmentId ? await db.query.proofAttachments.findFirst({ where: and(eq(schema.proofAttachments.id, item.mediaAttachmentId), eq(schema.proofAttachments.workspaceId, workspaceId)) }) : null;
  if (mediaBlock(picked ?? null, stale.map((s) => s.body))) redirect(`/content/ladders/${l.id}?blocked=illustrative`);
  let pushed = 0;
  // While the comment-ladder handoff is on, Threads is Community Loyalty's: its text is updated here, never re-pushed.
  const dripOn = dripSetup(v.membership).on;
  for (const s of stale) {
    await db.update(schema.contentVariants).set({ body: s.body, generatedBy: "ladder", origin: "rule" }).where(eq(schema.contentVariants.id, s.variantId));
    if (s.inGhl && !(dripOn && s.channel === "threads") && (await pushSocialPost({ workspaceId, userId, tz: v.tz }, { variantId: s.variantId, channel: s.channel, body: s.body, postAt: s.postAt, mediaUrl: item?.mediaUrl, title: item?.title }))) pushed++;
  }
  refresh();
  const sep = back.includes("?") ? "&" : "?";
  redirect(`${back}${sep}pushed=${stale.length}&ghl=${pushed}`);
}

export async function deleteLadderAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const l = await own(str(formData, "id"), userId);
  await db.delete(schema.ladders).where(eq(schema.ladders.id, l.id));
  refresh();
  redirect("/content/ladders");
}

/**
 * Make the graphic (rev 513): renders the ladder's headline on one of the member's own photos in the approved template and
 * stores the master as an Images entry of kind graphic, pointed at from the ladder. The photo must be the member's own, the
 * headline one of the ladder's (its own or an alternate). A remake replaces the ladder's graphic; the old one stays in Images.
 */
export async function makeGraphicAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const l = await own(str(formData, "id"), userId);
  const back = `/content/ladders/${l.id}`;
  const m = { workspaceId, userId };
  const photoId = str(formData, "photoImageId").trim();
  const photo = photoId ? await ownImage(m, photoId) : null;
  if (photoId && !photo) redirect(`${back}?graphic=${encodeURIComponent("That photo isn't in your Images. Pick another.")}#graphic`);
  const choices = headlineChoices(l.headline, l.altHeadlines);
  const headline = choices.find((h) => h === str(formData, "headline").trim()) ?? choices[0] ?? "";
  if (!headline.trim()) redirect(`${back}?graphic=${encodeURIComponent("Write the headline first.")}#graphic`);
  const r = await makeGraphic(m, l, { photoImageId: photo?.id ?? null, headline, strongFade: str(formData, "strongFade") === "1", aiBackground: str(formData, "aiBackground") === "1" });
  refresh();
  redirect(r.ok ? `${back}?graphic=made#graphic` : `${back}?graphic=${encodeURIComponent(r.error)}#graphic`);
}

/** An AI background for the graphic (rev 524): made with the member's own key when their kit allows it, kept as one of their photos and picked for the next make. */
export async function generateBackgroundAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const l = await own(str(formData, "id"), userId);
  const back = `/content/ladders/${l.id}`;
  const r = await generateBackground({ workspaceId, userId }, l);
  refresh();
  redirect(r.ok ? `${back}?graphic=background&photo=${r.imageId}#graphic` : `${back}?graphic=${encodeURIComponent(r.error)}#graphic`);
}

/**
 * Push the keyword router's two fields to the member's own Community Loyalty bot (Ship a ladder commit 2): the keywords with
 * their targets, kinds and tags, and the agent. The member's own bot only (a team member works on the owner's words but never
 * pushes to the bot, as with the Stage 1 push); refused with the reason on the page when the bot has no router field.
 */
export async function pushKeywordsAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "Nothing is sent or published as {first} from their HelixOS. They can do it themselves." });
  const out = await pushKeywordFields(v.membership.id, { reason: str(formData, "reason") || "profile page", by: v.user.id });
  refresh();
  if (out.status === "sent") redirect(`/content/ladders/profile?keywords=sent#bot-keywords`);
  redirect(`/content/ladders/profile?keywords=${out.status === "failed" ? "failed" : "note"}&note=${encodeURIComponent(out.note)}#bot-keywords`);
}

/**
 * Ship (rev 583 #1, commit 3): one press runs every step that is ready, in order: the Facebook Page and Instagram posts
 * through the member's GoHighLevel with the graphic attached at its public address (minted here), their read-back, the
 * rungs to Community Loyalty's drip naming the two posts, and the keyword to the bot. Each step says what it did or why not
 * on the card; a second press runs only what did not go. Gated like every outward step; never a profile or a group.
 */
export async function shipLadderAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "Nothing is sent or published as {first} from their HelixOS. They can do it themselves.", team: "allow" });
  let l = await own(str(formData, "id"), userId);
  const back = `/content/ladders/${l.id}`;
  await assertPublishable(l);
  const when = opt(formData, "when");
  const postAt = when && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(when) ? `${when.slice(0, 16)}:00` : null;
  const notes: string[] = [];
  // The public address, once: the token carries nothing of the member and dies on Revoke.
  if (l.graphicImageId && !l.graphicPublicToken) {
    await db.update(schema.ladders).set({ graphicPublicToken: randomBytes(16).toString("hex") }).where(and(eq(schema.ladders.id, l.id), eq(schema.ladders.userId, userId)));
    l = await own(l.id, userId);
  }
  const first = await shipFacts(v, l);
  const runs = shipRuns(first.steps);
  if (!runs.length) redirect(`${back}?ship=held#ship`);
  const itemId = await ensureLadderItem(l, workspaceId, userId);
  const item = (await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, itemId), eq(schema.contentItems.userId, userId)) }))!;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const mediaUrl = l.graphicPublicToken ? `${appUrl}${graphicPublicPath(l.graphicPublicToken)}` : null;
  const dripOn = dripSetup(v.membership).on;
  const conn = await connectionFor(userId);
  // The two posts: the channel draft is scheduled (or posted now) and pushed to the Social Planner with the graphic; then read back.
  for (const key of ["page", "instagram"] as const) {
    if (!runs.includes(key)) continue;
    const channel = key === "page" ? "fb_page" : "instagram";
    const variant = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, itemId), eq(schema.contentVariants.channel, channel), eq(schema.contentVariants.groupId, "")) });
    if (!variant) { notes.push(`${channel}: no draft`); continue; }
    await db.update(schema.contentVariants).set({ status: postAt ? "scheduled" : "posted", postAt, ...(postAt ? {} : { postedAt: nowIso() }) }).where(eq(schema.contentVariants.id, variant.id));
    const sent = await pushSocialPost({ workspaceId, userId, tz: v.tz }, { variantId: variant.id, channel, body: variant.subject ? `${variant.subject}\n\n${variant.body}` : variant.body, postAt, mediaUrl, title: item.title, followUpComment: dripOn ? null : item.firstComment });
    notes.push(`${channel}: ${sent ? "sent" : "refused"}`);
    if (sent && conn) {
      const after = await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, variant.id) });
      if (after?.externalId) await recordReadback(after, conn);
    }
  }
  await db.update(schema.contentItems).set({ status: postAt ? "scheduled" : "posted" }).where(eq(schema.contentItems.id, itemId));
  // The drip, once both posts read back as published: the hand-off names the two posts for the Dripper.
  const second = await shipFacts(v, l);
  if (shipRuns(second.steps).includes("drip")) {
    const fb = second.variants.find((x) => x.channel === "fb_page" && x.groupId === "");
    const ig = second.variants.find((x) => x.channel === "instagram" && x.groupId === "");
    const r = await handOffLadder({ workspaceId, user: v.user, membership: v.membership, tz: v.tz, today: v.today }, second.item!, second.variants, l, 0, nowFor(v), null, { target: "both", fbPostId: fb?.externalId ?? null, igMediaId: ig?.externalId ?? null, pinLast: false });
    notes.push(`drip: ${r.ok ? "handed" : `held (${r.reason})`}`);
  }
  // The keyword to the bot, through the same push the ladder facts page offers.
  let keywordBlocked: string | null = null;
  if (runs.includes("keywords")) {
    const out = await pushKeywordFields(v.membership.id, { reason: `ship ${l.id}`, by: v.user.id });
    if (out.status === "failed") keywordBlocked = out.note;
    notes.push(`keywords: ${out.status}`);
  }
  await db.update(schema.ladders).set({ shippedAt: nowIso() }).where(and(eq(schema.ladders.id, l.id), eq(schema.ladders.userId, userId)));
  refresh();
  redirect(`${back}?ship=ran&ran=${encodeURIComponent(notes.join("; "))}${keywordBlocked ? `&keywordBlocked=${encodeURIComponent(keywordBlocked)}` : ""}#ship`);
}

/** The public address dies: the token is cleared, the route answers nothing, the graphic itself stays in Images. */
export async function revokeGraphicLinkAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  const l = await own(str(formData, "id"), userId);
  await db.update(schema.ladders).set({ graphicPublicToken: null }).where(and(eq(schema.ladders.id, l.id), eq(schema.ladders.userId, userId)));
  refresh();
  redirect(`/content/ladders/${l.id}?ship=revoked#ship`);
}
