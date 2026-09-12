/**
 * The private object store for proof attachments: a second Vercel Blob store (helixos-proof, created Private), with its own
 * token, PROOF_BLOB_READ_WRITE_TOKEN. Every call in this file passes that token explicitly. Nothing here ever reads the
 * ambient BLOB_READ_WRITE_TOKEN, which the public lead-magnet store owns: an un-tokened write would land a client's face at a
 * URL anyone can open, with no error to catch it. src/lib/engine/__tests__/proof-attachments.test.ts fails if any call here
 * omits the token or if this file names the public token; src/lib/engine/__tests__/lead-magnet.test.ts fails if the SDK is
 * called from anywhere but the two stores' modules and their two doors.
 *
 * Access is a property of the store: every object here is private, its URL is unreachable without the token, and reads go
 * through /api/proofs/attachments/[id], which checks membership in the handler and streams the bytes, never CDN-cached.
 */
import { del, head, list, put } from "@vercel/blob";
import { proofKeyWorkspace } from "@/lib/engine/proof-attachments";

export const PROOF_STORAGE_UNCONFIGURED = "Attachments aren't set up yet. Ask your coach.";
export const proofStorageConfigured = (): boolean => Boolean(process.env.PROOF_BLOB_READ_WRITE_TOKEN);

/** The proof store's token, and only that one. Refuses, loudly, when it is missing: nothing falls back to another store. */
function proofToken(): string {
  const t = process.env.PROOF_BLOB_READ_WRITE_TOKEN;
  if (!t) {
    console.error("[proof-storage] PROOF_BLOB_READ_WRITE_TOKEN is not set: the proof store refused a request");
    throw new Error(PROOF_STORAGE_UNCONFIGURED);
  }
  return t;
}

/** For the browser-upload token route: the proof store's token, explicit, so handleUpload never mints a client token from the public store's. */
export const proofTokenOptions = (): { token: string } => ({ token: proofToken() });

export type ProofObject = { key: string; url: string; size: number; contentType: string };

/** A server-side write (a HEIC's JPEG rendition). Private access, the proof store's token, a key under the proofs tree only. */
export async function putProofObject(key: string, bytes: Buffer, contentType: string): Promise<ProofObject> {
  if (!proofKeyWorkspace(key)) throw new Error("refusing to write a proof object outside the proofs tree");
  const blob = await put(key, bytes, { access: "private", token: proofToken(), contentType, addRandomSuffix: false });
  return { key, url: blob.url, size: bytes.length, contentType };
}

/** What the store says about an object, from the store, by its pathname: size, type and URL, never the browser's claim. */
export async function headProofObject(key: string): Promise<ProofObject> {
  const blob = await head(key, { token: proofToken() });
  return { key: blob.pathname, url: blob.url, size: blob.size, contentType: blob.contentType };
}

/** Every object under a prefix in the proof store, for reconciling the store against the rows. */
export async function listProofObjects(prefix: string, abortSignal?: AbortSignal): Promise<{ key: string; url: string; size: number; uploadedAt: Date }[]> {
  const out: { key: string; url: string; size: number; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000, token: proofToken(), abortSignal });
    for (const b of page.blobs) out.push({ key: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Deletes the object. Throws when the store refuses, so the caller keeps the row: nothing goes missing from the client's view while the file is still live. */
export async function deleteProofObject(url: string, abortSignal?: AbortSignal): Promise<void> {
  await del(url, { token: proofToken(), abortSignal });
}

/**
 * Streams a private object, with the token, honouring a Range request so video seeks. The SDK's get() insists on a
 * *.blob.vercel-storage.com hostname, which the local mock cannot have; this is the same authenticated request it makes.
 */
export async function readProofObject(url: string, range?: string | null): Promise<Response> {
  return fetch(url, { headers: { authorization: `Bearer ${proofToken()}`, ...(range ? { range } : {}) }, cache: "no-store" });
}
