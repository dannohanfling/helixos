"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { heicToJpeg, imageDimensions } from "@/lib/proof-renditions";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { admission, cleanFilename, displayKeyFor, moveFirst, needsOwnScreenTick, parseRecordInput, proofKeyWorkspace, refusal } from "@/lib/engine/proof-attachments";
import { redactUrls } from "@/lib/engine/storage-policy";
import { deleteProofObject, headProofObject, putProofObject, readProofObject } from "@/lib/proof-storage";
import { admissionFor, forgetAttachmentOnPosts } from "@/lib/queries/proof-attachments";

/** Every line here: a prefix, no query string, and a bounded message. */
const log = (what: string, detail: Record<string, unknown>) => console.error(`[proof-storage] ${what}`, redactUrls(JSON.stringify({ ...detail, ...(typeof detail.message === "string" ? { message: detail.message.slice(0, 300) } : {}) })));

/** A client's own proof in this workspace, or nowhere. */
async function ownProof(proofId: string, workspaceId: string, userId: string) {
  return db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, proofId), eq(schema.proofs.workspaceId, workspaceId), eq(schema.proofs.userId, userId)) });
}
async function ownAttachment(id: string, workspaceId: string, userId: string) {
  const att = await db.query.proofAttachments.findFirst({ where: and(eq(schema.proofAttachments.id, id), eq(schema.proofAttachments.workspaceId, workspaceId)) });
  if (!att) return null;
  const proof = await ownProof(att.proofId, workspaceId, userId);
  return proof ? att : null;
}

/** An object that will never get a row leaves the store, and a refusal to leave is logged: an orphan is never silent. */
async function discard(url: string | null | undefined, why: string): Promise<void> {
  if (!url) return;
  try {
    await deleteProofObject(url);
  } catch (e) {
    log(`could not delete an object after ${why}; it is orphaned`, { message: e instanceof Error ? e.message : String(e) });
  }
}

export type RecordResult = { ok: true; id: string } | { ok: false; error: string };
const TRANSIENT = "Storage couldn't be read back just now. Nothing is saved. Try again in a minute.";

/** Before the bytes move: the room this proof and this workspace have, in the client's words, or null. The browser's size is a claim; the store's size is checked again after. */
export async function checkProofUploadAction(proofId: string, size: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const { workspaceId, userId } = await ctx();
  const proof = await ownProof(proofId, workspaceId, userId);
  if (!proof) return { ok: false, error: "That proof is not yours." };
  const refused = await admissionFor(workspaceId, proof.id, Number.isFinite(size) && size > 0 ? size : 0);
  return refused ? { ok: false, error: refused } : { ok: true };
}

/**
 * Records a file the browser sent straight to the private store. Nothing the browser said is trusted: the input is checked
 * at the boundary, the object is read back from the store by its key (size, URL), its first bytes are sniffed for what it is
 * (a .jpg that reads as HTML is deleted, not stored), the kind's own cap, the count and the quota are applied inside the same
 * transaction as the insert, and only then does a row exist. Recording the same object twice returns the row that exists. A
 * HEIC gets a JPEG rendition beside it for display; the original is kept. Any failure after an object exists and before a row
 * does deletes the object, and a refused delete is logged.
 */
export async function recordProofAttachmentAction(raw: unknown): Promise<RecordResult> {
  const input = parseRecordInput(raw);
  if (!input) return { ok: false, error: "That upload couldn't be recorded. Choose the file again and press Attach." };
  const { workspaceId, userId } = await ctx();
  const proof = await ownProof(input.proofId, workspaceId, userId);
  if (!proof) return { ok: false, error: "That proof is not yours." };
  if (proofKeyWorkspace(input.key) !== workspaceId || !input.key.startsWith(`proofs/${workspaceId}/${proof.id}/`) || /-display\.jpg$/.test(input.key)) return { ok: false, error: "That file is not under this proof's folder. Choose the file again and press Attach." };
  // Already recorded: the same answer as the first time, and the object is never touched.
  const already = await db.query.proofAttachments.findFirst({ where: eq(schema.proofAttachments.blobKey, input.key) });
  if (already) return already.proofId === proof.id ? { ok: true, id: already.id } : { ok: false, error: "That file is already attached to another proof. Open it there, or choose the file again for this one." };

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
  const verdict = refusal(new Uint8Array(await headRes.arrayBuffer()), object.size);
  if ("error" in verdict) {
    await discard(object.url, "a refused upload");
    return { ok: false, error: verdict.error };
  }
  const { sniffed } = verdict;
  if (needsOwnScreenTick(sniffed.kind) && !input.ownScreen) {
    await discard(object.url, "a missing own-screen tick");
    return { ok: false, error: "Tick that this is your own screen before attaching it." };
  }
  const consent = input.showsAPerson && input.consentTick && input.consentName.trim() ? { consentName: input.consentName.trim(), consentRecordedAt: nowIso() } : { consentName: null, consentRecordedAt: null };
  // The gate holds a draft; it must not be walked around by attaching a person to a proof that is already approved.
  if (proof.status === "approved" && input.showsAPerson && !consent.consentRecordedAt) {
    await discard(object.url, "a person on an approved proof without permission");
    return { ok: false, error: "This proof is already approved, so a person in a file needs their permission recorded now. Write their name and tick the sentence, or send the proof back to draft first." };
  }
  const early = await admissionFor(workspaceId, proof.id, object.size);
  if (early) {
    await discard(object.url, "a refused admission");
    return { ok: false, error: early };
  }

  // Dimensions from the bytes, and the display rendition for a HEIC. A document has no dimensions; a video's are the player's.
  let width = sniffed.kind === "video" ? input.width : null;
  let height = sniffed.kind === "video" ? input.height : null;
  let display: { key: string; url: string; size: number } | null = null;
  if (sniffed.kind === "image") {
    try {
      const wholeRes = await readProofObject(object.url);
      if (!wholeRes.ok) throw new Error(`read ${wholeRes.status}`);
      const whole = Buffer.from(await wholeRes.arrayBuffer());
      let forSizing: Buffer = whole;
      if (sniffed.heic) {
        const jpeg = await heicToJpeg(whole);
        const put = await putProofObject(displayKeyFor(input.key), jpeg, "image/jpeg");
        display = { key: put.key, url: put.url, size: jpeg.length };
        forSizing = jpeg;
      }
      ({ width, height } = await imageDimensions(forSizing));
    } catch (e) {
      log("could not read an image's dimensions or render a HEIC", { key: input.key, message: e instanceof Error ? e.message : String(e) });
      if (sniffed.heic) {
        await discard(object.url, "a HEIC that could not be converted");
        await discard(display?.url, "a HEIC that could not be converted");
        return { ok: false, error: "That HEIC photo couldn't be converted. Export it as a JPEG and try again." };
      }
      width = null;
      height = null;
    }
  }

  const id = newId();
  try {
    const written = await db.transaction(async (tx) => {
      // The status, the count and the quota are read again here, beside the insert, so a concurrent approval or upload cannot slip between them.
      const fresh = await tx.query.proofs.findFirst({ where: eq(schema.proofs.id, proof.id) });
      if (!fresh) return "That proof is not yours.";
      if (fresh.status === "approved" && input.showsAPerson && !consent.consentRecordedAt) return "This proof is already approved, so a person in a file needs their permission recorded now. Write their name and tick the sentence, or send the proof back to draft first.";
      const siblings = await tx.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, proof.id), columns: { bytes: true, sortOrder: true } });
      const all = await tx.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.workspaceId, workspaceId), columns: { bytes: true, displayBytes: true } });
      const refused = admission(all.reduce((s, r) => s + r.bytes + (r.displayBytes ?? 0), 0), object.size + (display?.size ?? 0), siblings.length);
      if (refused) return refused;
      await tx.insert(schema.proofAttachments).values({
        id,
        proofId: proof.id,
        workspaceId,
        blobKey: object.key,
        blobUrl: object.url,
        displayKey: display?.key ?? null,
        displayUrl: display?.url ?? null,
        displayBytes: display?.size ?? null,
        kind: sniffed.kind,
        mime: sniffed.mime,
        bytes: object.size,
        originalFilename: cleanFilename(input.originalFilename, `${sniffed.kind}.${sniffed.ext}`),
        width,
        height,
        durationSeconds: sniffed.kind === "video" && input.durationSeconds ? Math.round(input.durationSeconds * 10) / 10 : null,
        altText: input.altText.trim() || null,
        sortOrder: siblings.reduce((m, r) => Math.max(m, r.sortOrder + 1), 0),
        showsAPerson: input.showsAPerson,
        showsAResult: input.showsAResult,
        ownScreenAt: needsOwnScreenTick(sniffed.kind) ? nowIso() : null,
        ...consent,
        uploadedBy: userId,
      });
      return null;
    });
    if (written) {
      await discard(object.url, "a refused insert");
      await discard(display?.url, "a refused insert");
      return { ok: false, error: written };
    }
  } catch (e) {
    log("the row could not be written; the objects are removed", { key: input.key, message: e instanceof Error ? e.message : String(e) });
    await discard(object.url, "a failed insert");
    await discard(display?.url, "a failed insert");
    return { ok: false, error: "That upload couldn't be saved just now. Nothing is kept. Try again in a minute." };
  }
  refresh();
  return { ok: true, id };
}

/** The likeness permission, recorded with a name and a time, the way tick two records it on the proof. */
export async function recordAttachmentConsentAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const att = await ownAttachment(str(formData, "id"), workspaceId, userId);
  if (!att) return;
  const name = str(formData, "consentName").slice(0, 120);
  if (!name || formData.get("consentTick") !== "on") redirect(`/proof/${att.proofId}?error=consent#att-${att.id}`);
  await db.update(schema.proofAttachments).set({ consentName: name, consentRecordedAt: nowIso() }).where(eq(schema.proofAttachments.id, att.id));
  refresh();
  redirect(`/proof/${att.proofId}#att-${att.id}`);
}

export async function updateAttachmentAltAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const att = await ownAttachment(str(formData, "id"), workspaceId, userId);
  if (!att) return;
  await db.update(schema.proofAttachments).set({ altText: str(formData, "altText").slice(0, 500) || null }).where(eq(schema.proofAttachments.id, att.id));
  refresh();
}

/** The first attachment is the thumbnail. Moving one first is the whole ordering feature. */
export async function moveAttachmentFirstAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const att = await ownAttachment(str(formData, "id"), workspaceId, userId);
  if (!att) return;
  const all = await db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, att.proofId), orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)] });
  const ordered = moveFirst(all, att.id);
  for (let i = 0; i < ordered.length; i++) if (ordered[i].sortOrder !== i) await db.update(schema.proofAttachments).set({ sortOrder: i }).where(eq(schema.proofAttachments.id, ordered[i].id));
  refresh();
}

/**
 * Deletion actually deletes: the object first (and a HEIC's rendition), then the row. If the store refuses, the row stays and
 * the client sees the error, so nothing goes missing from their view while the file is still live. Withdrawing a person's
 * permission is the same action: a file whose permission is withdrawn does not stay in the store. A post that had picked the
 * file forgets it.
 */
export async function deleteProofAttachmentAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const att = await ownAttachment(str(formData, "id"), workspaceId, userId);
  if (!att) return;
  try {
    await deleteProofObject(att.blobUrl);
    if (att.displayUrl) await deleteProofObject(att.displayUrl);
  } catch (e) {
    log("delete refused; the row stays", { attachmentId: att.id, message: e instanceof Error ? e.message : String(e) });
    redirect(`/proof/${att.proofId}?error=deleteRefused#att-${att.id}`);
  }
  await forgetAttachmentOnPosts([att.id]);
  await db.delete(schema.proofAttachments).where(eq(schema.proofAttachments.id, att.id));
  refresh();
  redirect(`/proof/${att.proofId}`);
}

