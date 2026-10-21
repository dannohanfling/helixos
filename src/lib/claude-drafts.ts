/**
 * Claude's drafts everywhere (H-184, plan H-220 PR D2), the database side. A connector call writes a draft beside the member's
 * own content, never into it; Approve writes it through (the red lines checked again first), Edit opens the area's form filled
 * with it, Discard drops it; each is a history row, and Undo (seven days) puts back what an Approve replaced. Every row is
 * reached only through its own workspace and member: another's reads as not found. Offers first; the other areas join here.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DraftArea } from "@/db/schema";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { queueProgress } from "@/lib/chat-progress";
import { createOffer } from "@/lib/offers-core";
import { createContentItem } from "@/lib/content-core";
import { essenceSaveRefusal, normalizeEssence, sectionByKey, type EssenceData } from "@/lib/engine/essence";
import { keywordOf, slugify } from "@/lib/engine/lead-magnet";
import { AREA_WORDS, CONNECTOR_LABEL, offerFacts, pick, redLines, specsFor, undoOpen } from "@/lib/engine/claude-drafts";

export type Owner = { workspaceId: string; userId: string };
export type Actor = { name: string; connector: boolean; appId?: string | null; agentId?: string | null };
export type Result = { ok: true; targetId?: string | null } | { ok: false; why: string };

const keysOf = (area: DraftArea, targetId: string | null = null) => specsFor(area, targetId).map((f) => f.key);
const PILLAR = /^Pillar: (.+)$/m;

async function essenceRow(o: Owner) {
  return (await db.query.essences.findFirst({ where: and(eq(schema.essences.workspaceId, o.workspaceId), eq(schema.essences.userId, o.userId)) })) ?? null;
}
const byLabel = (by: Actor) => (by.connector ? CONNECTOR_LABEL : by.name);

/** The member's own row a draft changes, or null: another's reads exactly like one that isn't there. */
export async function areaRow(o: Owner, area: DraftArea, targetId: string | null): Promise<Record<string, unknown> | null> {
  if (!targetId) return null;
  if (area === "offer") return ((await db.query.offers.findFirst({ where: and(eq(schema.offers.id, targetId), eq(schema.offers.workspaceId, o.workspaceId), eq(schema.offers.userId, o.userId)) })) as Record<string, unknown> | undefined) ?? null;
  // An Essence draft's target is the section's key; the row is that section as it stands (empty until written).
  if (area === "essence") return sectionByKey(targetId) ? ((normalizeEssence((await essenceRow(o))?.data ?? {}) as EssenceData)[targetId] ?? {}) : null;
  if (area === "magnet") return ((await db.query.leadMagnets.findFirst({ where: and(eq(schema.leadMagnets.id, targetId), eq(schema.leadMagnets.workspaceId, o.workspaceId), eq(schema.leadMagnets.userId, o.userId)) })) as Record<string, unknown> | undefined) ?? null;
  // What the bot says about the business lives on the member's own membership in this workspace.
  if (area === "bot_profile") return ((await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, targetId), eq(schema.memberships.workspaceId, o.workspaceId), eq(schema.memberships.userId, o.userId)) })) as Record<string, unknown> | undefined) ?? null;
  if (area === "content") {
    const c = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, targetId), eq(schema.contentItems.workspaceId, o.workspaceId), eq(schema.contentItems.userId, o.userId)) });
    // A post's pillar lives as the first "Pillar: …" line of its notes, and its suggested date is the day it's set for.
    return c ? { ...c, pillar: c.notes?.match(PILLAR)?.[1] ?? null, suggestedDate: c.postAt?.slice(0, 10) ?? null } : null;
  }
  return null;
}

/** The member's own facts a draft's figures are checked against. */
export async function areaFacts(o: Owner, area: DraftArea): Promise<string> {
  // Every area's figures are checked against the member's offers and their own Essence: what they sell, and what they said.
  const [offers, essence] = await Promise.all([db.query.offers.findMany({ where: and(eq(schema.offers.workspaceId, o.workspaceId), eq(schema.offers.userId, o.userId)) }), essenceRow(o)]);
  const facts = offerFacts(offers as Record<string, unknown>[]);
  return area === "offer" ? facts : `${facts}\n${JSON.stringify(essence?.data ?? {})}`;
}

async function log(o: Owner, row: { area: DraftArea; targetId: string | null; draftId?: string | null; action: (typeof schema.CHANGE_ACTIONS)[number]; by: Actor; changed?: string[]; before?: Record<string, unknown> | null }) {
  await db.insert(schema.changeHistory).values({ id: newId(), workspaceId: o.workspaceId, userId: o.userId, area: row.area, targetId: row.targetId, draftId: row.draftId ?? null, action: row.action, byLabel: byLabel(row.by), byConnector: row.by.connector, changed: row.changed ?? [], before: row.before ?? null, createdAt: nowIso() });
}

/**
 * Claude's draft beside the member's own row (or of a new one, with no target). One draft waits per row: a newer one replaces
 * the older (kept in the history). Its base is what those fields say now, so a later change shows as a conflict.
 */
export async function saveDraft(o: Owner, area: DraftArea, targetId: string | null, fields: Record<string, unknown>, notes: string[], by: Actor, source = ""): Promise<string> {
  const id = newId();
  const now = nowIso();
  const row = await areaRow(o, area, targetId);
  if (targetId) await db.update(schema.drafts).set({ status: "replaced", decidedAt: now }).where(and(eq(schema.drafts.workspaceId, o.workspaceId), eq(schema.drafts.userId, o.userId), eq(schema.drafts.area, area), eq(schema.drafts.targetId, targetId), eq(schema.drafts.status, "pending")));
  await db.insert(schema.drafts).values({ id, workspaceId: o.workspaceId, userId: o.userId, area, targetId, fields, base: pick(row, Object.keys(fields)), source: source.slice(0, 8000), notes, byLabel: byLabel(by), appId: by.appId ?? null, agentId: by.agentId ?? null, status: "pending", createdAt: now });
  await log(o, { area, targetId, draftId: id, action: "drafted", by, changed: Object.keys(fields) });
  return id;
}

/** The member's waiting drafts, newest first: of one area, of one row (null target: the new ones), or all. */
export async function pendingDrafts(o: Owner, area?: DraftArea, targetId?: string | null): Promise<schema.Draft[]> {
  const where = [eq(schema.drafts.workspaceId, o.workspaceId), eq(schema.drafts.userId, o.userId), eq(schema.drafts.status, "pending")];
  if (area) where.push(eq(schema.drafts.area, area));
  if (targetId !== undefined) where.push(targetId === null ? isNull(schema.drafts.targetId) : eq(schema.drafts.targetId, targetId));
  return db.query.drafts.findMany({ where: and(...where), orderBy: [desc(schema.drafts.createdAt), desc(schema.drafts.id)] });
}

/** Every waiting draft by the menu item that holds it, Claude's webinar drafts included, for the amber dots and Today's line. */
export async function waitingByMenu(o: Owner): Promise<Record<string, number>> {
  const [mine, webinar] = await Promise.all([
    pendingDrafts(o),
    db.query.webinarDrafts.findMany({ where: and(eq(schema.webinarDrafts.workspaceId, o.workspaceId), eq(schema.webinarDrafts.userId, o.userId), eq(schema.webinarDrafts.status, "pending")), columns: { id: true } }),
  ]);
  const out: Record<string, number> = {};
  for (const d of mine) out[AREA_WORDS[d.area].menu] = (out[AREA_WORDS[d.area].menu] ?? 0) + 1;
  if (webinar.length) out["/webinars"] = webinar.length;
  return out;
}

export const waitingCount = (byMenu: Record<string, number>): number => Object.values(byMenu).reduce((a, b) => a + b, 0);

async function ownDraft(o: Owner, draftId: string) {
  if (!draftId) return null;
  return (await db.query.drafts.findFirst({ where: and(eq(schema.drafts.id, draftId), eq(schema.drafts.workspaceId, o.workspaceId), eq(schema.drafts.userId, o.userId)) })) ?? null;
}

/** The red lines for a draft as it stands now (H-184): Approve stays off while there is one. */
export async function redLinesFor(o: Owner, d: schema.Draft): Promise<string[]> {
  const row = await areaRow(o, d.area, d.targetId);
  if (d.targetId && !row) return [`That ${AREA_WORDS[d.area].one.toLowerCase()} isn't there any more. Discard this draft.`];
  return redLines(d.area, d, row, `${await areaFacts(o, d.area)}\n${d.source}`);
}

/** A keyword no other magnet in the workspace has: the title's first word, then with a number. */
async function freeKeyword(workspaceId: string, title: string): Promise<string> {
  const base = keywordOf(title.split(/\s+/)[0] ?? "") || "GUIDE";
  for (let n = 0; n < 50; n++) {
    const k = n ? `${base.slice(0, 22)}${n + 1}` : base;
    if (!(await db.query.leadMagnets.findFirst({ where: and(eq(schema.leadMagnets.workspaceId, workspaceId), eq(schema.leadMagnets.keyword, k)) }))) return k;
  }
  return `${base.slice(0, 18)}${newId().slice(0, 6).toUpperCase()}`;
}
async function freeSlug(title: string): Promise<string> {
  const base = slugify(title);
  for (let n = 0; n < 50; n++) {
    const slug = n ? `${base}-${n + 1}` : base;
    if (!(await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.slug, slug) }))) return slug;
  }
  return `${base}-${newId().slice(0, 6).toLowerCase()}`;
}

type Written = { ok: true; id: string } | { ok: false; why: string };

/**
 * Writes a draft's values into the member's row, through the same columns the area's own save writes. The words were Claude's
 * and the member read them before approving, so they are marked accepted (never unreviewed). Nothing is published, scheduled,
 * sent or made live: a magnet stays unpublished, a post lands In progress on its date, an offer stays as it was.
 */
async function write(o: Owner, area: DraftArea, targetId: string | null, values: Record<string, unknown>): Promise<Written> {
  const set = Object.fromEntries(Object.entries(values).filter(([k]) => keysOf(area, targetId).includes(k)));
  if (area === "offer") {
    const id = targetId ?? (await createOffer(o, { name: String(values.name ?? "New offer") }));
    if (Object.keys(set).length) await db.update(schema.offers).set(set as Partial<schema.Offer>).where(and(eq(schema.offers.id, id), eq(schema.offers.workspaceId, o.workspaceId), eq(schema.offers.userId, o.userId)));
    queueProgress(o.workspaceId, o.userId, "offer_changed");
    return { ok: true, id };
  }
  if (area === "essence") {
    if (!targetId || !sectionByKey(targetId)) return { ok: false, why: "That Essence section isn't there." };
    const row = await essenceRow(o);
    const current = normalizeEssence(row?.data ?? {});
    const next = normalizeEssence({ ...current, [targetId]: { ...(current[targetId] ?? {}), ...set } });
    const over = essenceSaveRefusal(current, next);
    if (over) return { ok: false, why: `That would make your Essence ${over.chars.toLocaleString()} characters, over its limit. Use Edit to trim it, or Discard.` };
    if (row) await db.update(schema.essences).set({ data: next, updatedAt: nowIso() }).where(eq(schema.essences.id, row.id));
    else await db.insert(schema.essences).values({ id: newId(), workspaceId: o.workspaceId, userId: o.userId, data: next });
    return { ok: true, id: targetId };
  }
  if (area === "magnet") {
    if (targetId) {
      await db.update(schema.leadMagnets).set({ ...(set as Partial<schema.LeadMagnet>), origin: "ai_accepted", updatedAt: nowIso() }).where(and(eq(schema.leadMagnets.id, targetId), eq(schema.leadMagnets.workspaceId, o.workspaceId), eq(schema.leadMagnets.userId, o.userId)));
      return { ok: true, id: targetId };
    }
    const id = newId();
    const title = String(values.title ?? "New lead magnet");
    await db.insert(schema.leadMagnets).values({ id, workspaceId: o.workspaceId, userId: o.userId, title, keyword: await freeKeyword(o.workspaceId, title), slug: await freeSlug(title), generatedBy: "Claude (connector)", ...(set as Partial<schema.LeadMagnet>), origin: "ai_accepted" });
    return { ok: true, id };
  }
  if (area === "content") {
    const { pillar, suggestedDate, ...cols } = set as Record<string, unknown>;
    const id = targetId ?? (await createContentItem(o, { title: String(values.title ?? "New post"), status: "creating" }));
    const row = await areaRow(o, "content", id);
    const notes = pillar !== undefined ? [`Pillar: ${pillar}`, String(row?.notes ?? "").replace(PILLAR, "").trim()].filter(Boolean).join("\n") : undefined;
    const time = String(row?.postAt ?? "").slice(11, 16) || "09:00";
    await db
      .update(schema.contentItems)
      .set({ ...(cols as Partial<schema.ContentItem>), ...(notes !== undefined ? { notes } : {}), ...(suggestedDate !== undefined ? { postAt: suggestedDate ? `${suggestedDate}T${time}:00` : null } : {}), ...(row?.status === "idea" && suggestedDate ? { status: "creating" as const } : {}), origin: "ai_accepted" })
      .where(and(eq(schema.contentItems.id, id), eq(schema.contentItems.workspaceId, o.workspaceId), eq(schema.contentItems.userId, o.userId)));
    return { ok: true, id };
  }
  if (area === "bot_profile") {
    if (!targetId) return { ok: false, why: "Your bot's words belong to you; there's no new one to make." };
    // Only these words: the bot is sent nothing here (it keeps its answers until the next push the member approves on Your bot).
    if (Object.keys(set).length) await db.update(schema.memberships).set(set as Partial<schema.Membership>).where(and(eq(schema.memberships.id, targetId), eq(schema.memberships.workspaceId, o.workspaceId), eq(schema.memberships.userId, o.userId)));
    return { ok: true, id: targetId };
  }
  return { ok: false, why: "Drafts of that kind come later." };
}

/**
 * Approve: the draft goes in, its red lines checked again first, and the values it replaced kept for Undo. A draft of a new row
 * makes the row (an offer starts as a draft offer: approving never makes anything live or public).
 */
export async function approveDraft(o: Owner, draftId: string, by: Actor): Promise<Result> {
  const d = await ownDraft(o, draftId);
  if (!d || d.status !== "pending") return { ok: false, why: "That draft isn't waiting any more." };
  const red = await redLinesFor(o, d);
  if (red.length) return { ok: false, why: `Not approved: ${red.join(" ")}` };
  const before = d.targetId ? pick(await areaRow(o, d.area, d.targetId), Object.keys(d.fields)) : null;
  const w = await write(o, d.area, d.targetId, d.fields);
  if (!w.ok) return { ok: false, why: `Not approved: ${w.why}` };
  const targetId = w.id;
  await db.update(schema.drafts).set({ status: "approved", decidedAt: nowIso(), decidedBy: by.name, ...(d.targetId ? {} : { targetId }) }).where(eq(schema.drafts.id, d.id));
  await log(o, { area: d.area, targetId, draftId: d.id, action: "approved", by, changed: Object.keys(d.fields), before });
  return { ok: true, targetId };
}

/** Discard: only the draft goes; what the member has is untouched. */
export async function discardDraft(o: Owner, draftId: string, by: Actor): Promise<Result> {
  const d = await ownDraft(o, draftId);
  if (!d || d.status !== "pending") return { ok: false, why: "That draft isn't waiting any more." };
  await db.update(schema.drafts).set({ status: "discarded", decidedAt: nowIso(), decidedBy: by.name }).where(eq(schema.drafts.id, d.id));
  await log(o, { area: d.area, targetId: d.targetId, draftId: d.id, action: "discarded", by });
  return { ok: true, targetId: d.targetId };
}

/** Edit: the member saved the area's own form, opened filled with the draft. The draft is settled as edited. */
export async function markDraftEdited(o: Owner, draftId: string, targetId: string, by: Actor): Promise<void> {
  const d = await ownDraft(o, draftId);
  if (!d || d.status !== "pending" || (d.targetId && d.targetId !== targetId)) return;
  await db.update(schema.drafts).set({ status: "edited", decidedAt: nowIso(), decidedBy: by.name, targetId }).where(eq(schema.drafts.id, d.id));
  await log(o, { area: d.area, targetId, draftId: d.id, action: "edited", by });
}

/**
 * Edit on a draft of a new row: the row is made now with just its name (an offer starts as a draft offer), and the draft moves
 * onto it, so the area's own form opens filled with it. Nothing else of the draft goes in until the member saves.
 */
export async function startFromNewDraft(o: Owner, draftId: string): Promise<{ ok: true; targetId: string; area: DraftArea } | { ok: false; why: string }> {
  const d = await ownDraft(o, draftId);
  if (!d || d.status !== "pending" || d.targetId) return { ok: false, why: "That draft isn't waiting any more." };
  let targetId: string;
  if (d.area === "offer") targetId = await createOffer(o, { name: String(d.fields.name ?? "New offer") });
  else if (d.area === "magnet" || d.area === "content") {
    // Made with its title alone (a magnet unpublished, a post in Ideas); the rest of the draft waits in the form.
    const title = String(d.fields.title ?? (d.area === "magnet" ? "New lead magnet" : "New post"));
    if (d.area === "content") targetId = await createContentItem(o, { title, status: "idea" });
    else {
      targetId = newId();
      await db.insert(schema.leadMagnets).values({ id: targetId, workspaceId: o.workspaceId, userId: o.userId, title, keyword: await freeKeyword(o.workspaceId, title), slug: await freeSlug(title), generatedBy: "Claude (connector)", origin: "coach" });
    }
  } else return { ok: false, why: "That draft opens on its own page." };
  const row = await areaRow(o, d.area, targetId);
  await db.update(schema.drafts).set({ targetId, base: pick(row, Object.keys(d.fields)) }).where(eq(schema.drafts.id, d.id));
  return { ok: true, targetId, area: d.area };
}

/** A row's history, newest first: what Claude drafted there and what the member did with it. */
export async function changesFor(o: Owner, area: DraftArea, targetId: string, limit = 30): Promise<schema.ChangeHistoryRow[]> {
  return db.query.changeHistory.findMany({ where: and(eq(schema.changeHistory.workspaceId, o.workspaceId), eq(schema.changeHistory.userId, o.userId), eq(schema.changeHistory.area, area), eq(schema.changeHistory.targetId, targetId)), orderBy: [desc(schema.changeHistory.createdAt), desc(schema.changeHistory.id)], limit });
}

/** Whether a history row has an Undo now. */
export const canUndo = (h: schema.ChangeHistoryRow, nowMs: number): boolean => !h.undoneAt && undoOpen(h.createdAt, nowMs) && ((h.action === "approved" && h.before !== null) || h.action === "drafted" || h.action === "discarded");

/**
 * Undo, for seven days: an Approve puts back the values it replaced; a written draft still waiting is discarded; a Discard
 * brings the draft back, unless a newer one for that row is waiting. A new row an Approve made stays (retire it on its page).
 */
export async function undoChange(o: Owner, historyId: string, by: Actor): Promise<Result> {
  const h = await db.query.changeHistory.findFirst({ where: and(eq(schema.changeHistory.id, historyId), eq(schema.changeHistory.workspaceId, o.workspaceId), eq(schema.changeHistory.userId, o.userId)) });
  if (!h) return { ok: false, why: "Nothing to undo there." };
  if (h.undoneAt) return { ok: false, why: "That was already undone." };
  if (!undoOpen(h.createdAt, Date.now())) return { ok: false, why: "Undo is open for seven days, and that was longer ago." };
  const d = h.draftId ? await ownDraft(o, h.draftId) : null;
  if (h.action === "approved") {
    if (!h.before || !h.targetId) return { ok: false, why: `A new ${AREA_WORDS[h.area].one.toLowerCase()} stays once approved. Retire it on its page if you don't want it.` };
    if (!(await areaRow(o, h.area, h.targetId))) return { ok: false, why: `That ${AREA_WORDS[h.area].one.toLowerCase()} isn't there any more.` };
    const w = await write(o, h.area, h.targetId, h.before);
    if (!w.ok) return { ok: false, why: w.why };
  } else if (h.action === "drafted" && d) {
    if (d.status !== "pending") return { ok: false, why: "That draft was already approved, edited or discarded; undo that instead." };
    await db.update(schema.drafts).set({ status: "discarded", decidedAt: nowIso(), decidedBy: by.name }).where(eq(schema.drafts.id, d.id));
  } else if (h.action === "discarded" && d) {
    const newer = d.targetId ? await pendingDrafts(o, d.area, d.targetId) : [];
    if (newer.length) return { ok: false, why: "A newer draft is waiting there, so this one stays discarded." };
    await db.update(schema.drafts).set({ status: "pending", decidedAt: null, decidedBy: null }).where(eq(schema.drafts.id, d.id));
  } else return { ok: false, why: "That can't be undone here." };
  await db.update(schema.changeHistory).set({ undoneAt: nowIso(), undoneBy: by.name }).where(eq(schema.changeHistory.id, h.id));
  await log(o, { area: h.area, targetId: h.targetId, draftId: h.draftId, action: "undone", by, changed: h.changed });
  return { ok: true, targetId: h.targetId };
}
