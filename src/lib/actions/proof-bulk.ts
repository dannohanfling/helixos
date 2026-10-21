"use server";

/**
 * Approve selected (H-1394): several drafts approved together, each recorded exactly as a single approval (status approved,
 * permission given at that moment, by the member), behind the same permission statement ticked once for the batch, and the
 * same likeness gate per proof. A list can correct a draft's name or wording first (H-1414): the corrections come back with
 * Approve for the drafts still ticked, and what they replaced is kept on the batch. The member's own HelixOS only: refused
 * while a coach is switched in, and no connector tool reaches it. The batch is recorded so Undo the last batch can put every
 * proof of it back to draft, with its old words, for 24 hours.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { ctx, refresh } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { attachmentsBlockApproval } from "@/lib/engine/proof-attachments";
import { applyCorrection, canUndo, matchList, parseCorrections, readListFile, restoreFields, type Correction, type CorrectionRecord } from "@/lib/engine/proof-bank";
import { newId } from "@/lib/ids";
import { attachmentsForProofs } from "@/lib/queries/proof-attachments";

const OWN = { whileSwitched: "refuse", reason: "Approving {first}'s proof is {first}'s own: the permission statement is theirs to tick." } as const;
const ids = (fd: FormData) => [...new Set(fd.getAll("ids").map((v) => String(v).trim()).filter((v) => /^[A-Za-z0-9_-]{1,64}$/.test(v)))];

export async function approveProofsAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx(OWN);
  const back = `/proof?status=${encodeURIComponent(String(formData.get("status") ?? "draft"))}`;
  const picked = ids(formData);
  if (!picked.length) redirect(`${back}&bulkError=${encodeURIComponent("Tick the proofs to approve first.")}`);
  if (formData.get("permission") !== "on") redirect(`${back}&bulkError=${encodeURIComponent("Tick the permission statement for the batch first; nothing was approved.")}`);
  const rows = await db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, userId), inArray(schema.proofs.id, picked)) });
  const drafts = rows.filter((r) => r.status !== "approved");
  const attachments = await attachmentsForProofs(drafts.map((r) => r.id));
  const held = new Set(drafts.filter((r) => attachmentsBlockApproval(attachments.filter((a) => a.proofId === r.id))).map((r) => r.id));
  const approve = drafts.filter((r) => !held.has(r.id)).map((r) => r.id);
  const now = nowIso();
  const corrected: CorrectionRecord[] = [];
  if (approve.length) {
    // The list's corrections first, only on the drafts approved here, remembering what they replaced.
    for (const c of parseCorrections(formData.get("corrections"), new Set(approve))) {
      const row = drafts.find((r) => r.id === c.id);
      const change = row ? applyCorrection(row, c) : null;
      if (!change) continue;
      await db.update(schema.proofs).set(change.set).where(and(eq(schema.proofs.userId, userId), eq(schema.proofs.id, c.id)));
      corrected.push({ id: c.id, before: change.before });
    }
    await db.update(schema.proofs).set({ status: "approved", permissionAt: now, permissionBy: userId }).where(and(eq(schema.proofs.userId, userId), inArray(schema.proofs.id, approve)));
    await db.insert(schema.proofBatches).values({ id: newId(), workspaceId, userId, proofIds: approve, corrections: corrected, approvedAt: now });
  }
  refresh();
  redirect(`${back}&approved=${approve.length}&held=${held.size}${corrected.length ? `&corrected=${corrected.length}` : ""}`);
}

/** Undo the last batch: every proof it approved goes back to draft (the record of the tick is kept) with the words it had, within 24 hours, once. */
export async function undoLastBatchAction(formData: FormData): Promise<void> {
  const { userId } = await ctx(OWN);
  const back = `/proof?status=${encodeURIComponent(String(formData.get("status") ?? "draft"))}`;
  const last = await db.query.proofBatches.findFirst({ where: eq(schema.proofBatches.userId, userId), orderBy: [desc(schema.proofBatches.approvedAt)] });
  if (!canUndo(last, Date.now())) redirect(`${back}&bulkError=${encodeURIComponent("There is no batch to undo within the last 24 hours.")}`);
  const batch = last!;
  if (batch.proofIds.length) await db.update(schema.proofs).set({ status: "draft" }).where(and(eq(schema.proofs.userId, userId), inArray(schema.proofs.id, batch.proofIds), eq(schema.proofs.status, "approved")));
  let restored = 0;
  for (const c of Array.isArray(batch.corrections) ? batch.corrections : []) {
    const fields = restoreFields(c?.before);
    if (typeof c?.id !== "string" || !Object.keys(fields).length) continue;
    await db.update(schema.proofs).set(fields).where(and(eq(schema.proofs.userId, userId), eq(schema.proofs.id, c.id)));
    restored++;
  }
  await db.update(schema.proofBatches).set({ undoneAt: nowIso() }).where(eq(schema.proofBatches.id, batch.id));
  refresh();
  redirect(`${back}&undone=${batch.proofIds.length}${restored ? `&restored=${restored}` : ""}`);
}

export type SelectFromListState = { ids: string[]; matched: number; notFound: number; corrections: Correction[]; error?: string } | null;

/**
 * Select the clean drafts: the list file from the member's computer, read for this one request and never stored, matched
 * to their own drafts by who + date + the first 120 characters of the result. Returns the ids to tick and the corrections
 * the list carries for them; the page ticks them and shows what will be corrected.
 */
export async function selectFromListAction(_prev: SelectFromListState, formData: FormData): Promise<SelectFromListState> {
  const { userId } = await ctx(OWN);
  const none = { ids: [], matched: 0, notFound: 0, corrections: [] };
  const file = formData.get("list");
  if (!(file instanceof File) || !file.size) return { ...none, error: "Choose the list file first." };
  if (file.size > 5_000_000) return { ...none, error: "That file is too big to be the list." };
  const read = readListFile(await file.text());
  if ("error" in read) return { ...none, error: read.error };
  const drafts = await db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, userId), eq(schema.proofs.status, "draft")), columns: { id: true, who: true, resultAfter: true, quote: true, shortVersion: true, sourceRecordedAt: true, createdAt: true } });
  return matchList(drafts, read.entries);
}
