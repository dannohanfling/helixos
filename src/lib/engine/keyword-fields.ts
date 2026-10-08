/**
 * The keyword router's bot fields (Ship a ladder commit 2, rev 583's fallback): HelixOS writes two named fields to the
 * member's Community Loyalty bot and the starter template's router reads them. helix_keywords_cbf is a JSON list of the
 * member's active keywords, each with where the bot listens, what it replies, what it tags and what the keyword fetches;
 * helix_keyword_agent_cbf is the agent the router hands off to. Pure: the composition and the plan; the push is
 * src/lib/community-loyalty.ts. Never a delete; never more than the cap; nothing that reaches the bot carries a token.
 */
import type { LadderKeyword } from "@/db/schema";

export const KEYWORDS_FIELD = "helix_keywords_cbf";
export const KEYWORD_AGENT_FIELD = "helix_keyword_agent_cbf";
export const KEYWORD_FIELDS = [KEYWORDS_FIELD, KEYWORD_AGENT_FIELD] as const;
/** The router matches against at most this many at once. */
export const MAX_ACTIVE_KEYWORDS = 20;

export type MagnetRef = { id: string; title: string; promise: string; url: string | null };
export type ProductRef = { name: string | null; pitch: string | null; priceLine: string | null; trialLine: string | null };
export type RouterKeyword = { keyword: string; kind: "comment" | "dm" | "both"; tag: string; fetch: { kind: "product" | "magnet" | "conversation"; title?: string; url?: string; line?: string }; reply: string };

/** The tag a keyword gives the person when the member wrote none. */
export const defaultTag = (keyword: string): string => `helix:${keyword.toUpperCase()}`;

/** One keyword as the router reads it, or null when it has no target yet (a keyword with no target never reaches the bot). */
export function routerKeyword(k: LadderKeyword, product: ProductRef, magnets: readonly MagnetRef[]): RouterKeyword | null {
  const keyword = k.keyword.trim().toUpperCase();
  if (!keyword || !k.target) return null;
  const kind = k.kind ?? "both";
  const tag = (k.tag ?? "").trim() || defaultTag(keyword);
  if (k.target.kind === "product") {
    const name = product.name?.trim() || "the offer";
    const reply = [product.pitch?.trim(), product.priceLine?.trim(), product.trialLine?.trim()].filter(Boolean).join(" ");
    return { keyword, kind, tag, fetch: { kind: "product", title: name }, reply: reply || `Here's what you asked about: ${name}.` };
  }
  if (k.target.kind === "magnet") {
    const m = magnets.find((x) => x.id === k.target?.magnetId);
    if (!m) return null;
    return { keyword, kind, tag, fetch: { kind: "magnet", title: m.title, ...(m.url ? { url: m.url } : {}) }, reply: `${m.title}${m.promise ? `: ${m.promise}` : ""}${m.url ? ` ${m.url}` : ""}`.trim() };
  }
  const line = (k.target.line ?? "").trim();
  if (!line) return null;
  return { keyword, kind, tag, fetch: { kind: "conversation", line }, reply: line };
}

/** The two fields' values: the active keywords (each once, the first of a repeated keyword kept, the cap applied) and the agent. */
export function keywordFieldsPayload(keywords: readonly LadderKeyword[], product: ProductRef, magnets: readonly MagnetRef[], agentNs: string | null | undefined): Record<(typeof KEYWORD_FIELDS)[number], string> {
  const seen = new Set<string>();
  const list: RouterKeyword[] = [];
  for (const k of keywords) {
    const r = routerKeyword(k, product, magnets);
    if (!r || seen.has(r.keyword)) continue;
    seen.add(r.keyword);
    list.push(r);
    if (list.length >= MAX_ACTIVE_KEYWORDS) break;
  }
  return { [KEYWORDS_FIELD]: JSON.stringify(list), [KEYWORD_AGENT_FIELD]: (agentNs ?? "").trim() };
}

export type KeywordPlanRow = { name: string; current: string | null; next: string; status: "change" | "same" | "missing" };
/** What a push would do per field: the bot has no such field (the template lacks the router), holds it already, or changes. */
export function keywordPlan(payload: Record<string, string>, held: readonly { name: string; value: string }[]): KeywordPlanRow[] {
  return KEYWORD_FIELDS.map((name) => {
    const row = held.find((h) => h.name === name);
    const next = payload[name] ?? "";
    if (!row) return { name, current: null, next, status: "missing" };
    return { name, current: row.value, next, status: row.value === next ? "same" : "change" };
  });
}
/** The keywords a field holds, read back for the page: the JSON list, or nothing when it does not parse. */
export function parseRouterKeywords(value: string | null | undefined): RouterKeyword[] {
  if (!value) return [];
  try {
    const v = JSON.parse(value) as unknown;
    return Array.isArray(v) ? v.filter((x): x is RouterKeyword => typeof x === "object" && x !== null && typeof (x as RouterKeyword).keyword === "string") : [];
  } catch {
    return [];
  }
}
