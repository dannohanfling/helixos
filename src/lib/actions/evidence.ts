"use server";

import { and, desc, eq, gte } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { draft } from "@/lib/ai";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { EVIDENCE_CACHE_DAYS, fallbackTerms, flagsFor, outOfQuotaMessage, queryKey, quotaState, resetPhrase, utcDay } from "@/lib/engine/evidence";
import { searchWorks } from "@/lib/openalex";

function back(params: Record<string, string | number | undefined>): never {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  redirect(`/evidence?${sp.toString()}`);
}

/**
 * Step one: the claim becomes what a researcher would search for. The model proposes terms, the effect and the field; with no
 * model connected the claim's own words stand in and the page says so. The client edits the terms before anything is searched.
 */
export async function proposeTermsAction(formData: FormData): Promise<void> {
  await ctx();
  const claim = str(formData, "claim");
  if (!claim) return;
  const author = str(formData, "author");
  const year = str(formData, "year");
  let terms: string[] = [];
  let note = "";
  const text = await draft(
    `You turn a plain-words claim a coach wants to support into what a researcher would search for. Return ONLY a JSON object {"terms": string[] (3 to 6 search terms a researcher would use), "effect": string (the named effect or finding if there is one, else ""), "field": string (the field and the terms its researchers use)}. Never invent a study, an author, a year or a number.`,
    `Claim: ${claim}${author ? `\nAuthor they have in mind: ${author}` : ""}${year ? `\nYear they have in mind: ${year}` : ""}`,
    400,
    { feature: "evidence_terms" },
  );
  if (text) {
    try {
      const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { terms?: unknown[]; effect?: string; field?: string };
      terms = (j.terms ?? []).map(String).map((t) => t.trim()).filter(Boolean).slice(0, 8);
      note = [j.effect, j.field].filter(Boolean).join(" · ");
    } catch {
      terms = [];
    }
  }
  const proposed = terms.length ? "ai" : "words";
  if (!terms.length) terms = fallbackTerms(claim);
  back({ claim, author, year, terms: terms.join(", "), note, proposed });
}

/**
 * Step two: real papers from OpenAlex, server-side, on Danno's one shared key. Cached by query so two clients asking the same
 * thing is one call; rate-limited per client per day so one loop cannot break Evidence for everyone; a failure says so plainly.
 */
export async function searchEvidenceAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const resetsAt = resetPhrase(v.membership.timezone || v.workspace.timezone);
  const claim = str(formData, "claim");
  const author = str(formData, "author");
  const yearRaw = str(formData, "year");
  const note = str(formData, "note");
  const proposed = str(formData, "proposed");
  const terms = str(formData, "terms").split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
  const carry = { claim, author, year: yearRaw, note, proposed, terms: terms.join(", ") };
  if (!terms.length) back({ ...carry, error: "Give it at least one search term." });
  const year = Number(yearRaw) || undefined;
  const askedFor = { claim, terms, author: author || undefined, year };
  const key = queryKey(terms);
  const day = utcDay();
  const since = new Date(Date.now() - EVIDENCE_CACHE_DAYS * 86400000).toISOString().slice(0, 10);
  const cached = await db.query.evidenceSearches.findFirst({ where: and(eq(schema.evidenceSearches.queryKey, key), eq(schema.evidenceSearches.fromCache, false), gte(schema.evidenceSearches.createdAt, since)), orderBy: desc(schema.evidenceSearches.createdAt) });
  let results = cached?.results ?? [];
  let fromCache = Boolean(cached);
  let credits: { limit: number | null; remaining: number | null } = { limit: null, remaining: null };
  if (!cached) {
    // Two counters that must agree: this client's day, and the whole pool's day (one key for every client), with what OpenAlex last reported.
    const today = await db.query.evidenceSearches.findMany({ where: and(eq(schema.evidenceSearches.day, day), eq(schema.evidenceSearches.fromCache, false)), orderBy: desc(schema.evidenceSearches.createdAt) });
    const reported = today.find((r) => r.creditsRemaining != null)?.creditsRemaining ?? null;
    const q = quotaState(today, userId, day, reported, resetsAt);
    if (!q.allowed) back({ ...carry, error: q.refusal ?? "Not now." });
    const r = await searchWorks(terms);
    // The pool itself answered 429: the same words, with the reset in the member's own clock rather than the pool's.
    if (!r.ok) back({ ...carry, error: r.status === 429 ? outOfQuotaMessage(resetsAt) : r.error });
    results = r.data;
    credits = r.quota;
    fromCache = false;
  }
  const id = newId();
  await db.insert(schema.evidenceSearches).values({ id, userId, day, queryKey: key, query: terms.join(", "), claim, askedFor, results, fromCache, creditsLimit: credits.limit, creditsRemaining: credits.remaining });
  refresh();
  redirect(`/evidence?search=${id}`);
}

/** The client picks one result: it joins their shelf as unverified, with what they asked for kept beside what came back. */
export async function addEvidenceAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const searchId = str(formData, "searchId");
  const openalexId = str(formData, "openalexId");
  const search = await db.query.evidenceSearches.findFirst({ where: and(eq(schema.evidenceSearches.id, searchId), eq(schema.evidenceSearches.userId, userId)) });
  const found = search?.results.find((r) => r.openalexId === openalexId);
  if (!search || !found) return;
  const id = newId();
  await db.insert(schema.evidence).values({
    id,
    workspaceId,
    userId,
    claim: search.askedFor.claim || search.claim,
    askedFor: search.askedFor,
    title: found.title,
    authors: found.authors,
    year: found.year,
    doi: found.doi,
    url: found.url,
    openalexId: found.openalexId,
    citedByCount: found.citedByCount,
    citationQuality: "unverified",
    flags: flagsFor(search.askedFor, found),
  });
  refresh();
  redirect(`/evidence?search=${searchId}&added=${id}#shelf`);
}

/** Only the client's confirmation makes a study citable. Nothing else moves citationQuality. */
export async function confirmEvidenceAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await db.update(schema.evidence).set({ citationQuality: "verified", verifiedAt: nowIso() }).where(and(eq(schema.evidence.id, id), eq(schema.evidence.userId, userId)));
  refresh();
  redirect("/evidence#shelf");
}

export async function removeEvidenceAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await db.delete(schema.evidence).where(and(eq(schema.evidence.id, id), eq(schema.evidence.userId, userId)));
  refresh();
  redirect("/evidence#shelf");
}

/** Removes a shared study from this client's shelf only. Every other shelf is untouched. */
export async function hideSharedAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const sharedId = str(formData, "sharedId");
  if (!sharedId) return;
  await db.insert(schema.evidenceHidden).values({ id: newId(), userId, sharedId }).onConflictDoNothing();
  refresh();
  redirect("/evidence#shared");
}

export async function restoreSharedAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const sharedId = str(formData, "sharedId");
  await db.delete(schema.evidenceHidden).where(and(eq(schema.evidenceHidden.userId, userId), eq(schema.evidenceHidden.sharedId, sharedId)));
  refresh();
  redirect("/evidence#shared");
}
