/**
 * Evidence: published research a client finds for their own claims. Pure helpers: the search terms a claim falls back to
 * when no model is connected, the flags that mark a result worth a closer look, and the one shape a citation takes when it
 * is inserted, claim and citation together so they are never separated.
 */
import type { Evidence, EvidenceAskedFor, EvidenceResult, EvidenceShared } from "@/db/schema";

/** How many OpenAlex searches one client gets a day. Generous for real use, fatal to a loop; the key is shared by every client. */
export const EVIDENCE_DAILY_LIMIT = 25;
/**
 * The shared pool, from OpenAlex's docs (rate-limits-and-authentication): 100,000 credits a day free, a list or search request
 * costing 10, reset at midnight UTC. So 10,000 searches a day for the one key every client shares. OpenAlex also reports the
 * live figure on every response (X-RateLimit-Remaining); when it has, the tighter of the two counts wins.
 */
export const EVIDENCE_CREDITS_PER_SEARCH = 10;
export const EVIDENCE_GLOBAL_BUDGET = 100000 / EVIDENCE_CREDITS_PER_SEARCH;
/** Past this share of the day's pool, everyone drops to the degraded allowance so latecomers can still get in. */
export const EVIDENCE_DEGRADE_AT = 0.7;
export const EVIDENCE_DEGRADED_LIMIT = 5;

export type QuotaRow = { userId: string; day: string; fromCache: boolean; creditsRemaining?: number | null };
export type QuotaState = {
  usedToday: number;
  globalToday: number;
  budget: number;
  poolLeft: number;
  degraded: boolean;
  exhausted: boolean;
  limit: number;
  allowed: boolean;
  /** Plain words for a refusal, never implying the client did something wrong when they did not. Null when allowed. */
  refusal: string | null;
};

/**
 * Where today's quota stands for one client: their own count, the global count, and the allowance that follows. Real calls
 * only; cache hits cost nothing. `creditsRemaining` is the last figure OpenAlex reported today, if any.
 */
export function quotaState(rows: QuotaRow[], userId: string, day: string, creditsRemaining?: number | null): QuotaState {
  const real = rows.filter((r) => r.day === day && !r.fromCache);
  const globalToday = real.length;
  const usedToday = real.filter((r) => r.userId === userId).length;
  const budget = EVIDENCE_GLOBAL_BUDGET;
  const local = budget - globalToday;
  const reported = creditsRemaining == null ? Infinity : Math.floor(creditsRemaining / EVIDENCE_CREDITS_PER_SEARCH);
  const poolLeft = Math.max(0, Math.min(local, reported));
  const exhausted = poolLeft <= 0;
  const degraded = !exhausted && poolLeft <= budget * (1 - EVIDENCE_DEGRADE_AT);
  const limit = degraded ? EVIDENCE_DEGRADED_LIMIT : EVIDENCE_DAILY_LIMIT;
  const allowed = !exhausted && usedToday < limit;
  const refusal = allowed
    ? null
    : exhausted
      ? "The shared daily limit for Evidence searches is used up for today. Nobody did anything wrong: one key is shared by every client. It resets at midnight UTC."
      : degraded
        ? `The shared daily limit is close, so everyone is down to ${EVIDENCE_DEGRADED_LIMIT} searches for the rest of today. Nobody did anything wrong. It resets at midnight UTC.`
        : `You have used today's ${EVIDENCE_DAILY_LIMIT} searches. The count resets at midnight UTC.`;
  return { usedToday, globalToday, budget, poolLeft, degraded, exhausted, limit, allowed, refusal };
}

/** The last seven UTC days, oldest first, with each day's real search count. */
export function lastDays(rows: QuotaRow[], today: string, days = 7): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  const t = new Date(`${today}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(t.getTime() - i * 86400000).toISOString().slice(0, 10);
    out.push({ day: d, count: rows.filter((r) => r.day === d && !r.fromCache).length });
  }
  return out;
}
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
