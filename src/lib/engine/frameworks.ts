/**
 * Danno's frameworks (H-1262, plan H-1270): the how beside the principles' why. Pure: the reviewed library's markdown read
 * into entries, the slug a framework lives at, the price check, the three content shapes (post, reel, training) built from
 * the steps and the story, the writer's block and the ranking by a brief's words. Nothing here reads a file or the database.
 *
 * The file: one `##` heading per framework (its name), then `Field: value` lines in any order: Pillar, Rank, The idea, The
 * steps (a numbered list under it), When to use it, Common mistakes, Story or analogy, In Danno's words, Source (call, date,
 * a Fathom link), Content angles, Evolution, Status, Borrowed from. Read tolerantly, like the story bank: what can't be read
 * is counted by name, never guessed at. A framework needs a name, an idea and at least one step.
 */
import { createHash } from "node:crypto";
import { hasPrice, readSource } from "./teaching";

export type FrameworkEntry = {
  slug: string;
  name: string;
  pillar: string | null;
  rank: string | null;
  idea: string;
  steps: string[];
  whenToUse: string | null;
  mistakes: string | null;
  story: string | null;
  exactWords: string | null;
  sourceCall: string | null;
  sourceDate: string | null;
  fathomUrl: string | null;
  contentAngles: string | null;
  borrowedFrom: string | null;
  evolution: string | null;
  rawStatus: string | null;
  hasPrice: boolean;
  digest: string;
};
export type ReadFrameworks = { entries: FrameworkEntry[]; unreadable: string[] };

/** The address a framework lives at: its name in lower-case letters, digits and dashes, at most 80 long. */
export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const plain = (line: string) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\*\*|__/g, "").replace(/^\s*[*_](?=\S)|(?<=\S)[*_]\s*$/g, "").trim();
const FIELD = /^(name|pillar|rank|the idea|idea|the steps|steps|when to use it|when to use|common mistakes|mistakes|story or analogy|story|analogy|in danno'?s words|exact words|source|content angles|evolution|status|borrowed from)\s*:\s*(.*)$/i;
const KEY: Record<string, string> = { "the idea": "idea", "the steps": "steps", "when to use": "when to use it", mistakes: "common mistakes", story: "story or analogy", analogy: "story or analogy", "in danno's words": "exact words", "in dannos words": "exact words" };
const keyOf = (raw: string) => {
  const k = raw.toLowerCase().replace(/’/g, "'");
  return KEY[k] ?? k;
};
const digestOf = (o: unknown) => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 24);

/** "1. Ask\n2. Listen" or "- Ask\n- Listen" or one line with "1) Ask 2) Listen" → ["Ask", "Listen"]. */
export function readSteps(raw: string | null | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1) {
    // One line, "1) Ask. 2) Listen.": split before each number that follows a space, then strip the numbers.
    const inline = lines[0].split(/\s+(?=\d+[.)]\s)/).map((part) => plain(part.replace(/^\d+[.)]\s*/, ""))).filter(Boolean);
    return inline.length ? inline : [];
  }
  const listed = lines.filter((l) => /^(?:[-*+]|\d+[.)])\s+/.test(l)).map(plain).filter(Boolean);
  return listed.length ? listed : lines.map(plain).filter(Boolean);
}

export function readFrameworks(text: string): ReadFrameworks {
  const entries: FrameworkEntry[] = [];
  const unreadable: string[] = [];
  type Draft = { title: string; fields: Record<string, string> };
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  let field: string | null = null;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const heading = line.match(/^#{2,4}\s+(.*)$/);
    if (heading) {
      cur = { title: plain(heading[1]).replace(/^\d+[.)]\s*/, ""), fields: {} };
      drafts.push(cur);
      field = null;
      continue;
    }
    const m = plain(line).match(FIELD);
    // A list line under Steps is a step, never a field, even when it starts with a word like "Story:".
    if (m && !(field === "steps" && /^\s*(?:[-*+]|\d+[.)])\s+/.test(line))) {
      const key = keyOf(m[1]);
      if (!cur || (key === "name" && cur.fields.name !== undefined)) {
        cur = { title: "", fields: {} };
        drafts.push(cur);
      }
      cur.fields[key] = m[2].trim();
      field = key;
      continue;
    }
    if (cur && field && line.trim() && !/^\s*-{3,}\s*$/.test(line)) cur.fields[field] = `${cur.fields[field]}\n${field === "steps" ? line.trim() : plain(line)}`.trim();
    else if (!line.trim() && field !== "steps") field = field && cur?.fields[field] ? field : null;
  }
  for (const d of drafts) {
    const f = d.fields;
    if (!Object.keys(f).length) continue; // a section heading, not a framework
    const name = (f.name ?? d.title).trim();
    const idea = (f.idea ?? "").trim();
    const steps = readSteps(f.steps);
    if (!name || !idea || !steps.length) {
      unreadable.push((name || idea || "(a framework with no name)").slice(0, 80));
      continue;
    }
    const story = f["story or analogy"]?.trim() || null;
    const exact = f["exact words"]?.trim() || null;
    const mistakes = f["common mistakes"]?.trim() || null;
    const whenToUse = f["when to use it"]?.trim() || null;
    const e: Omit<FrameworkEntry, "digest"> = {
      slug: slugOf(name),
      name,
      pillar: f.pillar?.trim() || null,
      rank: f.rank?.trim() || null,
      idea,
      steps,
      whenToUse,
      mistakes,
      story,
      exactWords: exact,
      ...readSource(f.source ?? null),
      contentAngles: f["content angles"]?.trim() || null,
      borrowedFrom: f["borrowed from"]?.trim() || null,
      evolution: f.evolution?.trim() || null,
      rawStatus: f.status?.trim() || null,
      hasPrice: hasPrice(idea, steps.join("\n"), whenToUse, mistakes, story, exact),
    };
    if (!e.slug) {
      unreadable.push(name.slice(0, 80));
      continue;
    }
    entries.push({ ...e, digest: digestOf([e.name, e.pillar, e.rank, e.idea, e.steps, e.whenToUse, e.mistakes, e.story, e.exactWords, e.sourceCall, e.sourceDate, e.fathomUrl, e.contentAngles, e.borrowedFrom, e.evolution, e.rawStatus]) });
  }
  return { entries, unreadable };
}

/* ───────── Content from a framework, rule-based so it works offline (the principles' pattern) ───────── */

export type FrameworkLike = Pick<FrameworkEntry, "name" | "idea" | "steps" | "whenToUse" | "mistakes" | "story" | "exactWords" | "borrowedFrom">;
const first = (s: string | null | undefined) => (s ?? "").trim().split(/(?<=[.!?])\s/)[0] ?? "";
const credit = (f: FrameworkLike) => (f.borrowedFrom ? ` (after ${f.borrowedFrom})` : "");

export function frameworkPost(f: FrameworkLike, voiceName = "me"): string {
  return [
    `${f.name}.`,
    "",
    f.story || f.idea,
    "",
    f.story ? f.idea : "",
    "",
    "Here's how it goes:",
    ...f.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    f.mistakes ? `The mistake most people make: ${first(f.mistakes)}` : "",
    "",
    f.exactWords ? `"${f.exactWords}"` : "",
    "",
    `This is ${f.name}${credit(f)}, one of the frameworks I teach.`,
    "",
    f.whenToUse ? `Use it ${first(f.whenToUse).replace(/^use (it )?(when|for|to)\s/i, (m) => m.replace(/^use (it )?/i, ""))}` : "Which step are you on right now?",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim()
    .replace(/\{voice\}/g, voiceName);
}

export function frameworkReel(f: FrameworkLike): string {
  const steps = f.steps.slice(0, 4);
  return [
    `HOOK (0–3s): "${f.name}." Say it flat. Pause.`,
    `PROBLEM (3–12s): ${f.mistakes ? first(f.mistakes) : `Most people skip the order. ${first(f.idea)}`}`,
    `THE STEPS (12–45s): ${steps.map((s, i) => `${i + 1}) ${first(s)}`).join(" ")}`,
    `PROOF (45–52s): ${f.story ? first(f.story) : first(f.idea)}`,
    `CTA (52–60s): Comment "${f.name.split(/\s+/)[0].toUpperCase()}" and I'll send you the whole framework${credit(f)}.`,
  ].join("\n\n");
}

export function frameworkTraining(f: FrameworkLike): string {
  return [
    `1. Name it (1 min): ${f.name}${credit(f)}. ${f.idea}`,
    `2. When it applies (1 min): ${f.whenToUse ?? "the moment they'll recognise from their own week."}`,
    `3. The steps (4 min): ${f.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}`,
    `4. The story (2 min): ${f.story ?? "Your own story of this framework at work."}`,
    `5. The mistake and the move (2 min): ${f.mistakes ?? "what goes wrong when a step is skipped"}. Then one step they take this week, and a question to the room.`,
  ].join("\n");
}

/* ───────── The ladder writer ───────── */

export const TAKE_FRAMEWORKS = 4;
const STOP = new Set("a an the of to in on for and or but with without is are was were be been being it its this that these those they them their there here from by as at into than then so if not no do does did done have has had can could should would will may might your you how what why when who which more less very really about over under just also get got make made one two three use used using step steps".split(" "));
const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)));

/** The published frameworks that share the most words with the brief, fresh before recently used, at most TAKE_FRAMEWORKS. */
export function rankFrameworks<T extends { id: string; name: string; idea: string; steps: string[]; whenToUse: string | null; pillar: string | null }>(rows: T[], briefWords: string[], usedRecently: Set<string>, take = TAKE_FRAMEWORKS): T[] {
  const want = new Set(briefWords.map((w) => w.toLowerCase()));
  if (!want.size) return [];
  return rows
    .map((r) => {
      const have = words([r.name, r.idea, r.steps.join(" "), r.whenToUse ?? "", r.pillar ?? ""].join(" "));
      let score = 0;
      for (const w of want) if (have.has(w)) score += 1;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => Number(usedRecently.has(a.r.id)) - Number(usedRecently.has(b.r.id)) || b.score - a.score || a.r.name.localeCompare(b.r.name))
    .slice(0, take)
    .map((x) => x.r);
}

/** The writer's block for frameworks, F1…: name, idea, steps and story; it names the ids back in MATERIAL_USED like T and S. */
export function frameworkBlock(rows: Pick<FrameworkEntry, "name" | "idea" | "steps" | "story" | "exactWords" | "borrowedFrom">[]): string[] {
  return rows.map((f, i) => `[F${i + 1}] Framework: ${f.name}${f.borrowedFrom ? ` (after ${f.borrowedFrom})` : ""}\nIdea: ${f.idea}\nSteps: ${f.steps.map((s, j) => `${j + 1}) ${s}`).join(" ").slice(0, 1200)}${f.story ? `\nStory: ${f.story.slice(0, 600)}` : ""}${f.exactWords ? `\nExact words: ${f.exactWords}` : ""}`);
}
