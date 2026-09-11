/**
 * The one rule of the object store, as pure functions so it can be tested without a database: a public object lives under
 * `public/magnets/<folder>/` and nowhere else, where the folder is the magnet's slug (from its title: a public URL carries no
 * workspace, user or record id); a private attachment lives under `private/attachments/<workspace>/`; a key resolves to a
 * public URL only when it is under the public prefix. A private key never resolves to a public URL, whatever else is recorded
 * about it.
 */
export const PUBLIC_MAGNET_PREFIX = "public/magnets/";
export const PRIVATE_ATTACHMENT_PREFIX = "private/attachments/";

/** A file name safe for a key: letters, digits, dots and dashes, one segment, never a path. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/\.{2,}/g, ".").slice(0, 80);
  return cleaned || "file";
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function publicMagnetKey(folder: string, id: string, name: string): string {
  if (!SEGMENT.test(folder) || !SEGMENT.test(id)) throw new Error("bad key segment");
  return `${PUBLIC_MAGNET_PREFIX}${folder}/${id}-${safeName(name)}`;
}

export function privateAttachmentKey(workspaceId: string, id: string, name: string): string {
  if (!SEGMENT.test(workspaceId) || !SEGMENT.test(id)) throw new Error("bad key segment");
  return `${PRIVATE_ATTACHMENT_PREFIX}${workspaceId}/${id}-${safeName(name)}`;
}

/** Only a key under the public prefix, with no traversal, is public. Everything else is private, including a malformed public-looking key. */
export function keyIsPublic(key: string): boolean {
  if (!key.startsWith(PUBLIC_MAGNET_PREFIX)) return false;
  const rest = key.slice(PUBLIC_MAGNET_PREFIX.length).split("/");
  return rest.length === 2 && rest.every((seg) => SEGMENT.test(seg));
}

/** The app's stable address for a public object, or null for anything that is not public. Never a signed or guessable route for a private key. */
export function publicUrlFor(key: string): string | null {
  return keyIsPublic(key) ? `/files/${key}` : null;
}

/** The folder segment of a public key (the magnet's slug), or null when the key is not public. */
export function publicFolderOf(key: string): string | null {
  return keyIsPublic(key) ? key.slice(PUBLIC_MAGNET_PREFIX.length).split("/")[0] : null;
}

/**
 * The upload cap and the types a magnet file may be. The bytes go from the browser to the bucket, so no serverless body
 * limit applies; the cap is what a lead magnet reasonably is. Every message that names the cap derives it from here.
 */
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"] as const;
export const capLabel = (bytes: number = UPLOAD_MAX_BYTES): string => (bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`);
export const uploadRefusal = (file: { size: number; type: string }): string | null =>
  file.size > UPLOAD_MAX_BYTES ? `That file is over ${capLabel()}. Export it smaller, or link to it from the page instead.` : !(UPLOAD_TYPES as readonly string[]).includes(file.type) ? "That file type can't be served. PDF, PNG, JPEG, plain text, Word or ZIP." : null;
