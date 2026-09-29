import type { WhatsNewEntry } from "@/content/whats-new";

/**
 * What's new (rev 193): who sees which entry, what counts as unseen, and the gate's rule that a change people can see comes
 * with its entry. Pure, so the page, the menu dot and the gate share one answer.
 */
export type Role = "coach" | "client";

/** Coach entries (the import, coach pages) only for coaches; everyone's entries for everyone. Newest first. */
export function visibleEntries(entries: WhatsNewEntry[], role: Role): WhatsNewEntry[] {
  return entries.filter((e) => e.audience === "everyone" || role === "coach").sort((a, b) => b.n - a.n);
}

/** The newest entry this member can see, by its `n`: what opening the page marks as seen. 0 when there is none. */
export const newestSeenable = (entries: WhatsNewEntry[], role: Role): number => visibleEntries(entries, role)[0]?.n ?? 0;

/** How many entries this member can see that are newer than the last time they opened the page (never opened: all of them). */
export function unseenCount(entries: WhatsNewEntry[], role: Role, seen: number | null): number {
  return visibleEntries(entries, role).filter((e) => e.n > (seen ?? 0)).length;
}

/** The Monday of an entry's week ("2026-09-28"), for grouping the page by week. */
export function weekOfEntry(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The entries in weeks, newest week first, each week's entries newest first. */
export function byWeek(entries: WhatsNewEntry[]): { week: string; entries: WhatsNewEntry[] }[] {
  const weeks = new Map<string, WhatsNewEntry[]>();
  for (const e of [...entries].sort((a, b) => b.n - a.n)) {
    const w = weekOfEntry(e.date);
    weeks.set(w, [...(weeks.get(w) ?? []), e]);
  }
  return [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([week, list]) => ({ week, entries: list }));
}

/** Problems with the entries themselves: numbering, dates, audiences, and wording meant for us rather than for members. */
export function entryProblems(entries: WhatsNewEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const e of entries) {
    if (!Number.isInteger(e.n) || e.n < 1) out.push(`entry "${e.title}": n must be a whole number from 1`);
    if (seen.has(e.n)) out.push(`entry "${e.title}": n ${e.n} is used twice`);
    seen.add(e.n);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) out.push(`entry "${e.title}": date must be YYYY-MM-DD`);
    if (e.audience !== "everyone" && e.audience !== "coach") out.push(`entry "${e.title}": audience must be everyone or coach`);
    if (!e.title.trim() || !e.lines.length || e.lines.length > 3) out.push(`entry "${e.title}": a title and one to three lines`);
    // Written for a client: no handoff rev numbers or commit hashes in what they read (the version field carries the commit).
    for (const t of [e.title, ...e.lines]) if (/\brevs? \d+\b|\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/i.test(t)) out.push(`entry "${e.title}": no rev numbers or commit hashes in the words`);
  }
  for (let i = 1; i < entries.length; i++) if (entries[i].n >= entries[i - 1].n) out.push("entries must be listed newest first, n going down");
  return out;
}

/** Files whose change people see: the pages and components. API routes, tests and everything else are not. */
export function isUserFacing(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (/__tests__\/|\.test\.tsx?$/.test(p)) return false;
  if (p.startsWith("src/app/api/")) return false;
  return /^src\/(app|components)\/.+\.(tsx|ts|css)$/.test(p);
}

export const CHANGELOG_FILE = "src/content/whats-new.ts";
export const NO_CHANGELOG = "[no-changelog]";

/**
 * The gate's rule: a change to what people see adds its What's new entry in the same commit, unless its message says
 * [no-changelog] (a refactor or fix nobody would notice).
 */
export function changelogCheck(changed: string[], message = ""): { ok: true } | { ok: false; files: string[] } {
  const files = changed.filter(isUserFacing);
  if (!files.length || changed.includes(CHANGELOG_FILE) || message.includes(NO_CHANGELOG)) return { ok: true };
  return { ok: false, files };
}
