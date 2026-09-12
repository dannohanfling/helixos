/**
 * Proof attachments: the rules for a file that hangs off a proof, as pure functions. A proof is a claim plus evidence; an
 * attachment is a third kind of evidence on the same row (beside the verbatim quote and the Fathom deep link). What lives
 * here: what a file may be (sniffed, never trusted from the browser), how big, how many, the two questions asked at upload
 * and the consent sentence they trigger, the approval gate they extend, the workspace quota, and the key shape in the
 * private store. Every number is configuration and every message derives from it.
 */
import type { ProofAttachmentKind } from "@/db/schema";

/* ───────────── Limits (configuration) ───────────── */

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Video: the brief wrote 200 MB before the plan's transfer figures were known; a private object is streamed through an
 * authenticated route on every view with no CDN cache, so a single 200 MB file viewed twenty times is 4% of the monthly
 * allowance from one proof. The brief's own later preference is 100 MB, and Vercel advises against serving files over
 * 100 MB through a private store. One number to change.
 */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const MAX_PER_PROOF = 10;
export const WORKSPACE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
export const QUOTA_WARN_AT = 0.8;

export const KIND_MAX: Record<ProofAttachmentKind, number> = { image: IMAGE_MAX_BYTES, video: VIDEO_MAX_BYTES, document: DOCUMENT_MAX_BYTES };

export function mb(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(bytes % (1024 * 1024 * 1024) ? 1 : 0)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/* ───────────── What a file is: sniffed from its bytes ───────────── */

export type Sniffed = { kind: ProofAttachmentKind; mime: string; ext: string; heic: boolean };

/** The types a proof may carry, by what the bytes say. Anything else, including SVG and anything that reads as markup, is refused. */
export const ACCEPTED: { kind: ProofAttachmentKind; mime: string; ext: string; label: string }[] = [
  { kind: "image", mime: "image/jpeg", ext: "jpg", label: "JPEG" },
  { kind: "image", mime: "image/png", ext: "png", label: "PNG" },
  { kind: "image", mime: "image/webp", ext: "webp", label: "WebP" },
  { kind: "image", mime: "image/heic", ext: "heic", label: "HEIC" },
  { kind: "video", mime: "video/mp4", ext: "mp4", label: "MP4" },
  { kind: "video", mime: "video/quicktime", ext: "mov", label: "MOV" },
  { kind: "video", mime: "video/webm", ext: "webm", label: "WebM" },
  { kind: "document", mime: "application/pdf", ext: "pdf", label: "PDF" },
];

/** What the file input accepts, from the same list, plus the HEIF spelling phones use. */
export const ACCEPT_ATTRIBUTE = [...new Set(ACCEPTED.map((a) => a.mime)), "image/heif", ".heic", ".heif"].join(",");

const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
const MP4_BRANDS = ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "m4v ", "M4V "];

/** The kind, type and extension a file actually is, from its first bytes. Null when it is nothing a proof may carry. */
export function sniff(head: Uint8Array): Sniffed | null {
  const b = head;
  const ascii = (from: number, len: number) => Array.from(b.subarray(from, from + len)).map((c) => String.fromCharCode(c)).join("");
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: "image/jpeg", ext: "jpg", heic: false };
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { kind: "image", mime: "image/png", ext: "png", heic: false };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return { kind: "image", mime: "image/webp", ext: "webp", heic: false };
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return { kind: "document", mime: "application/pdf", ext: "pdf", heic: false };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "video", mime: "video/webm", ext: "webm", heic: false };
  // ISO base media: [size][ftyp][major brand][minor version][compatible brands...]. HEIC, MP4 and MOV all live here; the major
  // brand and the compatible brands decide, the minor-version bytes are skipped, and the box's own size bounds the scan. A
  // file that names both a video brand and a HEIC brand is a video: a HEIC never claims to be an MP4.
  if (b.length >= 16 && ascii(4, 4) === "ftyp") {
    const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    const end = Math.min(b.length, size >= 16 && size <= b.length ? size : Math.min(b.length, 64));
    const brands: string[] = [ascii(8, 4)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(i, 4));
    if (brands.some((br) => br === "qt  ")) return { kind: "video", mime: "video/quicktime", ext: "mov", heic: false };
    if (brands.some((br) => MP4_BRANDS.includes(br))) return { kind: "video", mime: "video/mp4", ext: "mp4", heic: false };
    if (brands.some((br) => HEIC_BRANDS.includes(br))) return { kind: "image", mime: "image/heic", ext: "heic", heic: true };
  }
  return null;
}

/** True for anything that reads as markup: an SVG, an HTML page, or either disguised under an image name. Refused outright. */
export function looksLikeMarkup(head: Uint8Array): boolean {
  const text = Array.from(head.subarray(0, 256)).map((c) => String.fromCharCode(c)).join("").replace(/^﻿/, "").trimStart();
  return /^<(\?xml|!doctype|svg|html|script)/i.test(text) || /<svg[\s>]/i.test(text);
}

/** Why a file is refused, in the client's words, or null. Sniffing first, then the kind's cap: the browser's name and type are never consulted. */
export function refusal(head: Uint8Array, size: number): { error: string } | { sniffed: Sniffed } {
  if (looksLikeMarkup(head)) return { error: "That file is a web page or a vector graphic, which a proof can't carry. Use a photo, a screenshot, a video or a PDF." };
  const sniffed = sniff(head);
  if (!sniffed) return { error: `That file type can't be attached. Use one of: ${ACCEPTED.map((a) => a.label).join(", ")}.` };
  const max = KIND_MAX[sniffed.kind];
  if (size > max) return { error: `That ${sniffed.kind} is over ${mb(max)}. Export it smaller and try again.` };
  return { sniffed };
}

/* ───────────── The two questions, the tick, and the consent sentence ───────────── */

export const RESULT_QUESTION = "Does this show a result — money, weight, followers, or any number someone could read as a promise?";
export const PERSON_QUESTION = "Is an identifiable person in this file?";
export const OWN_SCREEN_TICK = "This is my own screen. Any other person's name, email or photo in it has been removed, or I have their permission.";

/** The likeness sentence, with the app substituting the noun. Verbatim for a photo and a video; a document says what it is. */
export function likenessSentence(name: string, kind: ProofAttachmentKind): string {
  const noun = kind === "video" ? "video" : kind === "document" ? "document" : "photo";
  return `${name.trim() || "[Name]"} has given me permission to use this ${noun} of them in my marketing.`;
}

/** A file's own name, kept as the client knows it minus anything that is a path or a control character, and bounded. */
export function cleanFilename(raw: string, fallback: string): string {
  const name = raw
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(0, 200);
  return name || fallback;
}
/** The same name for an HTTP header, which takes bytes only: an ASCII fallback beside the RFC 5987 form. */
export function contentDisposition(name: string, download: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** What the record action accepts from the browser, checked at the boundary rather than trusted as a type. */
export type RecordInput = { proofId: string; key: string; originalFilename: string; showsAResult: boolean; showsAPerson: boolean; ownScreen: boolean; consentName: string; consentTick: boolean; altText: string; width: number | null; height: number | null; durationSeconds: number | null };
export function parseRecordInput(raw: unknown): RecordInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string, max: number) => (typeof r[k] === "string" ? (r[k] as string).slice(0, max) : null);
  const bool = (k: string) => (typeof r[k] === "boolean" ? (r[k] as boolean) : null);
  const num = (k: string, max: number) => (r[k] == null ? null : typeof r[k] === "number" && Number.isFinite(r[k]) && (r[k] as number) > 0 && (r[k] as number) <= max ? (r[k] as number) : null);
  const proofId = str("proofId", 100);
  const key = str("key", 400);
  const originalFilename = str("originalFilename", 400);
  const showsAResult = bool("showsAResult");
  const showsAPerson = bool("showsAPerson");
  const ownScreen = bool("ownScreen");
  const consentTick = bool("consentTick");
  if (proofId === null || key === null || originalFilename === null || showsAResult === null || showsAPerson === null || ownScreen === null || consentTick === null) return null;
  return { proofId, key, originalFilename, showsAResult, showsAPerson, ownScreen, consentTick, consentName: str("consentName", 120) ?? "", altText: str("altText", 500) ?? "", width: num("width", 16384), height: num("height", 16384), durationSeconds: num("durationSeconds", 86400) };
}

/** Whether the own-screen tick applies: images and documents, where another person's data can sit in the pixels. A video is a likeness question, not a screen. */
export const needsOwnScreenTick = (kind: ProofAttachmentKind): boolean => kind !== "video";

/* ───────────── The approval gate, extended ───────────── */

export type AttachmentConsent = { showsAPerson: boolean; consentRecordedAt: string | null; consentName: string | null };

/** An attachment with an identifiable person needs the likeness consent recorded, with a name. Anything else is answered. */
export function consentAnswered(a: AttachmentConsent): boolean {
  return !a.showsAPerson || Boolean(a.consentRecordedAt && (a.consentName ?? "").trim());
}

/** The same gate the proof already has, extended: a proof cannot move to approved while any attachment's consent question is unanswered. */
export function attachmentsBlockApproval(attachments: AttachmentConsent[]): string | null {
  const open = attachments.filter((a) => !consentAnswered(a)).length;
  if (!open) return null;
  return open === 1 ? "One attachment shows a person and has no permission recorded yet." : `${open} attachments show a person and have no permission recorded yet.`;
}

/* ───────────── Quota ───────────── */

export type QuotaState = { used: number; limit: number; fraction: number; warn: boolean; blocked: boolean; line: string };

export function quotaState(usedBytes: number, limit = WORKSPACE_QUOTA_BYTES): QuotaState {
  const fraction = limit > 0 ? usedBytes / limit : 1;
  const blocked = usedBytes >= limit;
  const warn = !blocked && fraction >= QUOTA_WARN_AT;
  const line = blocked
    ? `Storage is full: ${mb(usedBytes)} of ${mb(limit)} used. Delete an attachment you no longer need before adding another.`
    : warn
      ? `Storage is ${Math.round(fraction * 100)}% used: ${mb(usedBytes)} of ${mb(limit)}.`
      : `${mb(usedBytes)} of ${mb(limit)} used.`;
  return { used: usedBytes, limit, fraction: Math.min(1, fraction), warn, blocked, line };
}

/** Whether one more file of `size` fits: the quota and the per-proof count, each with its own sentence. */
export function admission(used: number, size: number, countOnProof: number, limit = WORKSPACE_QUOTA_BYTES): string | null {
  if (countOnProof >= MAX_PER_PROOF) return `A proof carries up to ${MAX_PER_PROOF} attachments. More than that is an album, not evidence.`;
  if (used + size > limit) return `That file would take storage past ${mb(limit)} (${mb(used)} used). Delete an attachment you no longer need before adding it.`;
  return null;
}

/* ───────────── Keys in the private store ───────────── */

export const PROOF_KEY_PREFIX = "proofs/";
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** proofs/<workspace_id>/<proof_id>/<uuid>.<ext>: a client's own tree, and nothing about the file's name or the person in it. */
export function proofKey(workspaceId: string, proofId: string, id: string, ext: string): string {
  if (![workspaceId, proofId, id].every((s) => SEGMENT.test(s)) || !/^[a-z0-9]+$/.test(ext)) throw new Error("bad key segment");
  return `${PROOF_KEY_PREFIX}${workspaceId}/${proofId}/${id}.${ext}`;
}
/** The sibling a HEIC's JPEG rendition lives at: same tree, the original kept beside it. */
export const displayKeyFor = (key: string): string => key.replace(/\.[a-z0-9]+$/, "-display.jpg");

/** A key is a proof's only when it sits under the prefix with exactly three safe segments. The workspace is the second. */
export function proofKeyWorkspace(key: string): string | null {
  if (!key.startsWith(PROOF_KEY_PREFIX)) return null;
  const rest = key.slice(PROOF_KEY_PREFIX.length).split("/");
  if (rest.length !== 3 || !rest.every((s) => SEGMENT.test(s))) return null;
  return rest[0];
}

/** Ordering: the first attachment is the thumbnail; moving one first is the whole feature. */
export function moveFirst<T extends { id: string }>(items: T[], id: string): T[] {
  const i = items.findIndex((x) => x.id === id);
  if (i <= 0) return items;
  return [items[i], ...items.slice(0, i), ...items.slice(i + 1)];
}
