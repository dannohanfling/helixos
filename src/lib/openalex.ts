/**
 * OpenAlex, with Danno's one shared key. Server-side only: OpenAlex takes the key as a query parameter, so any browser call
 * would hand the key to every client's devtools and to anything logging URLs between. Nothing in this file may be imported
 * by a client component, and no error message ever carries the URL. Two calls: search works, and resolve one work by DOI.
 */
import type { EvidenceResult } from "@/db/schema";
import { authorLine, outOfQuotaMessage } from "@/lib/engine/evidence";

const DEFAULT_BASE = "https://api.openalex.org";
/** Development and smoke tests point at a mock. Never honoured in production. */
export function openalexBase(): string {
  return (process.env.NODE_ENV !== "production" && process.env.OPENALEX_BASE_URL ? process.env.OPENALEX_BASE_URL : DEFAULT_BASE).replace(/\/$/, "");
}

export const openalexConfigured = (): boolean => Boolean(process.env.OPENALEX_API_KEY);

/** What OpenAlex reported with the response, in credits: the day's limit and what is left (X-RateLimit-Limit / -Remaining). */
export type OpenAlexQuota = { limit: number | null; remaining: number | null };
export type OpenAlexResult<T> = { ok: true; data: T; quota: OpenAlexQuota } | { ok: false; error: string; status?: number; quota?: OpenAlexQuota };

type Work = { id?: string; doi?: string | null; title?: string | null; display_name?: string | null; publication_year?: number | null; cited_by_count?: number; authorships?: { author?: { display_name?: string | null } }[] };

function toResult(w: Work): EvidenceResult {
  const doi = (w.doi ?? "").replace(/^https?:\/\/doi\.org\//, "") || null;
  return {
    openalexId: (w.id ?? "").replace(/^https?:\/\/openalex\.org\//, ""),
    title: w.title ?? w.display_name ?? "(untitled)",
    authors: authorLine((w.authorships ?? []).map((a) => a.author?.display_name ?? "")),
    year: w.publication_year ?? null,
    doi,
    url: doi ? `https://doi.org/${doi}` : null,
    citedByCount: w.cited_by_count ?? 0,
  };
}

/**
 * What a client sees when the search fails: what happened to them and what to do next. Never a variable, a host, a vendor,
 * a stack trace or a person; the detail (status, upstream body, missing configuration) goes to the server log, where it is
 * useful. The quota case says when it resets; an empty result must never stand in for "no quota".
 */
export const OPENALEX_CLIENT_ERRORS = {
  keyRejected: "Evidence search is unavailable right now. This one is on us — it has been logged and we are on it.",
  unreachable: "Couldn't reach the research catalogue. Try again in a minute.",
  other: "Evidence search hit an error. Try again in a minute.",
  notConfigured: "Evidence search isn't set up yet.",
} as const;
export function explainOpenAlex(status: number | undefined, message: string): string {
  if (status === 429) return outOfQuotaMessage();
  if (status === 401 || status === 403) return OPENALEX_CLIENT_ERRORS.keyRejected;
  if (/abort|fetch failed|econn/i.test(message)) return OPENALEX_CLIENT_ERRORS.unreachable;
  return OPENALEX_CLIENT_ERRORS.other;
}
/** The server-side record of the same failure, with everything the client line leaves out. */
function logOpenAlex(what: string, detail: Record<string, unknown>): void {
  console.error(`[openalex] ${what}`, JSON.stringify(detail));
}

async function call<T>(path: string, params: Record<string, string>): Promise<OpenAlexResult<T>> {
  const key = process.env.OPENALEX_API_KEY;
  if (!key) {
    logOpenAlex("OPENALEX_API_KEY is not set: Evidence search refused", { path });
    return { ok: false, error: OPENALEX_CLIENT_ERRORS.notConfigured };
  }
  const url = new URL(`${openalexBase()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    clearTimeout(t);
    const num = (h: string) => (res.headers.get(h) === null || Number.isNaN(Number(res.headers.get(h))) ? null : Number(res.headers.get(h)));
    const quota: OpenAlexQuota = { limit: num("x-ratelimit-limit"), remaining: num("x-ratelimit-remaining") };
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 500);
      logOpenAlex(res.status === 401 || res.status === 403 ? "the key was rejected: OPENALEX_API_KEY needs checking" : `upstream ${res.status}`, { status: res.status, path, body, quota });
      return { ok: false, status: res.status, error: explainOpenAlex(res.status, body), quota };
    }
    return { ok: true, data: (await res.json()) as T, quota };
  } catch (e) {
    // The message may name the URL, and the URL carries the key: never pass it through, to the client or to the log.
    logOpenAlex("request failed", { path, name: (e as Error).name, message: String((e as Error).message ?? e).replace(/api_key=[^&\s]+/g, "api_key=[redacted]").slice(0, 300) });
    return { ok: false, error: explainOpenAlex(undefined, (e as Error).name === "AbortError" ? "abort" : "fetch failed") };
  }
}

/** Real papers for a set of terms, most cited first. */
export async function searchWorks(terms: string[]): Promise<OpenAlexResult<EvidenceResult[]>> {
  const r = await call<{ results?: Work[] }>("/works", { search: terms.join(" "), "per-page": "10", sort: "cited_by_count:desc", select: "id,doi,title,display_name,publication_year,cited_by_count,authorships" });
  if (!r.ok) return r;
  return { ok: true, data: (r.data.results ?? []).map(toResult), quota: r.quota };
}

/** One work by DOI, for the side-by-side when a client already has a study in mind. */
export async function workByDoi(doi: string): Promise<OpenAlexResult<EvidenceResult>> {
  const r = await call<Work>(`/works/https://doi.org/${encodeURIComponent(doi.replace(/^https?:\/\/doi\.org\//, ""))}`, {});
  if (!r.ok) return r;
  return { ok: true, data: toResult(r.data), quota: r.quota };
}
