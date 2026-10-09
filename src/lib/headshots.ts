import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { db, schema } from "@/db";
import type { Membership } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { HEADSHOT_DISPLAY_PX, HEADSHOT_MAX_BYTES, HEADSHOT_MIME, extFor, headshotKey } from "@/lib/engine/headshots";
import { deleteProofObject, putHeadshotObject, readProofObject } from "@/lib/proof-storage";

/**
 * Client headshots, the stored side (Danno, 8 Oct): the original and a 512 square display copy in the private proof store,
 * set on the membership with who set it; read back only here and through /api/headshots. A member's own upload always wins
 * over the import, and a removal stays removed. Nothing here makes a public address.
 */
export type Stored = { url: string; displayUrl: string; mime: string };
export const hasHeadshot = (m: Pick<Membership, "headshotDisplayUrl">): boolean => Boolean(m.headshotDisplayUrl);

/** What a photo really is, from its bytes: one of the three types the display copy is made from, or null. */
export async function sniffPhoto(bytes: Buffer): Promise<{ mime: (typeof HEADSHOT_MIME)[number]; width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes, { animated: false }).metadata();
    const mime = meta.format === "jpeg" ? "image/jpeg" : meta.format === "png" ? "image/png" : meta.format === "webp" ? "image/webp" : null;
    return mime && meta.width && meta.height ? { mime, width: meta.width, height: meta.height } : null;
  } catch {
    return null;
  }
}

/** Stores the original as it came and the display copy (rule 7: a centred square, 512 px), under one folder of the workspace. */
export async function storeHeadshot(workspaceId: string, folder: string, bytes: Buffer): Promise<Stored | { error: string }> {
  if (bytes.length > HEADSHOT_MAX_BYTES) return { error: "That photo is larger than 10 MB." };
  const kind = await sniffPhoto(bytes);
  if (!kind) return { error: "That file isn't a JPEG, PNG or WebP photo." };
  const id = newId();
  const display = await sharp(bytes, { animated: false }).rotate().resize({ width: HEADSHOT_DISPLAY_PX, height: HEADSHOT_DISPLAY_PX, fit: "cover", position: "centre" }).jpeg({ quality: 86 }).toBuffer();
  const original = await putHeadshotObject(headshotKey(workspaceId, folder, id, extFor(kind.mime)), bytes, kind.mime);
  const square = await putHeadshotObject(headshotKey(workspaceId, folder, `${id}-512`, "jpg"), display, "image/jpeg");
  return { url: original.url, displayUrl: square.url, mime: kind.mime };
}

/** The objects behind a membership's photo go; a refusal from the store is logged and left for the next sweep, never thrown. */
async function dropObjects(urls: (string | null | undefined)[], keep: Set<string> = new Set()): Promise<void> {
  for (const u of urls) {
    if (!u || keep.has(u)) continue;
    try { await deleteProofObject(u); } catch (e) { console.error("[headshots] delete refused", JSON.stringify({ message: e instanceof Error ? e.message.slice(0, 200) : String(e) })); }
  }
}

/** Sets a member's photo and drops the one it replaces (unless another record still points at it). */
export async function setMemberHeadshot(m: Membership, stored: Stored, source: "import" | "upload", airtableId: string | null): Promise<void> {
  await db.update(schema.memberships).set({ headshotUrl: stored.url, headshotDisplayUrl: stored.displayUrl, headshotMime: stored.mime, headshotSource: source, headshotAirtableId: airtableId, headshotUpdatedAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  await dropObjects([m.headshotUrl, m.headshotDisplayUrl], new Set([stored.url, stored.displayUrl]));
}
/** The member removes their own: both objects go, and the import never puts it back. */
export async function removeMemberHeadshot(m: Membership): Promise<void> {
  await db.update(schema.memberships).set({ headshotUrl: null, headshotDisplayUrl: null, headshotMime: null, headshotSource: "removed", headshotUpdatedAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  await dropObjects([m.headshotUrl, m.headshotDisplayUrl]);
}
/** A review row's objects go when the coach dismisses it. */
export async function dropReviewObjects(r: Pick<schema.HeadshotReview, "photoUrl" | "displayUrl">): Promise<void> {
  await dropObjects([r.photoUrl, r.displayUrl]);
}

/** The bytes of a stored photo, from the private store; null when it is gone. */
export async function readStored(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null;
  const res = await readProofObject(url);
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}
/** A member's display copy, for the ladder graphic's badge when the member said yes to it. */
export async function memberHeadshotBytes(workspaceId: string, userId: string): Promise<Buffer | null> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)), columns: { headshotDisplayUrl: true } });
  return readStored(m?.headshotDisplayUrl);
}
