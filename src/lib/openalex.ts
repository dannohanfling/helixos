/**
 * OpenAlex, with Danno's one shared key. Server-side only: OpenAlex takes the key as a query parameter, so any browser call
 * would hand the key to every client's devtools and to anything logging URLs between. Nothing in this file may be imported
 * by a client component, and no error message ever carries the URL. Two calls: search works, and resolve one work by DOI.
 */
import type { EvidenceResult } from "@/db/schema";
import { authorLine } from "@/lib/engine/evidence";

const DEFAULT_BASE = "https://api.openalex.org";
/** Development and smoke tests point at a mock. Never honoured in production. */
export function openalexBase(): string {
  return (process.env.NODE_ENV !== "production" && process.env.OPENALEX_BASE_URL ? process.env.OPENALEX_BASE_URL : DEFAULT_BASE).replace(/\/$/, "");
}

export const openalexConfigured = (): boolean => Boolean(process.env.OPENALEX_API_KEY);

export type OpenAlexResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

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

/** Plain words for what went wrong. The quota case says when it resets; an empty result must never stand in for "no quota". */
export function explainOpenAlex(status: number | undefined, message: string): string {
  if (status === 429) return "Evidence search is out of quota for today. The key is shared by every client, and it resets at midnight UTC. Try again then.";
  if (status === 401 || status === 403) return "OpenAlex rejected the key. Tell Danno: the OPENALEX_API_KEY in Vercel needs checking.";
  if (/abort|fetch failed|econn/i.test(message)) return "Couldn't reach OpenAlex. Try again in a minute.";
  return `OpenAlex replied: ${message}`.slice(0, 200);
}

async function call<T>(path: string, params: Record<string, string>): Promise<OpenAlexResult<T>> {
  const key = process.env.OPENALEX_API_KEY;
  if (!key) return { ok: false, error: "Evidence search is not set up on this server (no OpenAlex key)." };
  const url = new URL(`${openalexBase()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, status: res.status, error: explainOpenAlex(res.status, body) };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    // The message may name the URL, and the URL carries the key: never pass it through.
    return { ok: false, error: explainOpenAlex(undefined, (e as Error).name === "AbortError" ? "abort" : "fetch failed") };
  }
}

/** Real papers for a set of terms, most cited first. */
export async function searchWorks(terms: string[]): Promise<OpenAlexResult<EvidenceResult[]>> {
  const r = await call<{ results?: Work[] }>("/works", { search: terms.join(" "), "per-page": "10", sort: "cited_by_count:desc", select: "id,doi,title,display_name,publication_year,cited_by_count,authorships" });
  if (!r.ok) return r;
  return { ok: true, data: (r.data.results ?? []).map(toResult) };
}

/** One work by DOI, for the side-by-side when a client already has a study in mind. */
export async function workByDoi(doi: string): Promise<OpenAlexResult<EvidenceResult>> {
  const r = await call<Work>(`/works/https://doi.org/${encodeURIComponent(doi.replace(/^https?:\/\/doi\.org\//, ""))}`, {});
  if (!r.ok) return r;
  return { ok: true, data: toResult(r.data) };
}
