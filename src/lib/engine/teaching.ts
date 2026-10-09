/**
 * Danno's teaching library and story bank for the ladder writer (rev 615 plan, rev 618 answers). Pure: the two file formats read
 * into entries, the story bank's three statuses, the price check, the search words for a ladder, the ranking (fresh before
 * used, a format's "Good for" first) and the block the writer reads. Nothing here reads a file, the network or the database.
 *
 * The library: `### Q:` entries, each an answer and a footer "Topic: … | Category: … | Taught: YYYY-MM-DD (call type)".
 * The story bank: items with Type, What, Exact words, Numbers, Good for, Publish status and Source (call, date, a Fathom link
 * with ?timestamp=secs). Both are read tolerantly: bold, bullets and heading levels vary; what can't be read is counted, never
 * guessed at.
 */
import { createHash } from "node:crypto";

import { STORY_TYPES, type StoryStatus, type StoryType } from "./teaching-kinds";
export { STATUS_WORDS, STORY_STATUSES, STORY_TYPES, type StoryStatus, type StoryType } from "./teaching-kinds";

export type TeachingEntry = { key: string; question: string; answer: string; topic: string | null; category: string | null; taughtOn: string | null; callType: string | null; hasPrice: boolean };
export type StoryItem = { key: string; title: string; type: StoryType; what: string; exactWords: string | null; numbers: string | null; goodFor: string | null; status: StoryStatus; rawStatus: string | null; sourceCall: string | null; sourceDate: string | null; fathomUrl: string | null; hasPrice: boolean };
export type ReadResult<T> = { entries: T[]; unreadable: string[] };

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 24);
const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
/** Markdown emphasis and a list bullet off a line's start: "- **What:** x" → "What: x". */
const plain = (line: string) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\*\*|__/g, "").replace(/^\s*[*_](?=\S)|(?<=\S)[*_]\s*$/g, "").trim();

/** Any amount of money: a currency sign before or after digits, or digits with a currency word. Prices of any kind stay out. */
export const PRICE = /(?:[$£€]\s?\d)|(?:\d[\d,.]*\s?(?:usd|dollars?|bucks|euros?|pounds?)\b)|(?:\b\d+(?:\.\d+)?\s?k\s?(?:\/|per|a)\s?(?:mo|month|year|yr)\b)/i;
export const hasPrice = (...texts: (string | null | undefined)[]) => texts.some((t) => Boolean(t) && PRICE.test(t!));

/** The story bank's three values (rev 618), and anything else read as "check": never ready by accident. */
export function statusOf(raw: string | null | undefined): StoryStatus {
  const r = (raw ?? "").toLowerCase();
  if (/^\s*danno'?s own/.test(r) || /\bok to use\b/.test(r)) return "ready";
  if (/needs? (client )?permission/.test(r)) return "needs_permission";
  return "check";
}
export function typeOf(raw: string | null | undefined): StoryType | null {
  const r = norm(raw ?? "");
  if (r.startsWith("client result")) return "client_result";
  return (STORY_TYPES as readonly string[]).includes(r) ? (r as StoryType) : null;
}

/** "Topic: A | Category: B | Taught: 2026-08-14 (Accelerator)" → its parts; null when the line is not that footer. */
export function readFooter(line: string): { topic: string | null; category: string | null; taughtOn: string | null; callType: string | null } | null {
  const p = plain(line);
  if (!/^topic\s*:/i.test(p)) return null;
  const parts = Object.fromEntries(p.split("|").map((x) => x.split(/:([\s\S]*)/).map((y) => y.trim())).filter((kv) => kv.length >= 2 && kv[0]).map(([k, v]) => [k.toLowerCase(), v]));
  const taught = parts.taught ?? "";
  const date = taught.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const call = taught.match(/\(([^)]+)\)/)?.[1]?.trim() ?? null;
  return { topic: parts.topic || null, category: parts.category || null, taughtOn: date, callType: call };
}

/** The teaching library: every `### Q:` entry with its answer and footer. A question with no answer is unreadable. */
export function readLibrary(text: string): ReadResult<TeachingEntry> {
  const entries: TeachingEntry[] = [];
  const unreadable: string[] = [];
  const blocks = text.replace(/\r/g, "").split(/^#{2,4}\s*Q\s*[:.]\s*/im).slice(1);
  for (const block of blocks) {
    const lines = block.split("\n");
    const question = plain(lines[0] ?? "");
    // The answer runs to the next heading of any level; the footer is its last Topic line.
    const rest: string[] = [];
    for (const l of lines.slice(1)) {
      if (/^#{1,4}\s/.test(l)) break;
      rest.push(l);
    }
    let footer: ReturnType<typeof readFooter> = null;
    const body = rest.filter((l) => {
      const f = readFooter(l);
      if (f) footer = f;
      return !f && !/^\s*-{3,}\s*$/.test(l);
    });
    const answer = body.join("\n").replace(/^\s*\**A\s*[:.]\**\s*/i, "").trim();
    if (!question || !answer) {
      unreadable.push(question.slice(0, 80) || "(a question with no words)");
      continue;
    }
    const f = footer as ReturnType<typeof readFooter>;
    entries.push({ key: hash(`${norm(question)}|${f?.taughtOn ?? ""}`), question, answer, topic: f?.topic ?? null, category: f?.category ?? null, taughtOn: f?.taughtOn ?? null, callType: f?.callType ?? null, hasPrice: hasPrice(question, answer) });
  }
  return { entries, unreadable };
}

const FIELD = /^(type|what|exact words|numbers|good for|publish status|source)\s*:\s*(.*)$/i;

/** "Accelerator call, 2026-08-14, https://fathom.video/share/x?timestamp=724" → its call, date and Fathom link. */
export function readSource(raw: string | null): { sourceCall: string | null; sourceDate: string | null; fathomUrl: string | null } {
  const r = raw ?? "";
  const url = r.match(/https:\/\/(?:[\w-]+\.)?fathom\.video\/[^\s)>\]]+/)?.[0] ?? null;
  const date = r.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  const call = r.replace(url ?? "", "").replace(date ?? "", "").split(/[,;|(]/)[0]?.replace(/[[\]]/g, "").trim() || null;
  return { sourceCall: call, sourceDate: date, fathomUrl: url };
}

/**
 * The story bank: an item is a heading followed by its fields (or, with no headings, a run of fields starting at Type). A field
 * runs on over the lines under it until the next field. Without a Type it can read, or with no What, the item is unreadable.
 */
export function readStoryBank(text: string): ReadResult<StoryItem> {
  const entries: StoryItem[] = [];
  const unreadable: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  type Draft = { title: string; fields: Record<string, string> };
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  let field: string | null = null;
  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.*)$/);
    if (heading) {
      cur = { title: plain(heading[1]).replace(/^\d+[.)]\s*/, ""), fields: {} };
      drafts.push(cur);
      field = null;
      continue;
    }
    const m = plain(line).match(FIELD);
    if (m) {
      const key = m[1].toLowerCase();
      // With no headings, a Type line starts the next item.
      if (!cur || (key === "type" && (cur.fields.type !== undefined || cur.fields.what !== undefined))) {
        cur = { title: "", fields: {} };
        drafts.push(cur);
      }
      cur.fields[key] = m[2].trim();
      field = key;
      continue;
    }
    if (cur && field && line.trim() && !/^\s*-{3,}\s*$/.test(line)) cur.fields[field] = `${cur.fields[field]}\n${plain(line)}`.trim();
    else if (!line.trim()) field = field && cur?.fields[field] ? field : null;
  }
  for (const d of drafts) {
    const f = d.fields;
    const type = typeOf(f.type);
    const what = (f.what ?? "").trim();
    if (!Object.keys(f).length) continue; // a section heading, not an item
    if (!type || !what) {
      unreadable.push((d.title || what || f.type || "(an item with no title)").slice(0, 80));
      continue;
    }
    const title = d.title || what.split(/[.\n]/)[0].slice(0, 80);
    const exact = f["exact words"]?.trim() || null;
    entries.push({
      key: hash(`${type}|${norm(title)}|${norm(what).slice(0, 120)}`),
      title,
      type,
      what,
      exactWords: exact,
      numbers: f.numbers?.trim() || null,
      goodFor: f["good for"]?.trim() || null,
      status: statusOf(f["publish status"]),
      rawStatus: f["publish status"]?.trim() || null,
      ...readSource(f.source ?? null),
      hasPrice: hasPrice(what, exact, f.numbers),
    });
  }
  return { entries, unreadable };
}

const STOP = new Set("a an the of to in on for and or but with without is are was were be been being it its this that these those they them their there here from by as at into than then so if not no do does did done have has had can could should would will may might your you how what why when who which more less very really about over under just also get got make made one two three".split(" "));
/** The words a ladder is searched by: its topic, its format's name, what the keyword fetches and the head of its source material. */
export function searchWords(input: { topic: string; formatName: string; target?: string | null; source?: string | null }): string[] {
  const text = [input.topic, input.formatName, input.target ?? "", (input.source ?? "").slice(0, 400)].join(" ");
  const seen = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
    const word = w.replace(/^'+|'+$/g, "");
    if (word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word)) seen.add(word);
    if (seen.size >= 24) break;
  }
  return [...seen];
}
/** An FTS5 query from those words: each quoted (nothing in them is read as syntax), any of them matching. */
export const ftsQuery = (words: string[]): string => words.map((w) => `"${w.replace(/"/g, "")}"`).join(" OR ");

export type Candidate<T> = { item: T; score: number };
/**
 * The order the writer gets them in (rev 615, item 5): BM25's relevance (higher is better here), a story whose "Good for" names
 * the format first, and anything used in the last 10 ladders well behind anything fresh, so it comes only when nothing fresher fits.
 */
export function rank<T extends { key: string; goodFor?: string | null }>(cands: Candidate<T>[], opts: { formatName: string; usedRecently: Set<string>; take: number }): T[] {
  const fmt = norm(opts.formatName);
  return cands
    .map((c) => ({ c, s: c.score * (c.item.goodFor && fmt && norm(c.item.goodFor).includes(fmt) ? 1.5 : 1) * (opts.usedRecently.has(c.item.key) ? 0.2 : 1) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, opts.take)
    .map((x) => x.c.item);
}
export const TAKE = { teaching: 12, stories: 8 } as const;

/** The writer's block: each item with a short id it names back in MATERIAL_USED. Only ready stories, never a price, reach here. */
export function libraryBlock(teaching: Pick<TeachingEntry, "question" | "answer">[], stories: Pick<StoryItem, "type" | "title" | "what" | "exactWords" | "numbers">[]): string {
  if (!teaching.length && !stories.length) return "";
  const t = teaching.map((e, i) => `[T${i + 1}] Q: ${e.question}\nA: ${e.answer.slice(0, 1200)}`);
  const s = stories.map((e, i) => `[S${i + 1}] (${e.type.replace("_", " ")}) ${e.title}\nWhat: ${e.what.slice(0, 800)}${e.exactWords ? `\nExact words: ${e.exactWords}` : ""}${e.numbers ? `\nNumbers: ${e.numbers}` : ""}`);
  return [
    "FROM YOUR TEACHING LIBRARY AND STORY BANK (use what fits; quote Exact words exactly; numbers only as written; never a price; name the ids you used in MATERIAL_USED):",
    ...t,
    ...s,
    "After NOTES, add one more field, MATERIAL_USED, with the ids you drew on, comma separated (for example: T2, S1), or NONE.",
  ].join("\n\n");
}
/** "T2, S1, t5" → the ids the writer named, in order, once each; anything else ignored. */
export function usedIds(text: string): string[] {
  return [...new Set((text.match(/\b[TS]\d{1,2}\b/gi) ?? []).map((x) => x.toUpperCase()))];
}

/** "724" or a Fathom link's ?timestamp=724 → "12:04", for the Material used panel. */
export function momentOf(url: string | null): string | null {
  if (!url) return null;
  let t: number;
  try {
    t = Number(new URL(url).searchParams.get("timestamp"));
  } catch {
    return null;
  }
  if (!Number.isFinite(t) || t <= 0) return null;
  const m = Math.floor(t / 60);
  const h = Math.floor(m / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m % 60)}:${pad(Math.floor(t % 60))}` : `${m}:${pad(Math.floor(t % 60))}`;
}

/** Long words any story or rung may use without retelling anything: days, times, and everyday nouns and adverbs. */
const COMMON = new Set("monday tuesday wednesday thursday friday saturday sunday minutes minute seconds months already always before after because should something someone everyone nothing enough started different number through around another others without during though rather really little people friend friends client clients business things weekend morning evening tonight tomorrow yesterday second thirty twenty fifteen twelve eleven hundred thousand".split(" "));
/**
 * The origin story at most once (rev 615, item 5): the rungs that share four or more of its telling words (long, neither a stop
 * word nor an everyday one). Two or more such rungs outside the Origin Story format is a warning on the checklist.
 */
export function originRungs(origin: string | null | undefined, rungs: string[]): number[] {
  const tell = new Set((origin ?? "").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 6 && !STOP.has(w) && !COMMON.has(w)));
  if (tell.size < 4) return [];
  return rungs.flatMap((r, i) => {
    const words = new Set(r.toLowerCase().split(/[^\p{L}]+/u));
    let n = 0;
    for (const w of tell) if (words.has(w)) n++;
    return n >= 4 ? [i] : [];
  });
}
