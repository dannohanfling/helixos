/**
 * An Office Hours request's optional screenshot (H-1706), after the request itself is saved: a new picture is stored under
 * ooh/<workspace>/<request>-<tag>.<ext> and the old one deleted, or the picture is removed, or nothing changes. The checks
 * (size, and what the bytes are) run before the request is saved, in checkScreenshot; this only stores and tidies. When the
 * store isn't set up or refuses, the request keeps its text and the page says the picture wasn't kept.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { deleteProofObject, proofStorageConfigured, putOohObject } from "@/lib/proof-storage";

export const oohScreenshotKey = (workspaceId: string, requestId: string, tag: string, ext: string) => `ooh/${workspaceId}/${requestId}-${tag}.${ext}`;

export type OohShotChange = { kind: "none" } | { kind: "remove" } | { kind: "new"; bytes: Buffer; mime: string; ext: string };
export type OohShotOutcome = "unchanged" | "kept" | "removed" | "not-stored";

/** The store, swappable in tests. */
export type OohShotStore = { configured: () => boolean; put: typeof putOohObject; del: (url: string) => Promise<void> };
const realStore: OohShotStore = { configured: proofStorageConfigured, put: putOohObject, del: (url) => deleteProofObject(url) };

export async function applyOohScreenshot(workspaceId: string, requestId: string, change: OohShotChange, store: OohShotStore = realStore): Promise<OohShotOutcome> {
  if (change.kind === "none") return "unchanged";
  const where = and(eq(schema.officeHoursRequests.id, requestId), eq(schema.officeHoursRequests.workspaceId, workspaceId));
  const old = await db.query.officeHoursRequests.findFirst({ where, columns: { screenshotUrl: true } });
  if (!old) return "unchanged";
  let next: { key: string; url: string; type: string } | null = null;
  if (change.kind === "new") {
    if (!store.configured()) return "not-stored";
    try {
      const o = await store.put(oohScreenshotKey(workspaceId, requestId, newId().slice(0, 8).toLowerCase(), change.ext), change.bytes, change.mime);
      next = { key: o.key, url: o.url, type: change.mime };
    } catch (e) {
      // Causes only: never the address, the member or their words.
      console.error("[ooh] screenshot not stored", JSON.stringify({ cause: e instanceof Error ? e.name : "unknown" }));
      return "not-stored";
    }
  }
  await db.update(schema.officeHoursRequests).set({ screenshotKey: next?.key ?? null, screenshotUrl: next?.url ?? null, screenshotType: next?.type ?? null }).where(where);
  // The old picture goes once the row no longer points at it; a store that refuses leaves a stray object, never a broken row.
  if (old.screenshotUrl && old.screenshotUrl !== next?.url) {
    await store.del(old.screenshotUrl).catch((e) => console.error("[ooh] old screenshot not deleted", JSON.stringify({ cause: e instanceof Error ? e.name : "unknown" })));
  }
  return next ? "kept" : "removed";
}
