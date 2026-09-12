import { and, eq, inArray, sum } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteProofObject, listProofObjects, proofStorageConfigured } from "@/lib/proof-storage";
import { admission, quotaState } from "@/lib/engine/proof-attachments";
import { redactUrls } from "@/lib/engine/storage-policy";

export async function attachmentsFor(proofId: string) {
  return db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, proofId), orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)] });
}

/** The attachments of several proofs, in one query scoped to those proofs and nothing else. */
export async function attachmentsForProofs(proofIds: string[]) {
  if (!proofIds.length) return [];
  return db.query.proofAttachments.findMany({ where: inArray(schema.proofAttachments.proofId, proofIds), orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)] });
}

/** Every byte the workspace holds in the private store: originals and, for HEICs, their renditions. */
export async function usedBytes(workspaceId: string): Promise<number> {
  const r = await db.select({ total: sum(schema.proofAttachments.bytes), renditions: sum(schema.proofAttachments.displayBytes) }).from(schema.proofAttachments).where(eq(schema.proofAttachments.workspaceId, workspaceId));
  return Number(r[0]?.total ?? 0) + Number(r[0]?.renditions ?? 0);
}

/** The workspace's storage against its quota: what Settings shows and what the upload door checks. */
export async function storageQuota(workspaceId: string) {
  return quotaState(await usedBytes(workspaceId));
}

/** Whether one more file of `size` fits this proof and this workspace, in the client's words, or null. */
export async function admissionFor(workspaceId: string, proofId: string, size: number): Promise<string | null> {
  const [count, used] = await Promise.all([db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.proofId, proofId), columns: { id: true } }), usedBytes(workspaceId)]);
  return admission(used, size, count.length);
}

/** A post that had picked a deleted file forgets it, rather than carrying an id that resolves to nothing. */
export async function forgetAttachmentOnPosts(attachmentIds: string[]): Promise<void> {
  if (!attachmentIds.length) return;
  await db.update(schema.contentItems).set({ mediaAttachmentId: null }).where(inArray(schema.contentItems.mediaAttachmentId, attachmentIds));
}

/**
 * Every attachment of a proof, gone from the store before the rows go: the object first (a HEIC's rendition too), then the
 * row, one at a time. The first refusal stops the run and throws, so the proof itself is not deleted while a file is live.
 * Scoped by the proof's own workspace, not the session's.
 */
export async function deleteAttachmentsForProof(proofId: string, workspaceId: string): Promise<void> {
  const rows = await db.query.proofAttachments.findMany({ where: and(eq(schema.proofAttachments.proofId, proofId), eq(schema.proofAttachments.workspaceId, workspaceId)) });
  for (const att of rows) {
    await deleteProofObject(att.blobUrl);
    if (att.displayUrl) await deleteProofObject(att.displayUrl);
    await forgetAttachmentOnPosts([att.id]);
    await db.delete(schema.proofAttachments).where(eq(schema.proofAttachments.id, att.id));
  }
}

const ORPHAN_AGE_MS = 30 * 60 * 1000;
/** The whole reconcile, list and deletes, gives up after this: the SDK retries a down store for many minutes on its own, and a page never waits on it. */
const RECONCILE_BUDGET_MS = 20 * 1000;

/**
 * Reconciles the workspace's whole tree in the store against its rows: an object with no row that is older than half an hour
 * was uploaded and never recorded (the tab closed, the record call failed, the request crashed) and is deleted. An orphan is
 * a file nobody consented to and bytes no quota counts, so the reconcile is workspace-wide and runs where the workspace's
 * storage figure is computed (Settings), not per proof at upload time: a proof that is never uploaded to again would keep
 * its orphan forever. One list per visit. Never touches an object a row points at, and never an object younger than the
 * floor, which may be an upload still being recorded. Called from after(), so the page is sent first, and bounded in time.
 */
export async function reapOrphans(workspaceId: string, now = new Date()): Promise<number> {
  // One line per run, including the empty ones: an empty run is what says the reconcile is running at all, and a run that
  // hit its budget or could not list is an operational fact that is invisible from inside after() unless it is written down.
  const started = Date.now();
  const report = { workspaceId, outcome: "ok" as "ok" | "skipped" | "list-failed" | "budget-hit", objects: 0, rows: 0, deleted: 0, bytes: 0, deleteFailures: 0, ms: 0 };
  const line = () => {
    report.ms = Date.now() - started;
    (report.outcome === "ok" || report.outcome === "skipped" ? console.log : console.error)(`[proof-storage] reconcile ${report.outcome}`, JSON.stringify(report));
    return report.deleted;
  };
  if (!proofStorageConfigured()) {
    report.outcome = "skipped";
    return line();
  }
  const budget = AbortSignal.timeout(RECONCILE_BUDGET_MS);
  let objects: Awaited<ReturnType<typeof listProofObjects>>;
  try {
    objects = await listProofObjects(`proofs/${workspaceId}/`, budget);
  } catch (e) {
    report.outcome = budget.aborted ? "budget-hit" : "list-failed";
    console.error("[proof-storage] could not list a workspace's tree to reconcile it", redactUrls(JSON.stringify({ workspaceId, message: e instanceof Error ? e.message : String(e) })));
    return line();
  }
  report.objects = objects.length;
  const rows = await db.query.proofAttachments.findMany({ where: eq(schema.proofAttachments.workspaceId, workspaceId), columns: { blobKey: true, displayKey: true } });
  report.rows = rows.length;
  const known = new Set(rows.flatMap((r) => [r.blobKey, r.displayKey].filter((k): k is string => Boolean(k))));
  for (const o of objects) {
    if (known.has(o.key) || now.getTime() - o.uploadedAt.getTime() < ORPHAN_AGE_MS) continue;
    if (budget.aborted) {
      report.outcome = "budget-hit";
      break;
    }
    try {
      await deleteProofObject(o.url, budget);
      report.deleted++;
      report.bytes += o.size;
    } catch (e) {
      if (budget.aborted) report.outcome = "budget-hit";
      report.deleteFailures++;
      console.error("[proof-storage] could not delete an orphaned object", redactUrls(JSON.stringify({ key: o.key, message: e instanceof Error ? e.message : String(e) })));
    }
  }
  return line();
}
