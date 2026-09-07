/**
 * Content ladders ("skins"): a sparse post body plus 9–11 numbered author comments the client posts themselves over the first hour.
 * Pure and deterministic. Builds the generation prompt from a client's own facts, parses what comes back, scaffolds a skeleton
 * when Claude isn't configured, and runs the pre-publish checklist. Nothing here touches the database.
 */
import type { Ladder, LadderProfile, LadderRung, Proof } from "@/db/schema";
import { LADDER_FORMAT_KEYS } from "@/db/schema";

export type LadderFormatKey = (typeof LADDER_FORMAT_KEYS)[number];

export type LadderFormat = {
  key: LadderFormatKey;
  name: string;
  oneLiner: string;
  /** Rung-by-rung instructions the model (and the scaffold) follow. */
  structure: string;
  /** How the post body opens, when the format dictates it. */
  bodyOpening?: string;
  /** Formats that must refuse rather than invent. */
  stopRule?: string;
  /** Formats that prefer a specific keyword route. */
  route?: "default" | "community";
  /** Screenshot posts carry their own text instead of a designed graphic. */
  noGraphic?: boolean;
};

export const LADDER_FORMATS: LadderFormat[] = [
  { key: "loss_rebuild", name: "Loss / Rebuild", oneLiner: "\"If I lost it all tomorrow.\" A timeline of exactly what you'd do.", structure: "Rungs 3–7 are a timeline: day 1, day 2, day 3, day 7, week 2. Each is one concrete move.", bodyOpening: "Open the body with a negation stack: three things you would NOT do." },
  { key: "method_resource", name: "Method / Resource", oneLiner: "A specific outcome reached with free or near-free means.", structure: "Rungs 3–7 are five moves in order. At least two must need no tool at all." },
  { key: "milestone", name: "Milestone", oneLiner: "A revenue number reverse-engineered until it feels small.", structure: "Rung 3 does THE MATH FIRST. Every figure must reconcile if a reader checks it. Hypotheticals are marked illustrative." },
  { key: "authority_anchor", name: "Authority Anchor", oneLiner: "Borrowed credibility plus a curation bridge.", structure: "Quote verbatim with source and date. Never imply endorsement. Rung 3 lists 4–6 genuinely free, verifiable resources. Rung 7 is the bridge: free resources teach WHAT; the gap is doing it daily.", stopRule: "If the quote cannot be verified to a primary source, refuse to write the post and say so." },
  { key: "tool_stack", name: "Tool Stack", oneLiner: "One tool per rung with real prices. Your offer is last, as the engine.", structure: "One tool per rung with its real price. At least 3 must be free or have a real free tier. The client's own product comes LAST, positioned as the engine, not the star. Write [VERIFY PRICE] rather than guessing." },
  { key: "mistakes", name: "Mistakes Ladder", oneLiner: "Five mistakes you actually made. Confess, don't lecture.", structure: "Rungs 1–5 are mistakes the client actually made. \"I did this\" beats \"you're doing this\". Rungs 6–8 are what fixed them." },
  { key: "screenshot", name: "Screenshot Post", oneLiner: "No graphic. The image is the text.", structure: "Also return SCREENSHOT_TEXT: 80–150 words of standalone text that becomes the image. Then a shorter ladder of 8–10 rungs.", bodyOpening: "Open the body casually: \"Wrote this out for a client this morning.\"", noGraphic: true },
  { key: "objection", name: "Objection Ladder", oneLiner: "Five objections in quotes with honest answers.", structure: "Rungs 1–5 are objections in quotes, each with an honest answer. Rung 9 concedes when the objection is RIGHT. Never mock an objection." },
  { key: "numbers_teardown", name: "Numbers Teardown", oneLiner: "One real metric per rung against the benchmarks.", structure: "One metric per rung, compared to the verified benchmarks. Give away the tracking method completely.", stopRule: "If no real data is supplied, write [NUMBERS PLACEHOLDER] and state that the post cannot go live." },
  { key: "bait_correct", name: "Bait and Correct", oneLiner: "An absurd claim, dismantled in rung 1.", structure: "Open with a deliberately absurd claim. Rung 1 dismantles it. Rung 2 defines the thing plainly. Rung 4 is \"give it a job, not a vibe\" with a bad instruction and a real one side by side." },
  { key: "community", name: "Community Ladder", oneLiner: "\"Six figures is an audience. Seven is a community.\"", structure: "Rung 2 is the origin story. Rung 7 is \"use names\". The rest are how you build a room, not a following.", route: "community" },
  { key: "origin_story", name: "Origin Story", oneLiner: "The past IS the credential.", structure: "Rung 8 is THE TRANSLATION: each old play mapped to the reader's business today. Include one rung on what does NOT transfer; that admission makes the rest believable." },
  { key: "roadmap", name: "Roadmap", oneLiner: "Day blocks that overlap, like a real plan.", structure: "Each rung is a phase with day ranges. Phases may overlap (Days 13–20 alongside Days 10–20). It reads as a real plan, not a tidy sequence." },
];

export const formatFor = (key: string): LadderFormat => LADDER_FORMATS.find((f) => f.key === key) ?? LADDER_FORMATS[1];

/** Phrases the spec bans for everyone. A client's profile adds their own (name puns, hype they've been told to drop). */
export const DEFAULT_BANNED = ["but here's the real magic", "here's the real magic", "this isn't just about", "isn't just about", "game changer", "game-changer", "secret sauce"];
const REVENUE_GUARANTEE = /\b(guarantee[ds]?|sure[- ]fire|sure thing|can't fail|cannot fail|will make you \$|risk[- ]free income)\b/i;
const FAKE_SCARCITY = /\b(only \d+ spots?|spots? left|seats? left|closing soon|last chance|doors close|ends tonight|limited time)\b/i;
const PLACEHOLDER = /\[(?:[A-Z][A-Z0-9 _'/-]*|verify price|numbers placeholder|proof placeholder|placeholder)\]/;
const COMMENT_BAIT = /\b[Cc]omment\s+["“]?[A-Z]{3,}["”]?\b/;

export type Brief = { format: LadderFormatKey; topic: string; audience: "warm" | "cold"; keyword: string; sourceMaterial?: string | null; realNumbers?: string | null };
export type Member = { name: string; businessName?: string | null; bigPromise?: string | null; brandVoice?: string | null };

export function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
export function lastLine(text: string): string {
  const ls = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return ls[ls.length - 1] ?? "";
}

/* ───────────── The generation prompt: master block + output contract + per-post input ───────────── */

function testimonialLines(proofs: Proof[]): string[] {
  return proofs
    .filter((p) => p.status === "approved")
    .map((p) => {
      const quote = p.shortVersion ?? p.resultAfter ?? p.punchline ?? "";
      return quote ? `- ${p.who ?? p.name}: "${quote.replace(/^"|"$/g, "")}"` : "";
    })
    .filter(Boolean);
}

/** Section A, adapted: the same rules, written from this client's facts instead of Danno's. */
export function masterBlock(profile: LadderProfile | null, proofs: Proof[], member: Member): string {
  const keywords = (profile?.keywords ?? []).filter((k) => k.keyword);
  const stats = (profile?.verifiedStats ?? []).filter((s) => s.stat);
  const banned = [...DEFAULT_BANNED, ...(profile?.bannedPhrases ?? [])];
  const tms = testimonialLines(proofs);
  const product = profile?.productName?.trim() || "the offer";
  return [
    `You are writing social content for ${member.name}${member.businessName ? `, ${member.businessName}` : ""}.${member.bigPromise ? ` Their promise: ${member.bigPromise}` : ""}`,
    `## THE FORMAT
A "skin" is a complete post package: a designed graphic, a sparse post body, and 9–11 numbered author comments called "rungs" that ${member.name.split(" ")[0]} posts themselves, one every 3–6 minutes over the first hour.

POST BODY
- Hook: 2–5 short lines
- Then: "The whole plan is in the comments. Read them in order. 👇"
- Then a save line
- Then ONE open-ended question
Never put "comment [KEYWORD]" in the post body. Meta classifies comment-keyword prompts as engagement bait and demotes them. An open question is exempt and earns better reach. The keyword belongs in the final rung, where it reads as fulfilment for someone who already read the whole thread.

RUNGS
- Numbered 1–11 (or fewer where the material doesn't support eleven)
- 40–90 words each
- Each ends with ONE short quotable line on its own line
- Standard shape: pain → origin → five value rungs → honest math → proof → who-it's-not-for → CTA`,
    `## VOICE — NON-NEGOTIABLE
- 4th-grade reading level. Sentences average 5–7 words.
- Line break between every sentence or short thought.
- Plain language. No jargon. No hype.${member.brandVoice ? `\n- Brand voice: ${member.brandVoice}` : ""}
- NO manufactured urgency. NO fake scarcity.
- ${profile?.scarcityLine?.trim() ? `The ONLY permitted scarcity, verbatim: "${profile.scarcityLine.trim()}"` : "No scarcity line of any kind. There is no permitted one for this client."}
- BANNED: ${banned.map((b) => `"${b}"`).join(", ")}, any hypey close.
- No contempt. Never mock any group. Polarize on readiness, never on intelligence.
- Every number is true, or marked "(Illustrative. Your numbers will differ.)"
- NEVER invent a testimonial.`,
    `## THE WORTH-IT TEST
A reader who never buys must still walk away with a usable system. If a rung only makes sense as setup for the pitch, rewrite it.`,
    `## CLAIMS DISCIPLINE — HARD RULES
1. NO REVENUE GUARANTEES. Never "sure fire", "guaranteed", or any phrasing where a tool or method produces a specific income. Revenue figures appear ONLY as arithmetic the reader can follow, always marked illustrative.
2. TOOLS ENABLE. THEY DO NOT EARN. No tool generates leads or money; content, offers and people do. Say what a tool catches, speeds up or removes, never what it "generates".
3. CLIENT COUNTS ARE EXACT. One client at a price point is one. Never imply a portfolio.
4. COMPANY REVENUE ≠ PERSONAL INCOME. Say precisely whose number it is.
5. IF A QUOTE CAN'T BE VERIFIED TO A PRIMARY SOURCE, REFUSE TO WRITE THE POST. Say so rather than paraphrasing.
6. IF REAL DATA ISN'T SUPPLIED FOR A NUMBERS POST, WRITE [NUMBERS PLACEHOLDER] AND SAY THE POST CANNOT GO LIVE. Never invent figures.${profile?.claimsRules?.trim() ? `\n7. CLIENT-SPECIFIC: ${profile.claimsRules.trim()}` : ""}`,
    `## PRODUCT
${product}${profile?.productPitch ? `. ${profile.productPitch}` : ""}${profile?.priceLine ? `\nPrice: ${profile.priceLine}` : ""}${profile?.trialLine ? `\nTrial / entry: ${profile.trialLine}` : ""}
Sell methodology and transformation, never program names.`,
    stats.length
      ? `## VERIFIED STATS — USE ONLY THESE\n${stats.map((s) => `- ${s.stat}${s.source ? ` (${s.source})` : ""}`).join("\n")}\nAny other statistic is off limits. Write [STAT PLACEHOLDER] rather than inventing or half-remembering one.`
      : `## STATS\nNo verified stats are on file for this client. Do not cite any statistic. Write [STAT PLACEHOLDER] where one would help.`,
    tms.length
      ? `## APPROVED TESTIMONIALS — PERMISSION GRANTED\nUse verbatim. First name + last initial.\n${tms.join("\n")}\nAnyone not on this list requires permission first. Write [PROOF PLACEHOLDER] rather than inventing.`
      : `## TESTIMONIALS\nNone are approved yet. Write [PROOF PLACEHOLDER] where a testimonial belongs. Never invent one.`,
    `## KEYWORD ROUTING\n${keywords.length ? keywords.map((k) => `- ${k.keyword} — ${k.use}`).join("\n") : "- (no keywords set up)"}\n- NONE — pure trust/story posts close with a question instead. Pitching at the end of a personal story breaks it.`,
    profile?.originStory?.trim() ? `## ORIGIN STORY (recurring source material)\n${profile.originStory.trim()}${profile.positioningLine ? `\nPositioning line: ${profile.positioningLine}` : ""}\nKeep the odd specific details. They're what make it feel lived rather than constructed.` : "",
    `## CTA — FINAL RUNG ONLY
Recap the system in short lines. Then the price and entry terms exactly as given above. ${profile?.scarcityLine?.trim() ? "Then the permitted scarcity line verbatim. " : ""}Then "Comment [KEYWORD] and I'll send you the link." Then "If nothing happens, message me [KEYWORD]." Then one closing quotable line. When the keyword is NONE, close with a question instead of a pitch.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const OUTPUT_FIELDS = ["POST_NAME", "HEADLINE", "ALT_HEADLINES", "HOOK", "COPY", "SUPPORTING_COMMENTS", "DM_KEYWORD", "IG_CAROUSEL", "IG_CAPTION", "THREADS_CHAIN", "SCREENSHOT_TEXT", "NOTES"] as const;

/** Section B: what comes back, every time. */
export function outputContract(): string {
  return `Return these fields, each on its own line as the field name in capitals followed by a colon, then the content on the following lines. Match the names exactly.

POST_NAME
Format: "SKIN — [Format] — [short descriptor]"

HEADLINE
8–14 words. ALL CAPS. Exactly TWO lines separated by " / ". Mark ONE phrase for gold with (gold: PHRASE). Never strand a single word on the last line. Gold goes on the number or the payoff word, never a vague phrase.

ALT_HEADLINES
1–2 alternatives, one per line, same rules.

HOOK
One sentence. The opening line of the post body.

COPY
The post body only. Hook, "read them in order" line, save line, one open question. No keyword prompt.

SUPPORTING_COMMENTS
The rungs. Number each as "1." "2." etc. on its own first line. Separate rungs with --- on its own line. Each rung 40–90 words ending with ONE short quotable line on its own line.

DM_KEYWORD
The keyword, or NONE with a short reason.

IG_CAROUSEL
9 slides. Format: "SLIDE n — TEXT (gold: PHRASE)". Slide 1 is the headline plus "+ SWIPE →". Slides 2–8 are rungs compressed to one or two lines. Slide 9 is "(solid black) COMMENT [KEYWORD]..." or the closing question when there is no keyword.

IG_CAPTION
Under 2,200 characters. Hook, then the 4–5 strongest rungs compressed with **bolded lead-ins**, then the CTA.

THREADS_CHAIN
6–8 posts, each under 500 characters, numbered "1/" "2/" etc., one per line block separated by --- on its own line.

SCREENSHOT_TEXT
Only for the Screenshot format: 80–150 words of standalone text. Otherwise omit.

NOTES
Accuracy or framing notes for this specific post: anything the client must verify before it goes live.`;
}

/** Section C: the per-post input. */
export function perPostInput(brief: Brief): string {
  const f = formatFor(brief.format);
  return [
    `FORMAT: ${f.name}. ${f.structure}${f.bodyOpening ? ` ${f.bodyOpening}` : ""}${f.stopRule ? ` STOP RULE: ${f.stopRule}` : ""}`,
    `TOPIC: ${brief.topic}`,
    `AUDIENCE: ${brief.audience === "cold" ? "cold business owners who don't know the client yet" : "warm audience who already follows the client"}`,
    `KEYWORD: ${brief.keyword || "NONE"}`,
    brief.sourceMaterial?.trim() ? `SOURCE MATERIAL:\n${brief.sourceMaterial.trim()}` : "",
    brief.realNumbers?.trim() ? `REAL NUMBERS (use exactly, nothing else may be presented as real):\n${brief.realNumbers.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ───────────── Parsing what comes back ───────────── */

export type Parsed = {
  postName: string;
  headline: string;
  altHeadlines: string[];
  hook: string;
  copy: string;
  rungs: LadderRung[];
  dmKeyword: string;
  carousel: string[];
  igCaption: string;
  threadsChain: string[];
  screenshotText: string;
  notes: string;
};

function sections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`^[ \\t]*\\**(${OUTPUT_FIELDS.join("|")})\\**[ \\t]*:?[ \\t]*(.*)$`, "gm");
  const hits: { key: string; start: number; end: number; inline: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) hits.push({ key: m[1], start: m.index, end: m.index + m[0].length, inline: m[2] });
  hits.forEach((h, i) => {
    const body = text.slice(h.end, hits[i + 1]?.start ?? text.length);
    out[h.key] = `${h.inline}\n${body}`.replace(/^\s*\n/, "").trim();
  });
  return out;
}

/** Splits rung text on --- lines (or on numbered lines when there are no dividers) and strips the numbering, escaped or not. */
export function parseRungs(text: string): LadderRung[] {
  const cleaned = text.replace(/\r/g, "").trim();
  if (!cleaned) return [];
  let chunks = cleaned.split(/^\s*-{3,}\s*$/m).map((c) => c.trim()).filter(Boolean);
  if (chunks.length <= 1) chunks = cleaned.split(/^(?=\s*\d{1,2}\\?[.)]\s)/m).map((c) => c.trim()).filter(Boolean);
  return chunks.map((c, i) => ({ n: i + 1, body: c.replace(/^\s*\d{1,2}\\?[.)]\s*/, "").trim() }));
}

const listLines = (text: string): string[] =>
  text
    .split(/^\s*-{3,}\s*$|\n(?=\s*(?:\d{1,2}\/|SLIDE\s*\d))/m)
    .map((c) => c.trim())
    .filter(Boolean);

export function parseLadderOutput(text: string): Parsed {
  const s = sections(text);
  return {
    postName: s.POST_NAME ?? "",
    headline: (s.HEADLINE ?? "").split("\n")[0]?.trim() ?? "",
    altHeadlines: (s.ALT_HEADLINES ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    hook: (s.HOOK ?? "").split("\n")[0]?.trim() ?? "",
    copy: s.COPY ?? "",
    rungs: parseRungs(s.SUPPORTING_COMMENTS ?? ""),
    dmKeyword: (s.DM_KEYWORD ?? "").split("\n")[0]?.trim() ?? "",
    carousel: listLines(s.IG_CAROUSEL ?? ""),
    igCaption: s.IG_CAPTION ?? "",
    threadsChain: listLines(s.THREADS_CHAIN ?? ""),
    screenshotText: s.SCREENSHOT_TEXT ?? "",
    notes: s.NOTES ?? "",
  };
}

/* ───────────── Scaffold: the skeleton the client fills when Claude isn't configured ───────────── */

const STANDARD_SHAPE = ["the pain, in one scene", "where this came from for you", "value move 1", "value move 2", "value move 3", "value move 4", "value move 5", "the honest math (mark it illustrative)", "proof: one approved testimonial, verbatim", "who this is NOT for", "the CTA"];

function rungLabels(format: LadderFormatKey): string[] {
  switch (format) {
    case "loss_rebuild":
      return ["the loss, plainly", "what you would NOT do", "day 1", "day 2", "day 3", "day 7", "week 2", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "method_resource":
      return ["the outcome", "why free beats fancy here", "move 1 (no tool)", "move 2 (no tool)", "move 3", "move 4", "move 5", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "milestone":
      return ["the number, said plainly", "why it felt impossible", "THE MATH FIRST: break the number down", "piece 1", "piece 2", "piece 3", "what to stop doing", "the reconciled total (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "authority_anchor":
      return ["the quote, verbatim, source and date", "why it matters for the reader", "4–6 free, verifiable resources", "what the resources teach", "what they don't", "the daily grind nobody mentions", "THE BRIDGE: free teaches WHAT; the gap is doing it daily", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "tool_stack":
      return ["tool 1 (free) — real price", "tool 2 (free) — real price", "tool 3 (free tier) — real price", "tool 4 — real price", "tool 5 — real price", "tool 6 — real price", "how they connect", "the honest math (illustrative)", "proof", "your product, LAST, as the engine", "the CTA"];
    case "mistakes":
      return ["mistake 1: I did this", "mistake 2: I did this", "mistake 3: I did this", "mistake 4: I did this", "mistake 5: I did this", "what fixed 1–2", "what fixed 3–5", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "screenshot":
      return ["the pain", "the origin", "move 1", "move 2", "move 3", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "objection":
      return ["objection 1 in quotes → honest answer", "objection 2 → honest answer", "objection 3 → honest answer", "objection 4 → honest answer", "objection 5 → honest answer", "what all five have in common", "the honest math (illustrative)", "proof", "the objection that is RIGHT — concede it", "who this is NOT for", "the CTA"];
    case "numbers_teardown":
      return ["metric 1 vs benchmark", "metric 2 vs benchmark", "metric 3 vs benchmark", "metric 4 vs benchmark", "metric 5 vs benchmark", "the tracking method, all of it", "what the numbers say to fix first", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "bait_correct":
      return ["dismantle the absurd claim", "define the thing plainly, no mystique", "what it actually does", "give it a job, not a vibe: bad instruction vs real one", "move 1", "move 2", "move 3", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "community":
      return ["six figures is an audience; seven is a community", "the origin story", "own your own list", "give people something worth sharing", "go where they already are", "run it on a rhythm", "use names", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    case "origin_story":
      return ["the scene", "the job nobody respected", "play 1", "play 2", "play 3", "play 4", "what does NOT transfer", "THE TRANSLATION: each play mapped to the reader's business", "proof", "who this is NOT for", "the CTA"];
    case "roadmap":
      return ["Days 1–3: the setup", "Days 3–7: first reps", "Days 7–14: the rhythm", "Days 10–20: the overlap phase", "Days 13–20: running alongside", "Days 20–30: the review", "what slips and how to catch it", "the honest math (illustrative)", "proof", "who this is NOT for", "the CTA"];
    default:
      return STANDARD_SHAPE;
  }
}

function ctaRung(profile: LadderProfile | null, keyword: string): string {
  if (!keyword || keyword.toUpperCase() === "NONE") return "Recap the system in three short lines.\nThen ask the reader one question about their own version of this.\n[CLOSING QUESTION]";
  const price = profile?.priceLine?.trim() || "[PRICE LINE]";
  const trial = profile?.trialLine?.trim() ? `\n${profile.trialLine.trim()}` : "";
  const scarcity = profile?.scarcityLine?.trim() ? `\n${profile.scarcityLine.trim()}` : "";
  return `Here's the whole system in short lines.\n[RECAP LINE 1]\n[RECAP LINE 2]\n[RECAP LINE 3]\n${price}${trial}${scarcity}\nComment ${keyword} and I'll send you the link.\nIf nothing happens, message me ${keyword}.\n[CLOSING QUOTABLE LINE]`;
}

/** A complete skeleton in the right shape, with every blank marked so the checklist keeps it from going live half-done. */
export function scaffold(brief: Brief, profile: LadderProfile | null, proofs: Proof[]): Parsed {
  const f = formatFor(brief.format);
  const labels = rungLabels(brief.format);
  const proof = proofs.find((p) => p.status === "approved");
  const proofLine = proof ? `${proof.who ?? proof.name}: "${(proof.shortVersion ?? proof.resultAfter ?? "").replace(/^"|"$/g, "")}"` : "[PROOF PLACEHOLDER]";
  const keyword = brief.keyword && brief.keyword.toUpperCase() !== "NONE" ? brief.keyword.toUpperCase() : "";
  const rungs: LadderRung[] = labels.map((label, i) => {
    const n = i + 1;
    if (label === "the CTA") return { n, body: ctaRung(profile, keyword) };
    if (label === "proof") return { n, body: `${proofLine}\n[ONE LINE ON WHAT THIS PROVES]\n[QUOTABLE LINE]` };
    return { n, body: `[RUNG ${n} · ${label.toUpperCase()}]\n[40–90 WORDS. ONE THOUGHT PER LINE.]\n[QUOTABLE LINE]` };
  });
  const opening = brief.format === "screenshot" ? "Wrote this out for a client this morning.\n" : brief.format === "loss_rebuild" ? "[I would NOT do X.]\n[I would NOT do Y.]\n[I would NOT do Z.]\n" : "";
  const topic = brief.topic.trim();
  return {
    postName: `SKIN — ${f.name} — ${topic.slice(0, 40)}`,
    headline: `[FIRST LINE OF HEADLINE] / [SECOND LINE] (gold: [PAYOFF WORD])`,
    altHeadlines: [],
    hook: `[HOOK: the first line about ${topic}]`,
    copy: `${opening}[HOOK LINE 1]\n[HOOK LINE 2]\n\nThe whole plan is in the comments. Read them in order. 👇\n\nSave this for the day you need it.\n\n[ONE OPEN QUESTION ABOUT ${topic.toUpperCase()}]?`,
    rungs,
    dmKeyword: keyword || "NONE",
    carousel: ["SLIDE 1 — [HEADLINE] + SWIPE →", ...[2, 3, 4, 5, 6, 7, 8].map((n) => `SLIDE ${n} — [RUNG ${n - 1} IN ONE LINE] (gold: [PHRASE])`), `SLIDE 9 — (solid black) ${keyword ? `COMMENT ${keyword}` : "[CLOSING QUESTION]"}`],
    igCaption: `[HOOK]\n\n**[LEAD-IN 1]** [compressed rung]\n**[LEAD-IN 2]** [compressed rung]\n**[LEAD-IN 3]** [compressed rung]\n**[LEAD-IN 4]** [compressed rung]\n\n${keyword ? `Comment ${keyword} and I'll send you the link.` : "[CLOSING QUESTION]"}`,
    threadsChain: [1, 2, 3, 4, 5, 6].map((n) => `${n}/ [${n === 1 ? "HOOK" : n === 6 ? "CTA OR QUESTION" : `RUNG ${n} COMPRESSED`}, under 500 characters]`),
    screenshotText: brief.format === "screenshot" ? "[80–150 WORDS OF STANDALONE TEXT THAT BECOMES THE IMAGE]" : "",
    notes: `Scaffold only (Claude drafting isn't configured). Fill every [BRACKET]. ${f.structure}${f.stopRule ? ` ${f.stopRule}` : ""}`,
  };
}

/* ───────────── Pre-publish checklist ───────────── */

export type Check = { key: string; label: string; ok: boolean; level: "fail" | "warn"; note: string };

type LadderLike = Pick<Ladder, "copy" | "headline" | "rungs" | "dmKeyword" | "igCaption" | "threadsChain" | "realNumbers" | "keyword" | "format">;

export function headlineParts(h: string): { lines: string[]; gold: string[]; text: string } {
  const gold = Array.from(h.matchAll(/\(gold:\s*([^)]+)\)/gi)).map((m) => m[1].trim());
  const text = h.replace(/\(gold:[^)]*\)/gi, "").trim();
  const lines = text.split(/\s*\/\s*|\n/).map((l) => l.trim()).filter(Boolean);
  return { lines, gold, text };
}

export function checklist(l: LadderLike, profile: LadderProfile | null, proofs: Proof[]): Check[] {
  const checks: Check[] = [];
  const add = (key: string, label: string, ok: boolean, note = "", level: "fail" | "warn" = "fail") => checks.push({ key, label, ok, level, note: ok ? "" : note });
  const rungs = l.rungs;
  const all = [l.copy, ...rungs.map((r) => r.body), l.igCaption, ...l.threadsChain, l.headline].join("\n");
  const keyword = l.keyword && l.keyword.toUpperCase() !== "NONE" ? l.keyword.toUpperCase() : "";
  const banned = [...DEFAULT_BANNED, ...(profile?.bannedPhrases ?? [])].map((b) => b.toLowerCase()).filter(Boolean);
  const lower = all.toLowerCase();

  // Post body
  add("question", "Post body ends in an open question, not a keyword", /\?\s*$/.test(lastLine(l.copy)), "The last line of the body must be a question.");
  add("bait", "No \"comment KEYWORD\" prompt in the body", !COMMENT_BAIT.test(l.copy), "Meta demotes comment-keyword prompts. Move it to the final rung.");
  add("order", "Body sends people to the comments in order", /read them in order/i.test(l.copy), "Add: \"The whole plan is in the comments. Read them in order. 👇\"", "warn");

  // Rungs
  add("count", `${rungs.length} rungs (5–11)`, rungs.length >= 5 && rungs.length <= 11, rungs.length ? "Aim for 9–11; never fewer than 5." : "No rungs yet.");
  const long = rungs.filter((r) => words(r.body) > 90).map((r) => r.n);
  const short = rungs.filter((r) => words(r.body) < 40).map((r) => r.n);
  add("length", "Every rung is 40–90 words", !long.length && !short.length, [long.length ? `Too long: ${long.join(", ")}` : "", short.length ? `Too short: ${short.join(", ")}` : ""].filter(Boolean).join(" · "), "warn");
  const noQuote = rungs.filter((r) => words(lastLine(r.body)) > 14).map((r) => r.n);
  add("quotable", "Each rung ends with one short quotable line", !noQuote.length, `Last line is too long to quote in rung ${noQuote.join(", ")}.`, "warn");
  const final = rungs[rungs.length - 1]?.body ?? "";
  if (keyword) {
    add("cta", `Final rung has "${keyword}" and the fallback line`, new RegExp(`comment\\s+${keyword}`, "i").test(final) && new RegExp(`message me\\s+${keyword}`, "i").test(final), `Final rung needs "Comment ${keyword} and I'll send you the link." and "If nothing happens, message me ${keyword}."`);
    add("keyword-once", "Keyword appears only in the final rung", !rungs.slice(0, -1).some((r) => new RegExp(`comment\\s+${keyword}`, "i").test(r.body)), "Earlier rungs prompt the keyword. Keep it for the fulfilment rung.", "warn");
  } else {
    add("cta", "No keyword: final rung closes with a question", /\?\s*$/.test(lastLine(final)) || /\?/.test(final), "Trust and story posts close with a question, not a pitch.");
  }

  // Claims discipline
  const hitBanned = banned.filter((b) => lower.includes(b));
  add("banned", "No banned phrases", !hitBanned.length, `Found: ${hitBanned.map((b) => `"${b}"`).join(", ")}`);
  const guarantee = all.match(REVENUE_GUARANTEE);
  add("guarantee", "No revenue guarantee anywhere", !guarantee, `Found "${guarantee?.[0]}". Revenue only ever appears as arithmetic marked illustrative.`);
  const scarcityHit = all.match(FAKE_SCARCITY);
  const permitted = profile?.scarcityLine?.trim().toLowerCase() ?? "";
  add("scarcity", "No fake scarcity or manufactured urgency", !scarcityHit || (Boolean(permitted) && lower.includes(permitted) && !all.replace(new RegExp(permitted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").match(FAKE_SCARCITY)), `Found "${scarcityHit?.[0]}". ${permitted ? "Only the permitted line, verbatim, is allowed." : "This client has no permitted scarcity line."}`);
  const generates = all.match(/\b(tool|bot|agent|software|app|automation|ai)\b[^.\n]{0,40}\bgenerat(es|e|ing)\b[^.\n]{0,20}\b(leads|clients|revenue|money|sales)\b/i);
  add("tools-earn", "Tools enable; they don't generate leads or money", !generates, `"${generates?.[0]}" claims a tool produces results. Tools catch, speed up or remove; people and offers produce.`);
  const money = rungs.filter((r) => /\$\s?\d[\d,]*/.test(r.body) && !/illustrative/i.test(r.body) && !(l.realNumbers ?? "").match(/\$\s?\d/) && !(profile?.priceLine ?? "").match(/\$\s?\d/) ).map((r) => r.n);
  add("illustrative", "Dollar figures are real numbers or marked illustrative", !money.length, `Rung ${money.join(", ")} has a $ figure that is neither in Real numbers nor marked "(Illustrative. Your numbers will differ.)"`, "warn");

  // Testimonials: a quoted line attributed to a name must be an approved proof, verbatim
  const approved = proofs.filter((p) => p.status === "approved").map((p) => [p.shortVersion, p.resultAfter, p.longVersion, p.punchline].filter(Boolean).map((t) => String(t).replace(/^"|"$/g, "").toLowerCase()));
  const attributed = Array.from(all.matchAll(/([A-Z][a-z]+(?: [A-Z]\.?)?):\s*["“]([^"”]{12,})["”]/g));
  const unapproved = attributed.filter(([, , quote]) => !approved.some((texts) => texts.some((t) => t.includes(quote.toLowerCase().trim()) || quote.toLowerCase().trim().includes(t)))).map(([, who]) => who);
  add("testimonials", "Every testimonial is approved and verbatim", !unapproved.length, `Not in the approved Proof Bank: ${Array.from(new Set(unapproved)).join(", ")}. Add it to Proof Bank and approve it, or write [PROOF PLACEHOLDER].`);

  // Placeholders and format stop rules
  const ph = all.match(PLACEHOLDER);
  add("placeholders", "No template brackets or placeholders left in", !ph, `Still has ${ph?.[0]}.`);
  if (l.format === "numbers_teardown") add("stop-numbers", "Numbers teardown has real data", Boolean(l.realNumbers?.trim()), "Add the real numbers. Without them this post cannot go live.");

  // Headline
  const h = headlineParts(l.headline);
  const wc = words(h.text);
  add("headline-lines", "Headline breaks into exactly two lines", h.lines.length === 2, `${h.lines.length} line(s). Separate the two lines with " / ".`);
  add("headline-words", `Headline is 8–14 words (${wc})`, wc >= 8 && wc <= 14, "Trim or extend it so it fills two big lines.", "warn");
  add("headline-gold", "Exactly one gold phrase, and it appears in the headline", h.gold.length === 1 && h.text.toUpperCase().includes(h.gold[0].toUpperCase()), h.gold.length === 1 ? "The gold phrase must be part of the headline text." : `${h.gold.length} gold markers. Mark one with (gold: PHRASE).`);
  add("headline-strand", "No single word stranded on the second line", h.lines.length !== 2 || words(h.lines[1]) > 1, "Rebalance the break so the second line has at least two words.", "warn");

  // Platform limits
  const overThreads = l.threadsChain.filter((t) => t.length > 500).length;
  add("threads", "Threads posts under 500 characters", !overThreads, `${overThreads} post(s) over 500. Warn, don't truncate.`);
  add("ig", `Instagram caption under 2,200 characters (${l.igCaption.length})`, l.igCaption.length <= 2200, "Cut a rung from the caption.");
  return checks;
}

export const readyToPost = (checks: Check[]) => checks.every((c) => c.ok || c.level === "warn");
/** The checks that stop a ladder going outward: fails only. A warn is advice; a draft is allowed to be unfinished. */
export const publishBlockers = (checks: Check[]) => checks.filter((c) => !c.ok && c.level === "fail");
export const checkScore = (checks: Check[]) => ({ pass: checks.filter((c) => c.ok).length, total: checks.length, fails: checks.filter((c) => !c.ok && c.level === "fail").length, warns: checks.filter((c) => !c.ok && c.level === "warn").length });

/* ───────────── Exports and hand-offs ───────────── */

/** Rungs as one block: numbers escaped as `1\.` so Airtable rich text doesn't renumber them, `---` between rungs for live copy-paste. */
export function rungsForAirtable(rungs: LadderRung[]): string {
  return rungs.map((r) => `${r.n}\\. ${r.body}`).join("\n---\n");
}
/** Plain numbering for editing and for posting. */
export function rungsPlain(rungs: LadderRung[]): string {
  return rungs.map((r) => `${r.n}. ${r.body}`).join("\n---\n");
}
export function threadsText(chain: string[]): string {
  return chain.join("\n\n");
}

/** What goes to the composer as channel bodies: Facebook gets the body, Instagram the caption, Threads the chain. */
export function channelBodies(l: Pick<Ladder, "copy" | "igCaption" | "threadsChain" | "hook">): { channel: "fb_personal" | "fb_page" | "instagram" | "threads"; body: string }[] {
  const body = l.copy.trim() || l.hook;
  return [
    { channel: "fb_personal", body },
    { channel: "fb_page", body },
    { channel: "instagram", body: l.igCaption.trim() || body },
    { channel: "threads", body: threadsText(l.threadsChain) || body },
  ];
}

/* ───────────── Cadence: two ladders a week, 72 hours apart, mid-week mornings, the author free for the first hour ───────────── */

export type CadenceNote = { ok: boolean; note: string };

/** Local wall-clock parts for an ISO instant in a timezone. */
function localParts(iso: string, tz: string): { weekday: number; hour: number } {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { weekday, hour: Number(parts.hour) % 24 };
}

export function cadenceNotes(proposedIso: string, tz: string, lastLaunchIso?: string | null): CadenceNote[] {
  const notes: CadenceNote[] = [];
  const { weekday, hour } = localParts(proposedIso, tz);
  notes.push({ ok: weekday >= 2 && weekday <= 4, note: weekday >= 2 && weekday <= 4 ? "Tuesday to Thursday: good." : "Ladders land best Tuesday, Wednesday or Thursday." });
  notes.push({ ok: hour >= 8 && hour <= 10, note: hour >= 8 && hour <= 10 ? "Morning slot: good." : "Aim for 8:30–9:30am your time so it lands late morning for the East Coast." });
  if (lastLaunchIso) {
    const hours = (new Date(proposedIso).getTime() - new Date(lastLaunchIso).getTime()) / 36e5;
    notes.push({ ok: hours >= 72, note: hours >= 72 ? `${Math.round(hours / 24)} days since the last ladder: good.` : `Only ${Math.round(hours)} hours since the last ladder. Keep 72 hours between them.` });
  }
  notes.push({ ok: true, note: "Be free for the first hour: every rung goes up inside it. A Facebook post is half-dead in about 90 minutes." });
  return notes;
}

/** Suggested gap between rungs during the live hour: 3–6 minutes, stretched across the rungs you have. */
export function rungGapMinutes(count: number): number {
  if (count <= 0) return 5;
  return Math.max(3, Math.min(6, Math.round(55 / count)));
}
