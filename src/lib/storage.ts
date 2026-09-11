/**
 * The object store. Two writers, on purpose: putPublicMagnet writes only under public/magnets/<slug>/ and marks the
 * object public (the folder is the magnet's slug, so no workspace or user id ever appears in a public URL); putPrivateAttachment writes only under private/attachments/<workspace>/ and never marks it public. Not a flag
 * on one function. The read path serves an object only when its key is under the public prefix AND it was written public.
 * Backed by the database today; swap the four functions for a bucket and the policy in storage-policy.ts stays.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { keyIsPublic, privateAttachmentKey, publicMagnetKey, publicUrlFor } from "@/lib/engine/storage-policy";

export type Stored = { key: string; url: string | null; size: number; contentType: string };

/** A lead magnet file: publicly readable at /files/<key>. The only writer that ever marks an object public. `folder` is the magnet's slug. */
export async function putPublicMagnet(workspaceId: string, folder: string, name: string, bytes: Buffer, contentType: string): Promise<Stored> {
  const key = publicMagnetKey(folder, newId(), name);
  if (!keyIsPublic(key)) throw new Error("refusing to write a public object outside the magnets prefix");
  await db.insert(schema.files).values({ key, workspaceId, contentType, bytes, size: bytes.length, isPublic: true });
  return { key, url: publicUrlFor(key), size: bytes.length, contentType };
}

/** A private attachment (a proof's screenshot, a face, a DM capture). Never public, never at a public URL. */
export async function putPrivateAttachment(workspaceId: string, name: string, bytes: Buffer, contentType: string): Promise<Stored> {
  const key = privateAttachmentKey(workspaceId, newId(), name);
  if (keyIsPublic(key)) throw new Error("a private attachment can never carry a public key");
  await db.insert(schema.files).values({ key, workspaceId, contentType, bytes, size: bytes.length, isPublic: false });
  return { key, url: null, size: bytes.length, contentType };
}

/** The read path for /files: both conditions, the prefix and the recorded flag, or nothing. */
export async function readPublic(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!keyIsPublic(key)) return null;
  const row = await db.query.files.findFirst({ where: eq(schema.files.key, key) });
  if (!row || !row.isPublic) return null;
  return { bytes: Buffer.from(row.bytes), contentType: row.contentType };
}

export async function deleteObject(key: string): Promise<void> {
  await db.delete(schema.files).where(eq(schema.files.key, key));
}
