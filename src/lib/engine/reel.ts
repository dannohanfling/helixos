/**
 * Reel to Post (brief H-1948, plan H-1953): a member's reel, as its transcript, becomes a ready-to-post package written by
 * the same ladder writer in a "Reel" mode: three hooks (one picked), a caption, five rungs, a cover frame, on-screen text,
 * and "Before you post" flags. Saved as a ladder draft (format "reel"), checked by the same checklist with the reel's rules.
 * The voice is each member's own Essence (draft() adds it); the format rules here are the reel's, not a house voice.
 */
import type { LadderFormatKey, Parsed, Brief } from "./ladder";
import { parseRungs, sectionsOf, ladderTitle, keywordOf, looksLikeAPerson, REEL_FORMAT } from "./ladder";
import type { LadderProfile, LadderRung, Proof } from "@/db/schema";

export { REEL_FORMAT };
export const REEL: LadderFormatKey = "reel";
export const REEL_RUNGS = 5;
/** Reel rungs drip faster than a ladder's first hour (H-1948 note 6): all five inside about 25 minutes, the last one pinned. */
export const REEL_GAP_MINUTES = 5;

export type HookOption = { text: string; pick: boolean };
export const REEL_FLAG_KINDS = ["number", "person", "price", "dm", "hearing", "platform", "keyword"] as const;
export type ReelFlagKind = (typeof REEL_FLAG_KINDS)[number];
export type ReelFlag = { kind: ReelFlagKind; text: string; from: "code" | "writer" };
export type ReelParsed = Parsed & { hookOptions: HookOption[]; onScreen: string; writerFlags: ReelFlag[] };

export const REEL_FLAG_LABELS: Record<ReelFlagKind, string> = {
  number: "Number not in your proof",
  person: "Person not approved",
  price: "Price said on camera",
  dm: "What the DM must deliver",
  hearing: "Check this word",
  platform: "Platform claim",
  keyword: "Keyword",
};

/** The FORMAT section of the master block, for a reel: replaces the ladder's 9-11 rung skin. */
export function reelFormatSection(firstName: string): string {
  return `## THE FORMAT: A REEL
${firstName} filmed a reel. The transcript below is what they said on camera. You turn it into the post that goes with the reel: a caption and 5 numbered author comments called "rungs" that ${firstName} posts under it over about 25 minutes, the last one pinned.

CAPTION
- The picked hook on line 1
- One sentence per paragraph, a blank line between each
- Then: "The whole story is in the comments. Read them in order. 👇" (for a teaching reel: "The whole plan is in the comments. Read them in order. 👇")
- Then a save line
- Then ONE open-ended question, last
Never put the keyword in the caption.

RUNGS
- Exactly 5, numbered 1. to 5. on the same line as the first sentence
- 40–90 words each, a blank line between sentences
- "..." joins a setup and its turn where it fits
- Each ends with ONE short quotable line on its own line
- Steps inside a rung use 1) 2), never 1. 2.
- Shape: 1 the moment, 2 the problem or the edge, 3 the turn, 4 a how-to the reader can use today, 5 who it's for, plus the CTA
- The CTA is one line: "Comment KEYWORD and I'll send …". No "message me" fallback line: a reel never carries it.

WHAT YOU MAY USE
The transcript is the source. Numbers, results, prices and people's names said on camera go in the copy ONLY when they are on the verified stats or approved testimonials below; otherwise leave them out and list them under FLAGS. Never invent a testimonial, a number or a quote.`;
}

/** Section B for a reel: what comes back, every time. */
export function reelContract(): string {
  return `Return these fields, each on its own line as the field name in capitals followed by a colon, then the content on the following lines. Match the names exactly.

POST_NAME
The topic in a few plain words, as a title someone would scan for.

HOOKS
Three hook options, one per line. Each is two beats on one line joined with "...". Put (pick) after the strongest one.

CAPTION
The caption, as in THE FORMAT. Line 1 is the picked hook. Ends with one open-ended question. No keyword.

SUPPORTING_COMMENTS
Exactly 5 rungs. Start each with its number, "1. " to "5. ", on the same line as its first sentence. Separate rungs with --- on its own line.

DM_KEYWORD
The keyword, or NONE.

COVER
The cover frame: exactly two lines separated by " / ", ALL CAPS, with exactly ONE phrase marked (gold: PHRASE) on the number or the payoff word.

ON_SCREEN
3–6 words of on-screen text for the first 2–3 seconds.

FLAGS
One per line, only what applies, each starting with its kind in brackets:
[NUMBER] a number or result said on camera that isn't in the verified stats or approved testimonials (left out of the copy)
[PERSON] a person named on camera who isn't an approved testimonial (not named or quoted; told in the member's own words)
[PRICE] a price said on camera (left out)
[DM] what the keyword's DM must deliver, so the promise is kept
[HEARING] a word in the transcript that was likely misheard, and what it probably was
[PLATFORM] a platform claim that isn't true (for example, comment auto-replies can't run on a personal Facebook profile)
Write NONE when nothing applies.

NOTES
Anything the member must check before it goes live.`;
}

const REEL_FIELDS = ["POST_NAME", "HOOKS", "CAPTION", "SUPPORTING_COMMENTS", "DM_KEYWORD", "COVER", "ON_SCREEN", "FLAGS", "NOTES"] as const;

/** Section C for a reel: the transcript is the source; the keyword decides the CTA. */
export function reelInput(brief: Brief): string {
  const none = !brief.keyword || brief.keyword.toUpperCase() === "NONE";
  return [
    "FORMAT: Reel. Exactly 5 rungs.",
    `AUDIENCE: ${brief.audience === "cold" ? "cold business owners who don't know the member yet" : "warm audience who already follows the member"}`,
    `KEYWORD: ${none ? "NONE" : brief.keyword.toUpperCase()}`,
    none ? 'NO KEYWORD ON THIS POST, A HARD RULE: no keyword anywhere, no "comment" or "message me" call to action, no product pitch and no price. DM_KEYWORD is NONE. Rung 5 closes with a question.' : "",
    `TRANSCRIPT (what the member said on camera, or what they described when the reel has no talking):\n${(brief.sourceMaterial ?? "").trim()}`,
    brief.realNumbers?.trim() ? `REAL NUMBERS (use exactly, nothing else may be presented as real):\n${brief.realNumbers.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseHooks(text: string): HookOption[] {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const opts = lines.map((l) => ({ text: l.replace(/\s*\((?:pick|the pick|picked)\)\s*/i, " ").replace(/\s{2,}/g, " ").trim(), pick: /\((?:pick|the pick|picked)\)/i.test(l) }));
  if (opts.length && !opts.some((o) => o.pick)) opts[0].pick = true;
  let seen = false;
  return opts.map((o) => (o.pick && !seen ? ((seen = true), o) : { ...o, pick: false }));
}

export function parseWriterFlags(text: string): ReelFlag[] {
  const map: Record<string, ReelFlagKind> = { NUMBER: "number", PERSON: "person", PRICE: "price", DM: "dm", HEARING: "hearing", PLATFORM: "platform" };
  return text
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.match(/^\[([A-Z]+)\]\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m && map[m[1]]))
    .map((m) => ({ kind: map[m[1]], text: m[2].trim(), from: "writer" as const }));
}

export function parseReelOutput(text: string): ReelParsed {
  const s = sectionsOf(text, REEL_FIELDS);
  const hookOptions = parseHooks(s.HOOKS ?? "");
  const caption = (s.CAPTION ?? "").trim();
  const picked = hookOptions.find((h) => h.pick)?.text ?? caption.split("\n")[0]?.trim() ?? "";
  return {
    postName: ladderTitle((s.POST_NAME ?? "").split("\n")[0]),
    headline: (s.COVER ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join(" / ").replace(/\s*\/\s*\/\s*/g, " / "),
    altHeadlines: [],
    hook: picked,
    copy: caption,
    rungs: parseRungs(s.SUPPORTING_COMMENTS ?? ""),
    dmKeyword: (s.DM_KEYWORD ?? "").split("\n")[0]?.trim() ?? "",
    carousel: [],
    igCaption: caption,
    threadsChain: [],
    screenshotText: "",
    notes: s.NOTES ?? "",
    materialUsed: [],
    hookOptions,
    onScreen: (s.ON_SCREEN ?? "").split("\n")[0]?.trim() ?? "",
    writerFlags: /^\s*NONE\s*$/i.test(s.FLAGS ?? "") ? [] : parseWriterFlags(s.FLAGS ?? ""),
  };
}

/** The skeleton without an AI key: the right shape, every blank marked, so the checklist keeps it from going live half-done. */
export function reelScaffold(brief: Brief, profile: LadderProfile | null): ReelParsed {
  const keyword = brief.keyword && brief.keyword.toUpperCase() !== "NONE" ? brief.keyword.toUpperCase() : "";
  const labels = ["THE MOMENT", "THE PROBLEM OR THE EDGE", "THE TURN", "A HOW-TO FOR TODAY", "WHO IT'S FOR, AND THE CTA"];
  const k = keywordOf(profile, keyword);
  const cta = keyword ? `Comment ${keyword} and I'll ${k?.target?.kind === "conversation" ? "message you" : "send you the link"}.` : "[CLOSING QUESTION]?";
  const rungs: LadderRung[] = labels.map((label, i) => ({ n: i + 1, body: i === 4 ? `[WHO THIS IS FOR]\n${cta}\n[QUOTABLE LINE]` : `[RUNG ${i + 1} · ${label}]\n[40–90 WORDS. A BLANK LINE BETWEEN SENTENCES.]\n[QUOTABLE LINE]` }));
  const topic = brief.topic.trim();
  return {
    postName: topic,
    headline: "[FIRST LINE OF THE COVER] / [SECOND LINE] (gold: [PAYOFF WORD])",
    altHeadlines: [],
    hook: "[HOOK BEAT ONE]... [BEAT TWO]",
    copy: "[HOOK BEAT ONE]... [BEAT TWO]\n\n[ONE SENTENCE]\n\n[ONE SENTENCE]\n\nThe whole story is in the comments. Read them in order. 👇\n\nSave this for the day you need it.\n\n[ONE OPEN QUESTION]?",
    rungs,
    dmKeyword: keyword || "NONE",
    carousel: [],
    igCaption: "",
    threadsChain: [],
    screenshotText: "",
    notes: "Skeleton only (Claude drafting isn't configured). Fill every [BRACKET] from your transcript.",
    materialUsed: [],
    hookOptions: [
      { text: "[HOOK OPTION ONE]... [BEAT TWO]", pick: true },
      { text: "[HOOK OPTION TWO]... [BEAT TWO]", pick: false },
      { text: "[HOOK OPTION THREE]... [BEAT TWO]", pick: false },
    ],
    onScreen: "[3–6 WORDS FOR THE FIRST SECONDS]",
    writerFlags: [],
  };
}

/* ───────────── Flags found by code, from the transcript ───────────── */

const NUMBER_CLAIM = /\b(?:doubled|tripled|quadrupled|halved|10x(?:ed)?|\d+(?:[.,]\d+)?\s*(?:%|percent|x\b|times\b|k\b|clients?\b|leads?\b|sales\b|calls?\b|pounds?\b|lbs?\b|members?\b|students?\b|people\b|show-?ups?\b|bookings?\b|followers?\b))[^.?!\n]{0,40}/gi;
const PRICE = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|per month|a month|\/mo))?/g;
const NAMED_PERSON = /\b(?:my (?:client|customer|student|member|friend|coach|buddy)|(?:a |one )?(?:client|customer|student|member)(?: of mine)?|named|called)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/g;
const PLATFORM_CLAIM = /\b(?:auto[- ]?(?:reply|replies|responder|dm|dms)|bot|automation)\b[^.?!\n]{0,80}\bpersonal (?:facebook )?(?:profile|page|account)\b|\bpersonal (?:facebook )?(?:profile|page|account)\b[^.?!\n]{0,80}\b(?:auto[- ]?(?:reply|replies|responder|dm|dms)|bot|automation)\b/i;
const SPOKEN_KEYWORD = /\bcomment\s+["“]?([A-Za-z][A-Za-z0-9]{2,})["”]?/i;

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9%$ ]+/g, " ").replace(/\s+/g, " ").trim();

/** The keyword said on camera ("comment SYSTEM"), and whether it is one of the member's keywords. */
export function spokenKeyword(transcript: string, profile: Pick<LadderProfile, "keywords"> | null): { keyword: string; onFacts: boolean } | null {
  const m = transcript.match(SPOKEN_KEYWORD);
  if (!m) return null;
  const word = m[1].toUpperCase();
  if (["BELOW", "DOWN", "HERE", "THIS", "THAT", "AND", "WITH", "YOUR", "WHAT", "IF"].includes(word)) return null;
  return { keyword: word, onFacts: Boolean(keywordOf(profile, word)) };
}

/**
 * What the code finds in the transcript before anything is written (H-1948 test cases 4-6): numbers and results not in the
 * verified stats or approved proof, prices, people named who aren't approved, an untrue platform claim, and the keyword said on
 * camera when it isn't on Ladder facts. The writer adds its own (what the DM must deliver, likely mishearings).
 */
export function reelFlags(transcript: string, profile: LadderProfile | null, proofs: Pick<Proof, "status" | "who" | "name" | "shortVersion" | "resultAfter" | "longVersion" | "punchline" | "quote">[]): ReelFlag[] {
  const flags: ReelFlag[] = [];
  const approved = proofs.filter((p) => p.status === "approved");
  const known = norm([...(profile?.verifiedStats ?? []).map((s) => s.stat), ...approved.flatMap((p) => [p.shortVersion, p.resultAfter, p.longVersion, p.punchline, p.quote])].filter(Boolean).join(" \n "));
  const seen = new Set<string>();
  for (const m of transcript.matchAll(NUMBER_CLAIM)) {
    const said = m[0].trim().replace(/[,;:]$/, "");
    const key = norm(said);
    if (!key || seen.has(key) || known.includes(key)) continue;
    seen.add(key);
    flags.push({ kind: "number", text: `You said "${said}" on camera. It isn't in your verified stats or approved proof, so it's left out of the copy.`, from: "code" });
  }
  const prices = Array.from(new Set(Array.from(transcript.matchAll(PRICE)).map((m) => m[0].trim())));
  if (prices.length) flags.push({ kind: "price", text: `You said ${prices.map((p) => `"${p}"`).join(", ")} on camera. Prices are left out of the copy unless you add them yourself.`, from: "code" });
  const names = new Set(approved.flatMap((p) => [p.who, p.name]).filter(Boolean).map((n) => String(n).trim().toLowerCase().split(/\s+/)[0]));
  const people = new Set<string>();
  for (const m of transcript.matchAll(NAMED_PERSON)) {
    const who = m[1].trim();
    if (!looksLikeAPerson(who) || names.has(who.toLowerCase().split(/\s+/)[0]) || people.has(who)) continue;
    people.add(who);
    flags.push({ kind: "person", text: `You named ${who} on camera. ${who} isn't an approved testimonial in your Proof Bank, so the story is told without the name or a quote.`, from: "code" });
  }
  if (PLATFORM_CLAIM.test(transcript)) flags.push({ kind: "platform", text: "The reel talks about automatic replies on a personal profile. Comment auto-replies can't run on a personal Facebook profile; check what you promise.", from: "code" });
  const spoken = spokenKeyword(transcript, profile);
  if (spoken && !spoken.onFacts) flags.push({ kind: "keyword", text: `You said "comment ${spoken.keyword}" on camera, but ${spoken.keyword} isn't one of your keywords on Ladder facts. Add it there, or pick another keyword.`, from: "code" });
  return flags;
}

/** The code's flags first, then the writer's that say something new. */
export function mergeFlags(code: ReelFlag[], writer: ReelFlag[]): ReelFlag[] {
  const out = [...code];
  for (const w of writer) if (!out.some((c) => c.kind === w.kind && norm(c.text).includes(norm(w.text).slice(0, 24)))) out.push(w);
  return out;
}

/** A short topic from the transcript's first sentence, when the member didn't give one. */
export function topicFromTranscript(transcript: string): string {
  const first = transcript.replace(/\s+/g, " ").trim().split(/(?<=[.?!])\s/)[0] ?? "";
  const words = first.split(" ").slice(0, 12).join(" ");
  return (words.length > 90 ? words.slice(0, 90) : words).replace(/[.?!,;:]+$/, "") || "A reel";
}

/** Too few words for the reel's length: likely silent or music only (H-1948 test case 3). */
export function looksSilent(transcript: string): boolean {
  return transcript.trim().split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w)).length < 15;
}
