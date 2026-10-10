/**
 * The ladder writer and Ship, shared (Voice to Ship, rev 638): the Ladders page's actions and the HelixOS connector's tools call
 * these same functions, so there is one writer, one set of checks and one Ship. Nothing here redirects or reads a form: each
 * caller says no its own way (the page by sending the member back, the connector in a sentence).
 */
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { draft } from "@/lib/ai";
import { draftAvatarBrief } from "@/lib/avatars";
import { pushKeywordFields } from "@/lib/community-loyalty";
import { nowIso } from "@/lib/dates";
import { stripFabricated, stripNote } from "@/lib/engine/blacklist";
import { evidenceLines } from "@/lib/engine/evidence";
import { LADDER_FORMATS, channelBodies, checklist, formatFor, keywordOf, masterBlock, outputContract, parseLadderOutput, perPostInput, publishBlockers, scaffold, targetWords, type Brief, type LadderFormatKey, type Parsed } from "@/lib/engine/ladder";
import { LADDER_FORMAT_KEYS } from "@/db/schema";
import { rungsQueuedLine } from "@/lib/engine/rung-drip";
import { graphicPublicPath, shipRuns } from "@/lib/engine/ship";
import { libraryBlock } from "@/lib/engine/teaching";
import { connectionFor } from "@/lib/ghl";
import { newId } from "@/lib/ids";
import { pushSocialPost } from "@/lib/integrations";
import { recordReadback } from "@/lib/planner-status";
import { citableEvidence } from "@/lib/queries/evidence";
import { shipFacts } from "@/lib/queries/ship";
import { queueRungs, rungsSetup } from "@/lib/rung-drip";
import { materialFor, offeredOf, recordMaterial, type Offered } from "@/lib/teaching";

/**
 * The publish gate. Anything that pushes a ladder outward (to the composer, to ready/live/done, a rung marked posted)
 * runs the same checklist the page shows, against the ladder's own workspace, and is refused while any check FAILS.
 * Warns never block; saving, editing, regenerating, un-posting a rung and clearing are never gated. A refusal sends the
 * client back to the ladder with the failing checks named.
 */
export async function blockersFor(l: schema.Ladder) {
  const [profile, proofs] = await Promise.all([
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, l.workspaceId), eq(schema.ladderProfiles.userId, l.userId)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, l.workspaceId), eq(schema.proofs.userId, l.userId), eq(schema.proofs.status, "approved")) }),
  ]);
  return publishBlockers(checklist(l, profile ?? null, proofs));
}

/** A fabricated statistic the model wrote comes out of every field, and the notes say what went and why. The client's own words are never edited here. */
export function scrub(parsed: Parsed): Parsed {
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

export async function generate(workspaceId: string, userId: string, brief: Brief, viewer?: Viewer): Promise<{ parsed: Parsed; generatedBy: string; offered: Offered[] }> {
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
  // The teaching library and story bank (rev 618): the coach's own ladders only. A client's ladder never reads any of it.
  const material = membership?.role === "coach" ? await materialFor(userId, { topic: brief.topic, formatName: formatFor(brief.format).name, target: brief.keyword !== "NONE" ? targetWords(keywordOf(profile ?? null, brief.keyword), brief.leadMagnet?.title) : null, source: brief.sourceMaterial }).catch(() => null) : null;
  const offered = material ? offeredOf(material) : [];
  const library = material ? libraryBlock(material.teaching, material.stories) : "";
  const text = await draft(system, [perPostInput(brief), avatar, library].filter(Boolean).join("\n\n"), 8000, { feature: "ladder", viewer });
  if (text) {
    const parsed = scrub(parseLadderOutput(text));
    if (parsed.rungs.length >= 3 && parsed.copy) return { parsed, generatedBy: "claude", offered };
    // The model refused (stop rule) or answered outside the contract: keep what it said as the notes on a skeleton.
    const sk = scaffold(brief, profile ?? null, proofs);
    return { parsed: { ...sk, notes: `Claude did not return a full ladder. Its answer:\n${text.slice(0, 2000)}` }, generatedBy: "claude-partial", offered: [] };
  }
  return { parsed: scaffold(brief, profile ?? null, proofs), generatedBy: "scaffold", offered: [] };
}

/** The magnet a ladder offers, when it does: its keyword replaces whatever was picked, so a comment always routes to the magnet. */
export async function magnetFor(userId: string, id: string | null): Promise<{ id: string; title: string; promise: string; keyword: string } | null> {
  if (!id) return null;
  const m = await db.query.leadMagnets.findFirst({ where: and(eq(schema.leadMagnets.id, id), eq(schema.leadMagnets.userId, userId)) });
  return m ? { id: m.id, title: m.title, promise: m.promise, keyword: m.keyword } : null;
}

export async function ensureLadderItem(l: schema.Ladder, workspaceId: string, userId: string): Promise<string> {
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

export type Member = { workspaceId: string; userId: string };

/** A new ladder from a brief: written (or the skeleton without an AI key), saved as a draft, and what it drew on recorded. */
export async function createLadder(m: Member, brief: Brief & { leadMagnetId: string | null }, viewer?: Viewer): Promise<{ id: string; parsed: Parsed; generatedBy: string }> {
  const { leadMagnet, leadMagnetId, ...rest } = brief;
  const { parsed, generatedBy, offered } = await generate(m.workspaceId, m.userId, { ...rest, leadMagnet }, viewer);
  const id = newId();
  await db.insert(schema.ladders).values({
    id,
    workspaceId: m.workspaceId,
    userId: m.userId,
    ...rest,
    leadMagnetId,
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
  await recordMaterial(m.workspaceId, m.userId, id, offered, parsed.materialUsed);
  return { id, parsed, generatedBy };
}

export type ShipOutcome = { held: true } | { held: false; notes: string[]; keywordBlocked: string | null; ran: string[] };

/**
 * Ship, the one way it runs (rev 583 #1, rev 625): the public address minted once, the posts pushed to the Social Planner
 * with the graphic and read back, the rungs handed to the rungs-only webhook once both posts read back as published, and the
 * keyword written to the bot. The caller has already refused a ladder whose checks fail.
 */
/** `only`: the channels a preview named (the connector); left out, every channel Ship would run (the page). */
export async function shipLadder(v: Viewer, ladder: schema.Ladder, postAt: string | null, only?: readonly ("page" | "instagram")[]): Promise<ShipOutcome> {
  const workspaceId = v.workspace.id;
  const userId = v.user.id;
  let l = ladder;
  const notes: string[] = [];
  // The public address, once: the token carries nothing of the member and dies on Revoke.
  if (l.graphicImageId && !l.graphicPublicToken) {
    await db.update(schema.ladders).set({ graphicPublicToken: randomBytes(16).toString("hex") }).where(and(eq(schema.ladders.id, l.id), eq(schema.ladders.userId, userId)));
    l = (await db.query.ladders.findFirst({ where: and(eq(schema.ladders.id, l.id), eq(schema.ladders.userId, userId)) }))!;
  }
  const first = await shipFacts(v, l);
  const runs = shipRuns(first.steps).filter((k) => !only || (k !== "page" && k !== "instagram") || only.includes(k));
  if (!runs.length) return { held: true };
  const itemId = await ensureLadderItem(l, workspaceId, userId);
  // A ladder never sent to the composer gets its post here; read it again so the check after the posts sees them.
  if (l.contentItemId !== itemId) l = (await db.query.ladders.findFirst({ where: and(eq(schema.ladders.id, l.id), eq(schema.ladders.userId, userId)) }))!;
  const item = (await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, itemId), eq(schema.contentItems.userId, userId)) }))!;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const mediaUrl = l.graphicPublicToken ? `${appUrl}${graphicPublicPath(l.graphicPublicToken)}` : null;
  // With the rungs webhook set, the drip posts rung 1, so a shipped post carries no first comment (rev 625).
  const dripOn = rungsSetup(v.membership).on;
  const conn = await connectionFor(userId);
  // The two posts: the channel draft is scheduled (or posted now) and pushed to the Social Planner with the graphic; then read back.
  for (const key of ["page", "instagram"] as const) {
    if (!runs.includes(key)) continue;
    const channel = key === "page" ? "fb_page" : "instagram";
    const variant = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.contentItemId, itemId), eq(schema.contentVariants.channel, channel), eq(schema.contentVariants.groupId, "")) });
    if (!variant) { notes.push(`${channel}: no draft`); continue; }
    await db.update(schema.contentVariants).set({ status: postAt ? "scheduled" : "posted", postAt, ...(postAt ? {} : { postedAt: nowIso() }) }).where(eq(schema.contentVariants.id, variant.id));
    const sent = await pushSocialPost({ workspaceId, userId, tz: v.tz }, { variantId: variant.id, channel, body: variant.subject ? `${variant.subject}\n\n${variant.body}` : variant.body, postAt, mediaUrl, title: item.title, followUpComment: dripOn ? null : item.firstComment });
    notes.push(`${channel}: ${sent ? "sent" : "refused"}${mediaUrl ? " with the graphic" : ""}`);
    if (sent && conn) {
      const after = await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, variant.id) });
      if (after?.externalId) await recordReadback(after, conn, Boolean(mediaUrl));
    }
  }
  await db.update(schema.contentItems).set({ status: postAt ? "scheduled" : "posted" }).where(eq(schema.contentItems.id, itemId));
  // The drip, once both posts read back as published: the hand-off names the two posts for the Dripper.
  const second = await shipFacts(v, l);
  if (shipRuns(second.steps).includes("drip")) {
    const fb = second.variants.find((x) => x.channel === "fb_page" && x.groupId === "");
    const ig = second.variants.find((x) => x.channel === "instagram" && x.groupId === "");
    // The rungs-only webhook (rev 625): the rungs and the two posts' ids; a 200 is queued.
    const r = await queueRungs({ workspaceId, user: v.user, membership: v.membership }, second.item!, l, { fbPostId: fb?.externalId ?? null, igMediaId: ig?.externalId ?? null });
    notes.push(r.ok ? rungsQueuedLine(r.count) : `rungs held (${r.reason})`);
  }
  // The keyword to the bot, through the same push the ladder facts page offers.
  let keywordBlocked: string | null = null;
  if (runs.includes("keywords")) {
    const out = await pushKeywordFields(v.membership.id, { reason: `ship ${l.id}`, by: v.user.id });
    if (out.status === "failed") keywordBlocked = out.note;
    notes.push(`keywords: ${out.status}`);
  }
  await db.update(schema.ladders).set({ shippedAt: nowIso() }).where(and(eq(schema.ladders.id, l.id), eq(schema.ladders.userId, userId)));
  return { held: false, notes, keywordBlocked, ran: runs };
}

/** Picks a format for a topic when the member named none (the connector): one short call over the 13, else Method + Resource. */
export async function pickFormat(topic: string, notes: string | null, viewer: Viewer): Promise<LadderFormatKey> {
  const list = LADDER_FORMATS.map((f) => `${f.key}: ${f.name}. ${f.oneLiner}`).join("\n");
  const out = await draft(`Pick the one comment-ladder format that fits this topic best. Reply with the key only, nothing else.\n\nFORMATS:\n${list}`, [`TOPIC: ${topic}`, notes ? `NOTES: ${notes}` : ""].filter(Boolean).join("\n"), 20, { feature: "ladder", viewer, essence: false });
  const key = (out ?? "").trim().toLowerCase().match(/[a-z_]+/)?.[0] ?? "";
  return (LADDER_FORMAT_KEYS as readonly string[]).includes(key) ? (key as LadderFormatKey) : "method_resource";
}

export const LADDER_PARTS = ["headline", "body", "rung", "ig_caption"] as const;
export type LadderPart = (typeof LADDER_PARTS)[number];

/**
 * One part of a ladder changed (the connector's ladder_update): the member's own words as given, or the writer's rewrite of
 * that part only, in their voice and under the same claims rules, scrubbed of any fabricated figure. A ready ladder that now
 * fails a check goes back to draft, as a page edit does. Never a shipped ladder.
 */
export async function updateLadderPart(v: Viewer, l: schema.Ladder, part: LadderPart, change: { text?: string; instruction?: string; rung?: number }): Promise<{ ok: true; ladder: schema.Ladder; before: string; after: string } | { ok: false; error: string }> {
  if (l.shippedAt) return { ok: false, error: "That ladder has shipped, so it isn't changed from here. Edit it in HelixOS if you need to." };
  const n = change.rung ?? 0;
  const current = part === "headline" ? l.headline : part === "body" ? l.copy : part === "ig_caption" ? l.igCaption : (l.rungs.find((r) => r.n === n)?.body ?? null);
  if (current === null) return { ok: false, error: `There's no rung ${n}. This ladder has ${l.rungs.length}.` };
  let next = change.text?.trim() ?? "";
  if (!next && change.instruction?.trim()) {
    const [profile, proofs, user] = await Promise.all([
      db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, l.workspaceId), eq(schema.ladderProfiles.userId, l.userId)) }),
      db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, l.workspaceId), eq(schema.proofs.userId, l.userId), eq(schema.proofs.status, "approved")) }),
      db.query.users.findFirst({ where: eq(schema.users.id, l.userId) }),
    ]);
    const member = { name: user?.name ?? "the coach", businessName: v.membership.businessName, bigPromise: v.membership.bigPromise };
    const what = part === "rung" ? `rung ${n} of a comment ladder (40 to 90 words, ending with one short quotable line on its own line)` : part === "headline" ? 'the ladder\'s headline (8 to 14 words, ALL CAPS, two lines separated by " / ", one phrase marked "(gold: PHRASE)")' : part === "body" ? "the ladder's post body (hook, the read-them-in-order line, the save line, one open question; no keyword prompt)" : "the ladder's Instagram caption";
    const task = `${masterBlock(profile ?? null, proofs, member)}\n\nYou are changing ONE part of an existing ladder: ${what}. Apply the member's instruction to it and keep everything else about it. Return only the new text of that part, nothing before or after it.`;
    const out = await draft(task, `TOPIC: ${l.topic}\n\nTHE PART NOW:\n${current}\n\nTHE MEMBER'S INSTRUCTION: ${change.instruction.trim()}`, 1500, { feature: "ladder", viewer: v });
    if (!out) return { ok: false, error: "The writer didn't answer (no AI key, or today's AI limit is reached). Say the new words instead, or change it in HelixOS." };
    next = stripFabricated(out.trim()).text;
  }
  if (!next) return { ok: false, error: "Say the new words, or what to change." };
  const set = part === "headline" ? { headline: next } : part === "body" ? { copy: next } : part === "ig_caption" ? { igCaption: next } : { rungs: l.rungs.map((r) => (r.n === n ? { ...r, body: next } : r)) };
  await db.update(schema.ladders).set(set).where(and(eq(schema.ladders.id, l.id), eq(schema.ladders.userId, l.userId)));
  let fresh = (await db.query.ladders.findFirst({ where: eq(schema.ladders.id, l.id) }))!;
  if (fresh.status === "ready" && (await blockersFor(fresh)).length) {
    await db.update(schema.ladders).set({ status: "draft" }).where(eq(schema.ladders.id, l.id));
    fresh = { ...fresh, status: "draft" };
  }
  return { ok: true, ladder: fresh, before: current, after: next };
}

/** The checklist a ladder shows, for its own workspace. */
export async function checksFor(l: schema.Ladder) {
  const [profile, proofs] = await Promise.all([
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, l.workspaceId), eq(schema.ladderProfiles.userId, l.userId)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, l.workspaceId), eq(schema.proofs.userId, l.userId), eq(schema.proofs.status, "approved")) }),
  ]);
  return checklist(l, profile ?? null, proofs);
}
