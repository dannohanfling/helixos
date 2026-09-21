/**
 * Deck images, the pure rules. They live in the same PRIVATE store as proof attachments (no new Vercel env var is allowed),
 * under a deck/<workspace>/<user>/ prefix that keeps them apart from proofs and from other coaches. A screenshot or a proof
 * image affirms consent before it can be used; a photo or a logo does not.
 */
import type { DeckImageKind } from "@/db/schema";

export const DECK_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** The image types a deck image may be, browser-side; the bytes are the store's to hold and the render reads them back. */
export const DECK_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const deckImageMimeOk = (mime: string): boolean => (DECK_IMAGE_MIME as readonly string[]).includes(mime);

/** The store key for one deck image, under the coach's own deck folder. */
export const deckImageKey = (workspaceId: string, userId: string, uuid: string, ext: string): string => `deck/${workspaceId}/${userId}/${uuid}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "png"}`;

/** The (workspace, user) a deck key belongs to, or null when it is not a well-formed deck key. */
export function deckKeyOwner(key: string): { workspaceId: string; userId: string } | null {
  const m = key.match(/^deck\/([^/]+)\/([^/]+)\/[^/]+$/);
  return m ? { workspaceId: m[1], userId: m[2] } : null;
}

/** A screenshot or a proof image may show someone: it needs the tick and a name before it is stored. A photo or logo does not. */
export const consentRequired = (kind: DeckImageKind): boolean => kind === "screenshot" || kind === "proof";

export type DeckSniffed = { mime: (typeof DECK_IMAGE_MIME)[number]; ext: string };

/**
 * What a deck image's first bytes actually are, or null. The browser's name and type are never trusted: a .png that reads as
 * HTML or a vector graphic is refused, and only the four raster image types the deck can render are accepted. Sniffing is done
 * here so the record path and any test agree on one truth.
 */
export function deckImageSniff(head: Uint8Array): DeckSniffed | null {
  const b = head;
  const ascii = (from: number, len: number) => Array.from(b.subarray(from, from + len)).map((c) => String.fromCharCode(c)).join("");
  // A web page or a vector graphic disguised under an image name is refused outright, the way the proof store refuses it.
  const text = ascii(0, 256).replace(/^﻿/, "").trimStart();
  if (/^<(\?xml|!doctype|svg|html|script)/i.test(text) || /<svg[\s>]/i.test(text)) return null;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: "image/png", ext: "png" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return { mime: "image/gif", ext: "gif" };
  return null;
}

/** Why a deck image is refused, in the coach's words, or the sniffed type. The browser's claim is never consulted. */
export function deckImageRefusal(head: Uint8Array, size: number): { error: string } | { sniffed: DeckSniffed } {
  const sniffed = deckImageSniff(head);
  if (!sniffed) return { error: "That file isn't an image the deck can use. Upload a PNG, JPEG, WebP or GIF." };
  if (size > DECK_IMAGE_MAX_BYTES) return { error: `That image is over ${Math.round(DECK_IMAGE_MAX_BYTES / (1024 * 1024))}MB. Export it smaller and try again.` };
  return { sniffed };
}
