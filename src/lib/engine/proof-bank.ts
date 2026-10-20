/**
 * The Proof Bank list (H-1393, H-1394): the status views and their counts, the page size, the clean-list match, and the
 * undo window of a batch. Pure; the page and the actions read these.
 */
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

/* ───────────── The clean list (H-1394) ───────────── */

export type ListEntry = { who?: unknown; date?: unknown; result_starts?: unknown };
export type ListFile = { approve_clean?: unknown; keep_as_draft?: unknown };
export type MatchRow = { id: string; who: string | null; resultAfter: string | null; quote: string | null; shortVersion: string | null; sourceRecordedAt: string | null; createdAt: string };
const norm = (s: unknown): string => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const RESULT_CHARS = 120;

/** Read the list file: its approve_clean rows, or why it can't be read. Nothing else in the file is kept. */
export function readListFile(text: string): { entries: { who: string; date: string; result: string }[] } | { error: string } {
  let j: ListFile;
  try {
    j = JSON.parse(text) as ListFile;
  } catch {
    return { error: "That isn't a JSON file." };
  }
  if (!j || typeof j !== "object" || !Array.isArray(j.approve_clean)) return { error: 'The file has no "approve_clean" list.' };
  const entries = (j.approve_clean as ListEntry[]).map((e) => ({ who: norm(e.who), date: String(e.date ?? "").trim().slice(0, 10), result: norm(e.result_starts).slice(0, RESULT_CHARS) })).filter((e) => e.who && e.result);
  if (!entries.length) return { error: 'The "approve_clean" list is empty.' };
  return { entries };
}

/** Each entry to one draft by who + date + the first 120 characters of the result; an entry with no draft is counted, never guessed. */
export function matchList(rows: MatchRow[], entries: { who: string; date: string; result: string }[]): { ids: string[]; matched: number; notFound: number } {
  const ids = new Set<string>();
  let notFound = 0;
  for (const e of entries) {
    const hit = rows.find((r) => {
      if (ids.has(r.id) || norm(r.who) !== e.who) return false;
      const dates = [r.sourceRecordedAt ?? "", r.createdAt].map((d) => d.slice(0, 10));
      if (e.date && !dates.includes(e.date)) return false;
      return [r.resultAfter, r.quote, r.shortVersion].some((t) => t && norm(t).slice(0, RESULT_CHARS).startsWith(e.result.slice(0, Math.min(RESULT_CHARS, e.result.length))));
    });
    if (hit) ids.add(hit.id);
    else notFound++;
  }
  return { ids: [...ids], matched: ids.size, notFound };
}

/** Whether a batch can still be undone: within the window and not undone already. */
export function canUndo(batch: { approvedAt: string; undoneAt: string | null } | null | undefined, nowMs: number): boolean {
  if (!batch || batch.undoneAt) return false;
  const at = Date.parse(batch.approvedAt.includes("T") ? batch.approvedAt : `${batch.approvedAt.replace(" ", "T")}Z`);
  return Number.isFinite(at) && nowMs - at <= BATCH_UNDO_HOURS * 3600_000;
}
