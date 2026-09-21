"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { DECK_IMAGE_KINDS, type DeckImageKind } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { consentRequired, deckImageRefusal, deckKeyOwner } from "@/lib/engine/deck-image";
import { redactUrls } from "@/lib/engine/storage-policy";
import { imageDimensions } from "@/lib/proof-renditions";
import { deleteProofObject, headProofObject, readProofObject } from "@/lib/proof-storage";

const log = (what: string, detail: Record<string, unknown>) => console.error(`[deck-image] ${what}`, redactUrls(JSON.stringify({ ...detail, ...(typeof detail.message === "string" ? { message: detail.message.slice(0, 300) } : {}) })));

async function discard(url: string | null | undefined, why: string): Promise<void> {
  if (!url) return;
  try {
    await deleteProofObject(url);
  } catch (e) {
    log(`could not delete an object after ${why}; it is orphaned`, { message: e instanceof Error ? e.message : String(e) });
  }
}

export type RecordDeckImageResult = { ok: true; id: string } | { ok: false; error: string };
const TRANSIENT = "Storage couldn't be read back just now. Nothing is saved. Try again in a minute.";

type RecordInput = { key: string; kind: DeckImageKind; caption: string; consentTick: boolean; consentName: string };
function parseInput(raw: unknown): RecordInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" ? r.key : "";
  const kind = typeof r.kind === "string" && (DECK_IMAGE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as DeckImageKind) : null;
  if (!key || !kind) return null;
  return { key, kind, caption: typeof r.caption === "string" ? r.caption.slice(0, 200) : "", consentTick: r.consentTick === true, consentName: typeof r.consentName === "string" ? r.consentName.slice(0, 120) : "" };
}

/**
 * Records one image the browser sent straight to the private store. Nothing the browser said is trusted: the key must be under
 * the coach's own deck folder, the object is read back by its key (size, URL), its first bytes are sniffed for what it really is
 * (a .png that reads as HTML is deleted, not stored), and only then does a row exist. A screenshot or a proof image affirms the
 * consent tick and a name before it is kept; without them the object is deleted, not stored. Recording the same object twice
 * returns the row that exists.
 */
export async function recordDeckImageAction(raw: unknown): Promise<RecordDeckImageResult> {
  const input = parseInput(raw);
  if (!input) return { ok: false, error: "That upload couldn't be recorded. Choose the image again." };
  const { workspaceId, userId } = await ctx();
  const owner = deckKeyOwner(input.key);
  if (!owner || owner.workspaceId !== workspaceId || owner.userId !== userId) return { ok: false, error: "That file is not under your own deck folder. Choose the image again." };

  const already = await db.query.deckImages.findFirst({ where: eq(schema.deckImages.blobKey, input.key) });
  if (already) return already.userId === userId ? { ok: true, id: already.id } : { ok: false, error: "That file is already in someone else's library." };

  // A screenshot or proof needs the consent tick and a name before the bytes are ever read back, so a refusal costs nothing.
  if (consentRequired(input.kind) && (!input.consentTick || !input.consentName.trim())) {
    await discard((await headOrNull(input.key))?.url, "a missing consent tick");
    return { ok: false, error: "Tick that you've hidden anyone's name, email or number who hasn't agreed to be shown, and write who's in it, before adding a screenshot or proof." };
  }

  let object: { key: string; url: string; size: number };
  try {
    object = await headProofObject(input.key);
  } catch (e) {
    log("could not read an uploaded object back", { key: input.key, message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: TRANSIENT };
  }
  const headRes = await readProofObject(object.url, "bytes=0-4095");
  if (!(headRes.ok || headRes.status === 206)) {
    log("the store refused the sniff read; the object is left for a retry", { key: input.key, status: headRes.status });
    return { ok: false, error: TRANSIENT };
  }
  const verdict = deckImageRefusal(new Uint8Array(await headRes.arrayBuffer()), object.size);
  if ("error" in verdict) {
    await discard(object.url, "a refused upload");
    return { ok: false, error: verdict.error };
  }

  let width = 0;
  let height = 0;
  try {
    const wholeRes = await readProofObject(object.url);
    if (!wholeRes.ok) throw new Error(`read ${wholeRes.status}`);
    const dims = await imageDimensions(Buffer.from(await wholeRes.arrayBuffer()));
    width = dims.width ?? 0;
    height = dims.height ?? 0;
  } catch (e) {
    // Dimensions are for the render's aspect handling; a GIF or an unusual encoding that can't be measured still stores at 0×0.
    log("could not read an image's dimensions", { key: input.key, message: e instanceof Error ? e.message : String(e) });
  }

  const id = newId();
  const consent = consentRequired(input.kind) ? { consentTick: true, consentName: input.consentName.trim(), consentAt: nowIso() } : { consentTick: false, consentName: null, consentAt: null };
  try {
    await db.insert(schema.deckImages).values({ id, workspaceId, userId, kind: input.kind, blobKey: object.key, blobUrl: object.url, mime: verdict.sniffed.mime, width, height, caption: input.caption.trim() || null, ...consent });
  } catch (e) {
    log("the row could not be written; the object is removed", { key: input.key, message: e instanceof Error ? e.message : String(e) });
    await discard(object.url, "a failed insert");
    return { ok: false, error: "That image couldn't be saved just now. Nothing is kept. Try again in a minute." };
  }
  refresh();
  return { ok: true, id };
}

async function headOrNull(key: string): Promise<{ url: string } | null> {
  try {
    return await headProofObject(key);
  } catch {
    return null;
  }
}

/** Updates a caption on the coach's own image. */
export async function updateDeckImageCaptionAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, id), eq(schema.deckImages.workspaceId, workspaceId), eq(schema.deckImages.userId, userId)) });
  if (!img) return;
  await db.update(schema.deckImages).set({ caption: str(formData, "caption").slice(0, 200) || null }).where(eq(schema.deckImages.id, img.id));
  refresh();
}

/**
 * Deletes the object first, then the row, and drops the image out of any slot that had picked it, so no slide points at a file
 * that is gone. If the store refuses the delete, the row stays and nothing is dropped, so the image never vanishes from view
 * while its bytes are still live.
 */
export async function deleteDeckImageAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, id), eq(schema.deckImages.workspaceId, workspaceId), eq(schema.deckImages.userId, userId)) });
  if (!img) return;
  try {
    await deleteProofObject(img.blobUrl);
  } catch (e) {
    log("delete refused; the row stays", { imageId: img.id, message: e instanceof Error ? e.message : String(e) });
    return;
  }
  await db.update(schema.deckSlots).set({ imageId: null }).where(eq(schema.deckSlots.imageId, img.id));
  await db.delete(schema.deckImages).where(eq(schema.deckImages.id, img.id));
  refresh();
}

/** The coach's own webinar, or nowhere. */
async function ownWebinar(webinarId: string, userId: string) {
  return db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, webinarId), eq(schema.webinars.userId, userId)) });
}

/**
 * Attaches one of the coach's images to a suggested slot on their webinar, keyed by the slot's stable key. The image must be
 * the coach's own; the webinar must be the coach's own. Setting a slot that already has a row replaces its image; the unique
 * index on (webinar, slot) keeps one image per slot. A testimonial slot is not set here — it draws from its approved proof.
 */
export async function setDeckSlotAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const webinarId = str(formData, "webinarId");
  const slotKey = str(formData, "slotKey");
  const imageId = str(formData, "imageId");
  if (!slotKey || !imageId) return;
  const w = await ownWebinar(webinarId, userId);
  if (!w) return;
  const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, imageId), eq(schema.deckImages.workspaceId, workspaceId), eq(schema.deckImages.userId, userId)) });
  if (!img) return;
  const existing = await db.query.deckSlots.findFirst({ where: and(eq(schema.deckSlots.webinarId, webinarId), eq(schema.deckSlots.slotKey, slotKey)) });
  if (existing) await db.update(schema.deckSlots).set({ imageId: img.id }).where(eq(schema.deckSlots.id, existing.id));
  else await db.insert(schema.deckSlots).values({ id: newId(), webinarId, slotKey, imageId: img.id });
  refresh();
}

/** Empties a slot: the slide falls back to text, the image stays in the library. */
export async function clearDeckSlotAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const webinarId = str(formData, "webinarId");
  const slotKey = str(formData, "slotKey");
  const w = await ownWebinar(webinarId, userId);
  if (!w) return;
  await db.update(schema.deckSlots).set({ imageId: null }).where(and(eq(schema.deckSlots.webinarId, webinarId), eq(schema.deckSlots.slotKey, slotKey)));
  refresh();
}
