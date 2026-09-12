/**
 * The PUBLIC object store: Vercel Blob (helixos-blob, created Public), with the database keeping an index (key, url, size,
 * type, public or not), never the bytes. Only lead magnet files live here: putPublicMagnet (and recordPublicMagnet, for a
 * file the browser sent straight to the bucket) write only under public/magnets/<slug>/ and are the only functions that
 * mark an object public. Access is a property of the store, so nothing private can be written here at all: a proof's
 * attachment goes to the private store in src/lib/proof-storage.ts, on that store's own token. The two-writer split now
 * means two stores. A public object's URL is the bucket's CDN address; the read path (/files) resolves a key to its URL
 * only when the prefix and the recorded flag both agree.
 *
 * Configuration: BLOB_READ_WRITE_TOKEN (the public store). Without it the store refuses to write and the pages say so;
 * nothing falls back to the database. VERCEL_BLOB_API_URL points the SDK at scripts/mock-blob.ts for local walks.
 */
import { del, head, put } from "@vercel/blob";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { keyIsPublic, publicMagnetKey } from "@/lib/engine/storage-policy";

export type Stored = { key: string; url: string | null; size: number; contentType: string };

export const storageConfigured = (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
/** What a client sees. The variable's name is for the log and the README, never a screen. */
export const STORAGE_UNCONFIGURED = "File storage isn't set up yet.";

function requireStorage(): void {
  if (!storageConfigured()) {
    console.error("[storage] BLOB_READ_WRITE_TOKEN is not set: a write to the object store was refused");
    throw new Error(STORAGE_UNCONFIGURED);
  }
}

/** A lead magnet file written by the server (the typeset PDF): public, under the magnet's folder. */
export async function putPublicMagnet(workspaceId: string, folder: string, name: string, bytes: Buffer, contentType: string): Promise<Stored> {
  requireStorage();
  const key = publicMagnetKey(folder, newId(), name);
  if (!keyIsPublic(key)) throw new Error("refusing to write a public object outside the magnets prefix");
  const blob = await put(key, bytes, { access: "public", contentType, addRandomSuffix: false });
  await db.insert(schema.files).values({ key, workspaceId, contentType, url: blob.url, size: bytes.length, isPublic: true });
  return { key, url: blob.url, size: bytes.length, contentType };
}

/**
 * A lead magnet file the browser sent straight to the bucket on a token this app issued (src/app/api/magnets/upload). The
 * object is read back from the bucket, never trusted from the browser: its pathname must be the key, under the public
 * prefix, and its size and type are the bucket's. Only then is it recorded, public.
 */
export async function recordPublicMagnet(workspaceId: string, key: string, url: string): Promise<Stored> {
  requireStorage();
  if (!keyIsPublic(key)) throw new Error("refusing to record a public object outside the magnets prefix");
  const blob = await head(url);
  if (blob.pathname !== key) throw new Error("the object at that URL is not the key it claims");
  await db.insert(schema.files).values({ key, workspaceId, contentType: blob.contentType, url: blob.url, size: blob.size, isPublic: true }).onConflictDoUpdate({ target: schema.files.key, set: { url: blob.url, size: blob.size, contentType: blob.contentType } });
  return { key, url: blob.url, size: blob.size, contentType: blob.contentType };
}

/** The public URL of one object: both conditions, the prefix and the recorded flag, or nothing. */
export async function publicUrl(key: string): Promise<string | null> {
  if (!keyIsPublic(key)) return null;
  const row = await db.query.files.findFirst({ where: eq(schema.files.key, key) });
  return row && row.isPublic && row.url ? row.url : null;
}

/** The same for several keys at once, as a resolver the pure engine can take. Keys that are not public are simply absent. */
export async function publicUrls(keys: (string | null | undefined)[]): Promise<(key: string) => string | null> {
  const wanted = keys.filter((k): k is string => Boolean(k) && keyIsPublic(k!));
  const rows = wanted.length ? await db.query.files.findMany({ where: inArray(schema.files.key, wanted) }) : [];
  const map = new Map(rows.filter((r) => r.isPublic && r.url).map((r) => [r.key, r.url]));
  return (key: string) => (keyIsPublic(key) ? (map.get(key) ?? null) : null);
}

export async function deleteObject(key: string): Promise<void> {
  const row = await db.query.files.findFirst({ where: eq(schema.files.key, key) });
  if (row?.url && storageConfigured()) {
    try {
      await del(row.url);
    } catch {
      /* the index row goes regardless; an orphan in the bucket is a cost, a dangling index row is a broken link */
    }
  }
  await db.delete(schema.files).where(eq(schema.files.key, key));
}
