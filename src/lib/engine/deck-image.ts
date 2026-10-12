/**
 * Deck images, the pure rules. They live in the same PRIVATE store as proof attachments (no new Vercel env var is allowed),
 * under a deck/<workspace>/<user>/ prefix that keeps them apart from proofs and from other coaches. A screenshot or a proof
 * image affirms consent before it can be used; a photo or a logo does not.
 */
import type { DeckImageKind } from "@/db/schema";

/** What may be uploaded: a phone photo can be large (rev 843 item 4). What is kept is at most DECK_IMAGE_STORE_BYTES. */
export const DECK_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
/** Over this, the picture is re-encoded as a JPEG before it is kept, so a deck never carries a 20MB photo. */
export const DECK_IMAGE_STORE_BYTES = 10 * 1024 * 1024;
/** The image types a deck image is kept as; the render reads these back. */
export const DECK_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
/** What may be uploaded: the kept types plus a phone's HEIC/HEIF (the iPhone camera's default), converted to JPEG on record. */
export const DECK_UPLOAD_MIME = [...DECK_IMAGE_MIME, "image/heic", "image/heif"] as const;
/** The file picker's accept list: the types and the HEIC extensions, which some phones report with no type at all. */
export const DECK_IMAGE_ACCEPT = [...DECK_UPLOAD_MIME, ".heic", ".heif"].join(",");
export const deckImageMimeOk = (mime: string): boolean => (DECK_IMAGE_MIME as readonly string[]).includes(mime);
/** The long side a re-encoded picture is kept at: plenty for a 16:9 slide. */
export const DECK_IMAGE_REENCODE_EDGE = 3000;

/** The store key for one deck image, under the coach's own deck folder. */
export const deckImageKey = (workspaceId: string, userId: string, uuid: string, ext: string): string => `deck/${workspaceId}/${userId}/${uuid}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "png"}`;

/** The (workspace, user) a deck key belongs to, or null when it is not a well-formed deck key. */
export function deckKeyOwner(key: string): { workspaceId: string; userId: string } | null {
  const m = key.match(/^deck\/([^/]+)\/([^/]+)\/[^/]+$/);
  return m ? { workspaceId: m[1], userId: m[2] } : null;
}

/** A screenshot or a proof image may show someone: it needs the tick and a name before it is stored. A photo, logo, graphic or diagram does not. */
export const consentRequired = (kind: DeckImageKind): boolean => kind === "screenshot" || kind === "proof";

/** The name stored when a screenshot or proof shows nobody (a logo, a chart, a screen with no one's details on it). */
export const NO_PEOPLE = "No people in this";

/**
 * Whether the consent a kind asks for has been given: a photo, logo, graphic or diagram asks for none; a screenshot or proof
 * takes either the tick with who is in it, or the word that nobody is in it (deck visuals brief §5).
 */
export function consentSatisfied(kind: DeckImageKind, tick: boolean, name: string, noPeople: boolean): boolean {
  if (!consentRequired(kind)) return true;
  if (noPeople) return true;
  return tick && name.trim().length > 0;
}

/** What is stored for consent: nothing for a kind that asks none; the tick with the name, or with "No people in this", and when. */
export function consentRecord(kind: DeckImageKind, name: string, noPeople: boolean, at: string): { consentTick: boolean; consentName: string | null; consentAt: string | null } {
  if (!consentRequired(kind)) return { consentTick: false, consentName: null, consentAt: null };
  return { consentTick: true, consentName: noPeople ? NO_PEOPLE : name.trim(), consentAt: at };
}

export type DeckSniffed = { mime: (typeof DECK_UPLOAD_MIME)[number]; ext: string };
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
const VIDEO_BRANDS = ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "qt  "];

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
  // A phone photo (HEIC/HEIF): ISO base media whose brands name a HEIC brand and no video brand.
  if (b.length >= 16 && ascii(4, 4) === "ftyp") {
    const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0 || 16);
    const brands = [ascii(8, 4)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(i, 4));
    if (brands.some((br) => VIDEO_BRANDS.includes(br))) return null;
    if (brands.some((br) => HEIC_BRANDS.includes(br))) return { mime: "image/heic", ext: "heic" };
  }
  return null;
}

export const DECK_IMAGE_NOT_IMAGE = "That file isn't an image the deck can use. Upload a photo (JPEG or a phone's HEIC), a PNG, WebP or GIF.";
export const deckImageTooBig = () => `That image is over ${Math.round(DECK_IMAGE_MAX_BYTES / (1024 * 1024))}MB. Export it smaller and try again.`;
/** Whether a recorded upload is re-encoded as a JPEG before it is kept: a HEIC always, anything over the kept size. */
export const deckImageNeedsReencode = (mime: string, size: number): boolean => mime === "image/heic" || mime === "image/heif" || size > DECK_IMAGE_STORE_BYTES;

/** Why a deck image is refused, in the coach's words, or the sniffed type. The browser's claim is never consulted. */
export function deckImageRefusal(head: Uint8Array, size: number): { error: string } | { sniffed: DeckSniffed } {
  const sniffed = deckImageSniff(head);
  if (!sniffed) return { error: DECK_IMAGE_NOT_IMAGE };
  if (size > DECK_IMAGE_MAX_BYTES) return { error: deckImageTooBig() };
  return { sniffed };
}
