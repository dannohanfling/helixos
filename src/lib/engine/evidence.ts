/**
 * Evidence: published research a client finds for their own claims. Pure helpers: the search terms a claim falls back to
 * when no model is connected, the flags that mark a result worth a closer look, and the one shape a citation takes when it
 * is inserted, claim and citation together so they are never separated.
 */
import type { Evidence, EvidenceAskedFor, EvidenceResult, EvidenceShared } from "@/db/schema";

/** How many OpenAlex searches one client gets a day. Generous for real use, fatal to a loop; the key is shared by every client. */
export const EVIDENCE_DAILY_LIMIT = 25;
/** A cached result answers the same query for this long. */
export const EVIDENCE_CACHE_DAYS = 7;

const STOP = new Set("a an the of to in on for and or but with without is are was were be been being it its this that these those they them their there here from by as at into than then so if not no do does did done have has had can could should would will may might helps help people person someone anyone more less very really about over under just also".split(" "));

/** The plain-words fallback when no model proposes terms: the claim's content words, in order, deduplicated. */
export function fallbackTerms(claim: string): string[] {
  const words = claim.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8);
}

/** The query as the cache keys it: lower case, one space, terms sorted so "a b" and "b a" are one call. */
export function queryKey(terms: string[]): string {
  return [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort().join(" ");
}

/** The UTC date a search counts against. */
export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Auto-flag, never auto-decide: a returned year that differs from the one asked for, or a title missing the key terms, marks
 * the row. A flag says look closer; it does not reject. The client confirms or not.
 */
export function flagsFor(asked: EvidenceAskedFor, found: Pick<EvidenceResult, "title" | "year">): string[] {
  const flags: string[] = [];
  if (asked.year && found.year && found.year !== asked.year) flags.push(`Year differs: you asked for ${asked.year}, this is ${found.year}.`);
  const title = found.title.toLowerCase();
  const key = asked.terms.map((t) => t.toLowerCase()).filter((t) => t.length > 3);
  if (key.length && !key.some((t) => title.includes(t))) flags.push(`The title has none of your terms (${key.slice(0, 4).join(", ")}).`);
  return flags;
}

/** Sorted by citation count, the one quality signal a client can read. */
export function byCitations<T extends { citedByCount: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.citedByCount - a.citedByCount);
}

export const isVerified = (e: Pick<Evidence, "citationQuality">): boolean => e.citationQuality === "verified";

/** "Author et al. (Year). Title. https://doi.org/..." */
export function citation(e: { authors: string; year: number | null; title: string; url?: string | null; doi?: string | null }): string {
  const link = e.url ?? (e.doi ? `https://doi.org/${e.doi}` : "");
  return `${e.authors || "Unknown"}${e.year ? ` (${e.year})` : ""}. ${e.title}.${link ? ` ${link}` : ""}`;
}

/** What Insert copies: the claim and its citation together. Separating them is how a real study becomes a made-up one. */
export function insertText(e: { claim: string; authors: string; year: number | null; title: string; url?: string | null; doi?: string | null }): string {
  return `${e.claim.trim().replace(/[.]$/, "")} (${citation(e)})`;
}

/** A shared shelf study in the same shape as a client's own verified one, so every reader treats both alike. */
export function sharedAsEvidence(s: EvidenceShared): { claim: string; authors: string; year: number | null; title: string; url: string; doi: string; citedByCount: number; name: string } {
  return { claim: s.shortSummary, authors: s.authorsSource, year: s.verifiedYear, title: s.verifiedTitle, url: s.url, doi: s.doi, citedByCount: s.citedByCount, name: s.name };
}

/** The lines a prompt gets: only verified studies, claim and citation together, nothing else is citable. */
export function evidenceLines(rows: { claim: string; authors: string; year: number | null; title: string; url?: string | null; doi?: string | null }[]): string[] {
  return rows.map((r) => `- ${insertText(r)}`);
}

/** Authors as OpenAlex gives them: first author et al. past two. */
export function authorLine(names: string[]): string {
  const n = names.filter(Boolean);
  if (!n.length) return "";
  if (n.length <= 2) return n.join(" & ");
  return `${n[0]} et al.`;
}
