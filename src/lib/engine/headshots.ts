/**
 * Client headshots from Airtable (Danno, 8 Oct): the pure rules. Which field holds what, how a row's email meets a member
 * (trimmed, lower-cased, exactly one member or it goes to the coach's review list; never guessed), what a re-run changes (only
 * a photo whose attachment id changed; a member's own upload or removal always stands), the words of the dry run, the
 * private store's key and the address an attachment may be fetched from. Nothing here reads a file, the network or the database.
 */
export const HEADSHOT_IMPORT = {
  baseId: "appw8wwbqmpZBt1ff",
  tableId: "tblxCBKthZ4EmmV6Y",
  fields: { headshot: "fldFwZgWGRUpvGy2t", name: "fldew4IZxIiKwarHT", email: "fld3PV6STUBAFyfeT" },
} as const;
export const HEADSHOT_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const HEADSHOT_MAX_BYTES = 10 * 1024 * 1024;
/** The display copy: a centred square, this many pixels a side (rule 7). */
export const HEADSHOT_DISPLAY_PX = 512;

export type Attachment = { id: string; url: string; type: string; size: number; filename: string };
export type HeadshotRow = { recordId: string; name: string; email: string | null; attachment: Attachment | null };
export type AirtableRow = { id: string; fields: Record<string, unknown> };

/** An email as the match reads it: trimmed and lower-cased, the first of a lookup's list, or null when there is none. */
export function normEmail(v: unknown): string | null {
  const raw = Array.isArray(v) ? v.find((x) => typeof x === "string") : v;
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
/** The first attachment of a field (rule: use the first one), or null. */
export function firstAttachment(v: unknown): Attachment | null {
  if (!Array.isArray(v) || !v.length) return null;
  const a = v[0] as Record<string, unknown>;
  if (typeof a?.id !== "string" || typeof a.url !== "string") return null;
  return { id: a.id, url: a.url, type: typeof a.type === "string" ? a.type : "", size: typeof a.size === "number" ? a.size : 0, filename: typeof a.filename === "string" ? a.filename : "" };
}
export function parseRow(r: AirtableRow): HeadshotRow {
  const f = HEADSHOT_IMPORT.fields;
  const name = typeof r.fields[f.name] === "string" ? String(r.fields[f.name]).trim() : Array.isArray(r.fields[f.name]) ? String((r.fields[f.name] as unknown[])[0] ?? "").trim() : "";
  return { recordId: r.id, name, email: normEmail(r.fields[f.email]), attachment: firstAttachment(r.fields[f.headshot]) };
}
/** Why an attachment cannot be stored, or null: a type the display copy cannot be made from, or too large. */
export function attachmentProblem(a: Pick<Attachment, "type" | "size">): string | null {
  if (a.type && !(HEADSHOT_MIME as readonly string[]).includes(a.type)) return `a ${a.type} file, not a JPEG, PNG or WebP photo`;
  if (a.size > HEADSHOT_MAX_BYTES) return "larger than 10 MB";
  return null;
}

export type MemberRef = { membershipId: string; email: string; source: "import" | "upload" | "removed" | null; airtableId: string | null };
export type ReviewReason = "no_email" | "no_match" | "shared_email" | "several_members";
export type Plan = {
  /** One member each, and the photo is new or changed: stored on apply. */
  store: { row: HeadshotRow; membershipId: string }[];
  /** One member each, the same attachment as last time. */
  unchanged: { row: HeadshotRow; membershipId: string }[];
  /** One member each, who uploaded or removed their own: their choice stands. */
  kept: { row: HeadshotRow; membershipId: string; why: "upload" | "removed" }[];
  review: { row: HeadshotRow; reason: ReviewReason; candidates: string[] }[];
  noHeadshot: number;
};
/**
 * The plan (rules 3 and 4): a row with no attachment is "no headshot"; one with no email, an email two rows share, an email no
 * member has, or one several members have goes to review with the candidates; exactly one member is matched, then stored,
 * unchanged or kept by the rules above.
 */
export function planImport(rows: readonly HeadshotRow[], members: readonly MemberRef[]): Plan {
  const plan: Plan = { store: [], unchanged: [], kept: [], review: [], noHeadshot: 0 };
  const withPhoto = rows.filter((r) => r.attachment);
  plan.noHeadshot = rows.length - withPhoto.length;
  const seen = new Map<string, number>();
  for (const r of withPhoto) if (r.email) seen.set(r.email, (seen.get(r.email) ?? 0) + 1);
  for (const row of withPhoto) {
    if (!row.email) { plan.review.push({ row, reason: "no_email", candidates: [] }); continue; }
    const owners = members.filter((m) => m.email === row.email);
    if ((seen.get(row.email) ?? 0) > 1) { plan.review.push({ row, reason: "shared_email", candidates: owners.map((m) => m.membershipId) }); continue; }
    if (!owners.length) { plan.review.push({ row, reason: "no_match", candidates: [] }); continue; }
    if (owners.length > 1) { plan.review.push({ row, reason: "several_members", candidates: owners.map((m) => m.membershipId) }); continue; }
    const m = owners[0];
    if (m.source === "upload" || m.source === "removed") plan.kept.push({ row, membershipId: m.membershipId, why: m.source });
    else if (m.airtableId && m.airtableId === row.attachment!.id) plan.unchanged.push({ row, membershipId: m.membershipId });
    else plan.store.push({ row, membershipId: m.membershipId });
  }
  return plan;
}
export const matchedCount = (p: Plan): number => p.store.length + p.unchanged.length + p.kept.length;
/** The dry run's words (rule 4): "X matched, Y need review, Z no headshot", then what apply would do with the matched. */
export function dryRunLine(p: Plan): string {
  const head = `${matchedCount(p)} matched, ${p.review.length} need review, ${p.noHeadshot} no headshot.`;
  const parts = [`${p.store.length} to store`, p.unchanged.length ? `${p.unchanged.length} unchanged` : "", p.kept.length ? `${p.kept.length} keep the client's own choice` : ""].filter(Boolean);
  return `${head} Of the matched: ${parts.join(", ")}.`;
}
export const REASON_WORDS: Record<ReviewReason, string> = { no_email: "No email in Airtable", no_match: "No client with this email", shared_email: "Two Airtable rows share this email", several_members: "Several clients have this email" };

/** The private store's key for a headshot: headshots/<workspace>/<membership id or "review">/<id>.<ext>. */
export const headshotKey = (workspaceId: string, folder: string, id: string, ext: string): string => `headshots/${workspaceId}/${folder}/${id}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg"}`;
const SEG = /^[A-Za-z0-9_-]{1,64}$/;
/** True for a key under the headshots tree, three safe segments and a file name. */
export function headshotKeyOk(key: string): boolean {
  const parts = key.split("/");
  return parts.length === 4 && parts[0] === "headshots" && SEG.test(parts[1]) && SEG.test(parts[2]) && /^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/.test(parts[3]);
}
/** The extension a stored original takes from its type. */
export const extFor = (mime: string): string => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");

/**
 * Where an attachment may be fetched from: Airtable's own attachment hosts over https, or the configured API's origin (the
 * walk's mock). Anything else is refused before a request leaves, so a row can never point the server at another address.
 */
export function attachmentUrlAllowed(url: string, apiBase: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  try { if (u.origin === new URL(apiBase).origin && !/airtable\.com$/.test(new URL(apiBase).hostname)) return true; } catch { /* no base */ }
  if (u.protocol !== "https:") return false;
  return /(^|\.)airtableusercontent\.com$/.test(u.hostname) || u.hostname === "dl.airtable.com" || u.hostname === "v5.airtableusercontent.com";
}
