/**
 * Building with AI: the words (rev 768), the pure parts: the seed with a workspace's changes on top, the slug a new entry gets,
 * and the whole-word match The Forum underlines with (first occurrence per card, any case).
 */
import { GLOSSARY_SEED, type GlossarySection } from "@/content/glossary";

export type GlossaryRow = { slug: string; heading: string; term: string; meaning: string; hidden: boolean };
export type GlossaryItem = { slug: string; heading: string; term: string; meaning: string; hidden: boolean; edited: boolean; added: boolean };

export const GLOSSARY_HEADINGS = GLOSSARY_SEED.map((s) => s.heading);
export const GLOSSARY_MAX = { term: 80, meaning: 600 } as const;

/** Every entry in order: the seed's, each with its workspace change on top, then the coach's own under their headings. */
export function mergeGlossary(rows: GlossaryRow[], seed: GlossarySection[] = GLOSSARY_SEED): GlossaryItem[] {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const seeded = new Set(seed.flatMap((s) => s.entries.map((e) => e.slug)));
  const out: GlossaryItem[] = [];
  for (const section of seed) {
    for (const e of section.entries) {
      const r = bySlug.get(e.slug);
      out.push(r ? { slug: e.slug, heading: r.heading || section.heading, term: r.term, meaning: r.meaning, hidden: r.hidden, edited: true, added: false } : { ...e, heading: section.heading, hidden: false, edited: false, added: false });
    }
    for (const r of rows.filter((x) => !seeded.has(x.slug) && x.heading === section.heading)) out.push({ ...r, edited: false, added: true });
  }
  // An added entry under a heading the seed doesn't have still shows, last.
  for (const r of rows.filter((x) => !seeded.has(x.slug) && !GLOSSARY_HEADINGS.includes(x.heading))) out.push({ ...r, edited: false, added: true });
  return out;
}

/** The sections a member sees: visible entries only, under their headings, in order. */
export function glossarySections(items: GlossaryItem[]): { heading: string; entries: GlossaryItem[] }[] {
  const heads: string[] = [];
  for (const i of items) if (!i.hidden && !heads.includes(i.heading)) heads.push(i.heading);
  return heads.map((heading) => ({ heading, entries: items.filter((i) => !i.hidden && i.heading === heading) }));
}

/** The #link a new entry gets: its words, lower case, joined by hyphens; a clash gets -2, -3. */
export function glossarySlug(term: string, taken: Set<string>): string {
  const base = term.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "entry";
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** The words an entry is found by in text: its term, and a short form in brackets ("Repository (repo)" → repository, repo). */
export function glossaryWords(term: string): string[] {
  const inner = term.match(/\(([^)]+)\)/)?.[1];
  const main = term.replace(/\(.*?\)/g, "").split(/,| or | vs\. /i)[0];
  return [main, inner].map((w) => (w ?? "").replace(/^the /i, "").trim()).filter((w) => w.length > 1);
}

export type GlossaryMark = { text: string; slug?: string; term?: string; meaning?: string };

/**
 * A line of agent text split where glossary words appear (rev 768 §1): whole words, any case, and only a word's first
 * appearance on the card, which `used` carries from one line of a card to the next. Longer words win over shorter ones that
 * start at the same place ("rate limit" before "rate"). Entries that are hidden never mark.
 */
export function markGlossary(text: string, items: Pick<GlossaryItem, "slug" | "term" | "meaning" | "hidden">[], used: Set<string> = new Set()): GlossaryMark[] {
  const words = items
    .filter((i) => !i.hidden)
    .flatMap((i) => glossaryWords(i.term).map((w) => ({ w, i })))
    .sort((a, b) => b.w.length - a.w.length);
  if (!words.length || !text) return [{ text }];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![A-Za-z0-9])(${words.map((x) => esc(x.w)).join("|")})(?![A-Za-z0-9])`, "gi");
  const out: GlossaryMark[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const hit = words.find((x) => x.w.toLowerCase() === m[0].toLowerCase());
    if (!hit || used.has(hit.i.slug)) continue;
    used.add(hit.i.slug);
    if (m.index! > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], slug: hit.i.slug, term: hit.i.term, meaning: hit.i.meaning });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out.length ? out : [{ text }];
}
