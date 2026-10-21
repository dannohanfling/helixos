/**
 * The Proof Bank list (H-1393, H-1394): the status views and their counts, the page size, the clean-list match, and the
 * undo window of a batch. Pure; the page and the actions read these.
 */
import { attribution, autoTrim } from "@/lib/engine/fathom";

export const PROOF_VIEWS = ["all", "draft", "permission", "approved"] as const;
export type ProofView = (typeof PROOF_VIEWS)[number];
export const VIEW_LABEL: Record<ProofView, string> = { all: "All", draft: "Draft", permission: "Permission given", approved: "Approved" };
/** Rows shown at once; "Show 250 more" adds another page. The counts and the filters still see the whole bank. */
export const PROOF_PAGE = 250;
/** How long "Undo the last batch" stays open after Approve selected. */
export const BATCH_UNDO_HOURS = 24;

export type ProofLike = { status: string; permissionAt: string | null };
/** Draft, a draft whose permission tick is already recorded, or approved. */
export function viewOf(p: ProofLike): Exclude<ProofView, "all"> {
  if (p.status === "approved") return "approved";
  return p.permissionAt ? "permission" : "draft";
}
export const isView = (s: string | undefined): s is ProofView => (PROOF_VIEWS as readonly string[]).includes(s ?? "");
export function viewCounts(rows: ProofLike[]): Record<ProofView, number> {
  const c: Record<ProofView, number> = { all: rows.length, draft: 0, permission: 0, approved: 0 };
  for (const r of rows) c[viewOf(r)]++;
  return c;
}
export function inView(p: ProofLike, view: ProofView): boolean {
  return view === "all" || viewOf(p) === view;
}
/** The rows a page shows: the first `show`, rounded to whole pages. */
export function pageOf<T>(rows: T[], show: number | undefined): { rows: T[]; shown: number; more: number } {
  const n = Math.max(PROOF_PAGE, Math.ceil((show ?? PROOF_PAGE) / PROOF_PAGE) * PROOF_PAGE);
  return { rows: rows.slice(0, n), shown: Math.min(n, rows.length), more: Math.max(0, rows.length - n) };
}

/* ───────────── The list file (H-1394, H-1414, H-1415) ───────────── */

export type ListEntry = { who?: unknown; date?: unknown; result_starts?: unknown; correct_who?: unknown; corrected_quote?: unknown };
export type ListFile = { approve_clean?: unknown; approve_after_transcript_check?: unknown; keep_as_draft?: unknown };
/** One row of the list: the match key (lower-cased), and the corrected name or quote when the transcript check set one. */
export type Entry = { who: string; date: string; result: string; correctWho?: string | null; correctedQuote?: string | null };
export type MatchRow = { id: string; who: string | null; resultAfter: string | null; quote: string | null; shortVersion: string | null; sourceRecordedAt: string | null; createdAt: string };
/** A matched draft's correction, as the page carries it from the list step to Approve: the new name and/or quote. */
export type Correction = { id: string; who: string | null; quote: string | null };
const norm = (s: unknown): string => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const RESULT_CHARS = 120;
export const WHO_CHARS = 200;
export const QUOTE_CHARS = 5000;
const kept = (s: unknown, max: number): string | null => {
  const t = typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
  return t ? t.slice(0, max) : null;
};

/**
 * Read the list file: its approve_clean rows and its approve_after_transcript_check rows (those first, so a draft in both
 * lists takes its corrected values, H-1415), or why it can't be read. Nothing else in the file is kept.
 */
export function readListFile(text: string): { entries: Entry[] } | { error: string } {
  let j: ListFile;
  try {
    j = JSON.parse(text) as ListFile;
  } catch {
    return { error: "That isn't a JSON file." };
  }
  if (!j || typeof j !== "object" || (!Array.isArray(j.approve_clean) && !Array.isArray(j.approve_after_transcript_check))) return { error: 'The file has no "approve_clean" list.' };
  const checked = Array.isArray(j.approve_after_transcript_check) ? (j.approve_after_transcript_check as ListEntry[]) : [];
  const clean = Array.isArray(j.approve_clean) ? (j.approve_clean as ListEntry[]) : [];
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const [list, corrected] of [[checked, true], [clean, false]] as const) {
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      const who = norm(e.who);
      const result = norm(e.result_starts).slice(0, RESULT_CHARS);
      const date = String(e.date ?? "").trim().slice(0, 10);
      const key = `${who}\n${date}\n${result}`;
      if (!who || !result || seen.has(key)) continue;
      seen.add(key);
      entries.push({ who, date, result, correctWho: corrected ? kept(e.correct_who, WHO_CHARS) : null, correctedQuote: corrected ? kept(e.corrected_quote, QUOTE_CHARS) : null });
    }
  }
  if (!entries.length) return { error: "The lists in the file are empty." };
  return { entries };
}

/**
 * Each entry to one draft by who + date + the first 120 characters of the result; an entry with no draft is counted, never
 * guessed. A matched entry's corrected name or quote comes back as that draft's correction when it differs from the draft.
 */
export function matchList(rows: MatchRow[], entries: Entry[]): { ids: string[]; matched: number; notFound: number; corrections: Correction[] } {
  const ids = new Set<string>();
  const corrections: Correction[] = [];
  let notFound = 0;
  for (const e of entries) {
    const hit = rows.find((r) => {
      if (ids.has(r.id) || norm(r.who) !== e.who) return false;
      const dates = [r.sourceRecordedAt ?? "", r.createdAt].map((d) => d.slice(0, 10));
      if (e.date && !dates.includes(e.date)) return false;
      return [r.resultAfter, r.quote, r.shortVersion].some((t) => t && norm(t).slice(0, RESULT_CHARS).startsWith(e.result.slice(0, Math.min(RESULT_CHARS, e.result.length))));
    });
    if (!hit) {
      notFound++;
      continue;
    }
    ids.add(hit.id);
    const who = e.correctWho && norm(e.correctWho) !== norm(hit.who) ? e.correctWho : null;
    const quote = e.correctedQuote && norm(e.correctedQuote) !== norm(hit.quote ?? hit.resultAfter) ? e.correctedQuote : null;
    if (who || quote) corrections.push({ id: hit.id, who, quote });
  }
  return { ids: [...ids], matched: ids.size, notFound, corrections };
}

/** The corrections the confirm step sends back with Approve: only well-formed ones for the ticked drafts, bounded, one per draft. */
export function parseCorrections(text: unknown, allowed: ReadonlySet<string>): Correction[] {
  if (typeof text !== "string" || !text || text.length > 2_000_000) return [];
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(j)) return [];
  const out: Correction[] = [];
  const seen = new Set<string>();
  for (const c of j.slice(0, 5000)) {
    if (!c || typeof c !== "object") continue;
    const { id, who, quote } = c as Record<string, unknown>;
    if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) continue;
    const w = kept(who, WHO_CHARS);
    const q = kept(quote, QUOTE_CHARS);
    if (!w && !q) continue;
    seen.add(id);
    out.push({ id, who: w, quote: q });
  }
  return out;
}

export type CorrectableRow = { name: string; who: string | null; quote: string | null; resultAfter: string | null; longVersion: string | null; shortVersion: string | null };
const CORRECTABLE = ["name", "who", "quote", "resultAfter", "longVersion", "shortVersion"] as const;
/** What a batch corrected on one draft, with the fields as they were: Undo puts them back. */
export type CorrectionRecord = { id: string; before: Partial<CorrectableRow> };

/**
 * What a correction changes on the draft, and what those fields were: the quote where the draft keeps it (quote for a
 * harvested one, result for a typed one, both when they were the same), the long and short versions that were trims of it,
 * the name when it was built from them, and who. Nothing to change gives null.
 */
export function applyCorrection(row: CorrectableRow, c: { who: string | null; quote: string | null }): { set: Partial<CorrectableRow>; before: Partial<CorrectableRow> } | null {
  const set: Partial<CorrectableRow> = {};
  const oldQuote = row.quote ?? row.resultAfter;
  if (c.who && c.who !== row.who) set.who = c.who;
  if (c.quote && c.quote !== oldQuote) {
    if (row.quote !== null) set.quote = c.quote;
    if (row.quote === null || row.resultAfter === row.quote) set.resultAfter = c.quote;
    if (oldQuote !== null && row.longVersion === oldQuote) set.longVersion = c.quote;
    if (oldQuote !== null && (row.shortVersion === oldQuote || row.shortVersion === autoTrim(oldQuote))) set.shortVersion = autoTrim(c.quote);
  }
  const built = oldQuote !== null && row.name === `${attribution(row.who)}: ${autoTrim(oldQuote, 8)}`;
  if (built && (set.who !== undefined || set.quote !== undefined || set.resultAfter !== undefined)) {
    const name = `${attribution(set.who ?? row.who)}: ${autoTrim(set.quote ?? set.resultAfter ?? oldQuote!, 8)}`;
    if (name !== row.name) set.name = name;
  }
  const keys = Object.keys(set) as (keyof CorrectableRow)[];
  if (!keys.length) return null;
  const before: Record<string, string | null> = {};
  for (const k of keys) before[k] = row[k];
  return { set, before: before as Partial<CorrectableRow> };
}

/** The fields a stored record puts back, and only those: the six correctable ones, as text or null (the name as text). */
export function restoreFields(before: unknown): Partial<CorrectableRow> {
  const out: Record<string, string | null> = {};
  if (!before || typeof before !== "object") return out;
  for (const k of CORRECTABLE) {
    const v = (before as Record<string, unknown>)[k];
    if (typeof v === "string" || (v === null && k !== "name")) out[k] = v;
  }
  return out as Partial<CorrectableRow>;
}

/** Whether a batch can still be undone: within the window and not undone already. */
export function canUndo(batch: { approvedAt: string; undoneAt: string | null } | null | undefined, nowMs: number): boolean {
  if (!batch || batch.undoneAt) return false;
  const at = Date.parse(batch.approvedAt.includes("T") ? batch.approvedAt : `${batch.approvedAt.replace(" ", "T")}Z`);
  return Number.isFinite(at) && nowMs - at <= BATCH_UNDO_HOURS * 3600_000;
}
