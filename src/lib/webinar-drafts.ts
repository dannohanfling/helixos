/**
 * Claude's webinar drafts (H-181, plan H-684), the database side: a connector call writes a draft beside the webinar, never into
 * it; the wizard's Approve writes it through, Edit opens the form filled with it, Discard drops it; every one of those is a
 * history row, and Undo (seven days) puts back what an Approve replaced. Each webinar is reached only through its own
 * workspace and member: another's reads as not found.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { subjectFor } from "@/lib/queries/subject";
import { BELIEF_COLUMN, BELIEF_FIELDS, BELIEF_TYPES, CONNECTOR_LABEL, FOUNDATION_FIELDS, undoOpen, type BeliefDraft, type BeliefField, type BeliefType, type DraftableStep, type FoundationDraft, type OfferDraft } from "@/lib/engine/webinar-drafts";

export type Owner = { workspaceId: string; userId: string };
export type Actor = { name: string; connector: boolean; appId?: string | null; agentId?: string | null };

/** The member's own webinar, or null: another workspace's or another member's reads exactly like one that doesn't exist. */
export async function ownWebinar(o: Owner, id: string): Promise<schema.Webinar | null> {
  if (!id) return null;
  return (await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.workspaceId, o.workspaceId), eq(schema.webinars.userId, o.userId)) })) ?? null;
}

export async function pendingDrafts(webinarId: string): Promise<schema.WebinarDraft[]> {
  return db.query.webinarDrafts.findMany({ where: and(eq(schema.webinarDrafts.webinarId, webinarId), eq(schema.webinarDrafts.status, "pending")), orderBy: desc(schema.webinarDrafts.createdAt) });
}

export async function historyFor(webinarId: string, limit = 30): Promise<schema.WebinarHistoryRow[]> {
  return db.query.webinarHistory.findMany({ where: eq(schema.webinarHistory.webinarId, webinarId), orderBy: [desc(schema.webinarHistory.createdAt), desc(schema.webinarHistory.id)], limit });
}

async function logHistory(o: Owner, row: { webinarId: string; draftId?: string | null; step?: schema.WebinarDraftStep | null; action: (typeof schema.WEBINAR_HISTORY_ACTIONS)[number]; by: Actor; changed?: string[]; before?: Record<string, unknown> | null }) {
  const id = newId();
  await db.insert(schema.webinarHistory).values({ id, workspaceId: o.workspaceId, userId: o.userId, webinarId: row.webinarId, draftId: row.draftId ?? null, step: row.step ?? null, action: row.action, byLabel: row.by.connector ? CONNECTOR_LABEL : row.by.name, byConnector: row.by.connector, changed: row.changed ?? [], before: row.before ?? null, createdAt: nowIso() });
  return id;
}

/** A webinar started by the connector: the same start as the wizard's New webinar, with the history saying who. */
export async function noteCreated(o: Owner, webinarId: string, by: Actor) {
  await logHistory(o, { webinarId, action: "created", by });
}

/** The names a draft's fields change, for the history line ("vehicle.from", "outcomes"). */
export function changedNames(step: DraftableStep, fields: Record<string, unknown>): string[] {
  if (step !== "beliefs") return Object.keys(fields);
  return Object.entries(fields).flatMap(([type, v]) => Object.keys(v as Record<string, string>).map((f) => `${type}.${f}`));
}

/**
 * Claude's draft of one step, beside the webinar. One pending draft per step: a newer one replaces the older (marked replaced,
 * kept in the history). Never touches the webinar itself.
 */
export async function saveDraft(o: Owner, w: schema.Webinar, step: DraftableStep, fields: Record<string, unknown>, notes: string[], by: Actor): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db.update(schema.webinarDrafts).set({ status: "replaced", decidedAt: now }).where(and(eq(schema.webinarDrafts.webinarId, w.id), eq(schema.webinarDrafts.step, step), eq(schema.webinarDrafts.sectionKey, ""), eq(schema.webinarDrafts.status, "pending")));
  await db.insert(schema.webinarDrafts).values({ id, workspaceId: o.workspaceId, userId: o.userId, webinarId: w.id, step, sectionKey: "", fields, notes, byLabel: by.connector ? CONNECTOR_LABEL : by.name, appId: by.appId ?? null, agentId: by.agentId ?? null, status: "pending", createdAt: now });
  await logHistory(o, { webinarId: w.id, draftId: id, step, action: "drafted", by, changed: changedNames(step, fields) });
  return id;
}

export type Citation = { field: string; id: string; why: string };

/**
 * The ids a beliefs or offer draft cites, checked against what the member may use today. A proof must be approved with its
 * permission tick; a story must be one of theirs (the library's or their Essence's), and a story bank item marked "Check before
 * using" or "Needs permission" is never used; a study must be a confirmed one; an offer must be theirs. Refused ids come back
 * with why, and the rest of the draft stands.
 */
export async function checkCitations(o: Owner & { name?: string }, step: DraftableStep, fields: Record<string, unknown>): Promise<{ fields: Record<string, unknown>; refused: Citation[] }> {
  const refused: Citation[] = [];
  if (step === "foundation") return { fields, refused };
  const subject = await subjectFor({ userId: o.userId, workspaceId: o.workspaceId, name: o.name ?? "" });
  if (step === "offer") {
    const f = { ...(fields as OfferDraft) };
    if (f.offerId && !subject.offers.some((x) => x.id === f.offerId)) {
      refused.push({ field: "offerId", id: f.offerId, why: "not one of your offers" });
      delete f.offerId;
    }
    return { fields: f, refused };
  }
  const allProofs = await db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, o.workspaceId), eq(schema.proofs.userId, o.userId)) });
  const bank = await db.query.storyItems.findMany({ where: and(eq(schema.storyItems.workspaceId, o.workspaceId), eq(schema.storyItems.userId, o.userId)) });
  const out: Record<string, unknown> = {};
  for (const [type, v] of Object.entries(fields as BeliefDraft)) {
    const b = { ...(v ?? {}) } as Partial<Record<BeliefField, string>>;
    const refuse = (f: BeliefField, why: string) => {
      refused.push({ field: `${type}.${f}`, id: b[f]!, why });
      delete b[f];
    };
    if (b.proofId) {
      const p = allProofs.find((x) => x.id === b.proofId);
      if (!p) refuse("proofId", "not in your Proof Bank");
      else if (p.status !== "approved" || !p.permissionAt) refuse("proofId", `needs permission first: "${p.name}" is ${p.status !== "approved" ? "not approved yet" : "approved without the client's permission tick"}`);
    }
    if (b.storyId) {
      const item = bank.find((x) => x.id === b.storyId);
      if (item) refuse("storyId", item.status === "ready" ? `"${item.title}" is a story bank line for the writers; pick a story from your library or your Essence for an act` : `needs permission first: "${item.title}" is marked ${item.status === "check" ? "Check before using" : "Needs permission"}`);
      else if (!subject.known.storyIds.includes(b.storyId)) refuse("storyId", "not one of your stories");
    }
    if (b.evidenceId && !subject.known.evidenceIds.includes(b.evidenceId)) refuse("evidenceId", "not a confirmed study on your shelf");
    if (Object.keys(b).length) out[type] = b;
  }
  return { fields: out, refused };
}

/** What a draft would replace, read now, for the history's Undo. */
async function currentValues(w: schema.Webinar, step: DraftableStep, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (step === "foundation" || step === "offer") return Object.fromEntries(Object.keys(fields).map((k) => [k, (w as Record<string, unknown>)[k] ?? null]));
  const rows = await db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) });
  const out: Record<string, Record<string, string | null>> = {};
  for (const [type, v] of Object.entries(fields as BeliefDraft)) {
    const row = rows.find((r) => r.type === type);
    out[type] = Object.fromEntries(Object.keys(v ?? {}).map((f) => [f, (row?.[BELIEF_COLUMN[f as BeliefField]] as string | null | undefined) ?? null]));
  }
  return out;
}

/** Writes a step's values into the webinar: the same columns the wizard's own save writes. */
async function writeValues(w: schema.Webinar, step: DraftableStep, values: Record<string, unknown>) {
  const now = nowIso();
  if (step === "foundation") {
    const set: Record<string, unknown> = {};
    for (const k of FOUNDATION_FIELDS) if (k in values) set[k] = k === "outcomes" ? ((values[k] as string[] | null) ?? []) : k === "originStory" ? ((values[k] as Record<string, string> | null) ?? {}) : values[k];
    // The wizard's save moves a draft webinar to building; a later status (ready, scheduled) is never moved back.
    await db.update(schema.webinars).set({ ...(set as Partial<schema.Webinar>), ...(w.status === "draft" ? { status: "building" as const } : {}), updatedAt: now }).where(eq(schema.webinars.id, w.id));
  } else if (step === "offer") {
    const v = values as { offerId?: string | null; ctaType?: string | null };
    await db.update(schema.webinars).set({ ...("offerId" in v ? { offerId: v.offerId ?? null } : {}), ...(v.ctaType ? { ctaType: v.ctaType } : {}), updatedAt: now }).where(eq(schema.webinars.id, w.id));
  } else {
    for (const type of BELIEF_TYPES) {
      const v = (values as Record<string, Record<string, string | null>>)[type];
      if (!v) continue;
      const set = Object.fromEntries(BELIEF_FIELDS.filter((f) => f in v).map((f) => [BELIEF_COLUMN[f], v[f] ?? null]));
      await db.update(schema.webinarBeliefs).set(set).where(and(eq(schema.webinarBeliefs.webinarId, w.id), eq(schema.webinarBeliefs.type, type as BeliefType)));
    }
    await db.update(schema.webinars).set({ updatedAt: now }).where(eq(schema.webinars.id, w.id));
  }
}

export type DraftResult = { ok: true } | { ok: false; why: string };

async function ownDraft(o: Owner, draftId: string) {
  const d = await db.query.webinarDrafts.findFirst({ where: and(eq(schema.webinarDrafts.id, draftId), eq(schema.webinarDrafts.workspaceId, o.workspaceId), eq(schema.webinarDrafts.userId, o.userId)) });
  const w = d ? await ownWebinar(o, d.webinarId) : null;
  return d && w ? { d, w } : null;
}

/**
 * Approve: the draft goes into the webinar through the same columns the step's save writes, its citations checked again (a
 * proof's approval or a study may have changed since), and the replaced values kept for Undo.
 */
export async function approveDraft(o: Owner & { name?: string }, draftId: string, by: Actor): Promise<DraftResult> {
  const got = await ownDraft(o, draftId);
  if (!got || got.d.status !== "pending") return { ok: false, why: "That draft isn't waiting any more." };
  const { d, w } = got;
  const step = d.step as DraftableStep;
  const checked = await checkCitations(o, step, d.fields);
  if (checked.refused.length) return { ok: false, why: `Not approved: ${checked.refused.map((r) => `${r.field} ${r.why}`).join("; ")}. Discard it, or edit it and pick another.` };
  const before = await currentValues(w, step, d.fields);
  await writeValues(w, step, d.fields);
  await db.update(schema.webinarDrafts).set({ status: "approved", decidedAt: nowIso(), decidedBy: by.name }).where(eq(schema.webinarDrafts.id, d.id));
  await logHistory(o, { webinarId: w.id, draftId: d.id, step, action: "approved", by, changed: changedNames(step, d.fields), before });
  return { ok: true };
}

export async function discardDraft(o: Owner, draftId: string, by: Actor): Promise<DraftResult> {
  const got = await ownDraft(o, draftId);
  if (!got || got.d.status !== "pending") return { ok: false, why: "That draft isn't waiting any more." };
  await db.update(schema.webinarDrafts).set({ status: "discarded", decidedAt: nowIso(), decidedBy: by.name }).where(eq(schema.webinarDrafts.id, draftId));
  await logHistory(o, { webinarId: got.w.id, draftId, step: got.d.step, action: "discarded", by });
  return { ok: true };
}

/** Edit: the member saved the step's form, opened filled with the draft. The draft is settled as edited. */
export async function markDraftEdited(o: Owner, draftId: string, webinarId: string, by: Actor): Promise<void> {
  const got = await ownDraft(o, draftId);
  if (!got || got.d.status !== "pending" || got.w.id !== webinarId) return;
  await db.update(schema.webinarDrafts).set({ status: "edited", decidedAt: nowIso(), decidedBy: by.name }).where(eq(schema.webinarDrafts.id, draftId));
  await logHistory(o, { webinarId, draftId, step: got.d.step, action: "edited", by });
}

/**
 * Undo, for seven days: an Approve puts back the values it replaced; a written draft still waiting is discarded; a Discard
 * brings the draft back, unless a newer one for that step is waiting. A row already undone, or a start, has no Undo.
 */
export async function undoHistory(o: Owner, historyId: string, by: Actor): Promise<DraftResult> {
  const h = await db.query.webinarHistory.findFirst({ where: and(eq(schema.webinarHistory.id, historyId), eq(schema.webinarHistory.workspaceId, o.workspaceId), eq(schema.webinarHistory.userId, o.userId)) });
  const w = h ? await ownWebinar(o, h.webinarId) : null;
  if (!h || !w) return { ok: false, why: "Nothing to undo there." };
  if (h.undoneAt) return { ok: false, why: "That was already undone." };
  if (!undoOpen(h.createdAt, Date.now())) return { ok: false, why: "Undo is open for seven days, and that was longer ago." };
  const d = h.draftId ? await db.query.webinarDrafts.findFirst({ where: eq(schema.webinarDrafts.id, h.draftId) }) : null;
  const step = h.step as DraftableStep | null;
  if (h.action === "approved" && step && h.before) await writeValues(w, step, h.before);
  else if (h.action === "drafted" && d) {
    if (d.status !== "pending") return { ok: false, why: "That draft was already approved, edited or discarded; undo that instead." };
    await db.update(schema.webinarDrafts).set({ status: "discarded", decidedAt: nowIso(), decidedBy: by.name }).where(eq(schema.webinarDrafts.id, d.id));
  } else if (h.action === "discarded" && d && step) {
    const newer = await db.query.webinarDrafts.findFirst({ where: and(eq(schema.webinarDrafts.webinarId, w.id), eq(schema.webinarDrafts.step, step), eq(schema.webinarDrafts.status, "pending")) });
    if (newer) return { ok: false, why: "A newer draft of that step is waiting, so this one stays discarded." };
    await db.update(schema.webinarDrafts).set({ status: "pending", decidedAt: null, decidedBy: null }).where(eq(schema.webinarDrafts.id, d.id));
  } else return { ok: false, why: "That can't be undone here." };
  await db.update(schema.webinarHistory).set({ undoneAt: nowIso(), undoneBy: by.name }).where(eq(schema.webinarHistory.id, h.id));
  await logHistory(o, { webinarId: w.id, draftId: h.draftId, step, action: "undone", by, changed: h.changed });
  return { ok: true };
}

/** A foundation draft as the wizard form's default values, for Edit. */
export function foundationDefaults(w: schema.Webinar, d: FoundationDraft): schema.Webinar {
  return { ...w, ...(d as Partial<schema.Webinar>), outcomes: d.outcomes ?? w.outcomes, originStory: { ...w.originStory, ...(d.originStory ?? {}) } };
}
