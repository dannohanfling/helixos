/**
 * The fabricated-stat blacklist: claims that circulate in coaching and marketing with no study behind them. Danno's list to
 * edit (src/data/fabricated-stat-blacklist.json); the code only matches. Block on truth: a match blocks and explains, never a
 * bare refusal. Patterns are loose on purpose and matched case-insensitively; when a match is uncertain the answer is to
 * block and explain rather than let it through. `confidence` is for Danno's eye, not read here.
 */
import list from "@/data/fabricated-stat-blacklist.json";

export type BlacklistEntry = { id: string; pattern: string; claim: string; why: string; sayInstead: string; confidence: string };
export const BLACKLIST: BlacklistEntry[] = list as BlacklistEntry[];

const regexFor = (e: BlacklistEntry) => new RegExp(e.pattern, "i");

export type FabricatedMatch = { entry: BlacklistEntry; matched: string };

/** Every blacklisted claim the text touches, with the words that matched. */
export function findFabricated(text: string): FabricatedMatch[] {
  const out: FabricatedMatch[] = [];
  for (const entry of BLACKLIST) {
    const m = text.match(regexFor(entry));
    if (m) out.push({ entry, matched: m[0] });
  }
  return out;
}

export const QUOTE_NOTE = "This sentence is inside a quote. A quote is trimmed with an ellipsis or left out; it is never rewritten, and the block is not a judgement on the person who said it.";

const QUOTE_MARKS = /["“”«»]/g;

/**
 * Whether the matched words sit inside a quotation: between quotation marks in the text, or inside one of the known quotes
 * (an approved proof's words). A testimonial is verbatim or it does not exist, so the block says so rather than reading as
 * a verdict on the client's client.
 */
export function inQuote(text: string, matched: string, quotes: string[] = []): boolean {
  const at = text.toLowerCase().indexOf(matched.toLowerCase());
  if (at >= 0) {
    const before = (text.slice(0, at).match(QUOTE_MARKS) ?? []).length;
    if (before % 2 === 1) return true;
  }
  return quotes.some((q) => q && new RegExp(BLACKLIST.map((e) => e.pattern).join("|"), "i").test(q) && q.toLowerCase().includes(matched.toLowerCase()));
}

/**
 * What a block shows, three blocks and never one paragraph: the verdict ("doesn't hold up" is true for both confidence levels
 * and for claims that are not numbers, and says what the client needs to know: if anyone checks, they lose), the why, and the
 * replacement, the last two verbatim from the entry. With the text and any known quotes, a match inside a quotation adds the
 * quote line underneath. The wording of the frame is Danno's reviewer's; change it there, not here.
 */
export function explainFabricated(matches: FabricatedMatch[], context?: { text: string; quotes?: string[] }): string {
  return matches
    .map((m) => `This one doesn't hold up: "${m.entry.claim}"\n\n${m.entry.why}\n\nSay this instead: ${m.entry.sayInstead}${context && inQuote(context.text, m.matched, context.quotes) ? `\n\n${QUOTE_NOTE}` : ""}`)
    .join("\n\n");
}

const SENTENCE = /[^.!?\n]+[.!?]?(?:\s+|$)/g;

/**
 * Strips the sentences carrying a blacklisted claim from generated copy and says what went and why. Only for copy a model
 * wrote; a client's own words are blocked at the gate with the same explanation, never edited for them.
 */
export function stripFabricated(text: string): { text: string; removed: { sentence: string; entry: BlacklistEntry }[] } {
  const removed: { sentence: string; entry: BlacklistEntry }[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const parts = line.match(SENTENCE) ?? (line.trim() ? [line] : []);
    const keep = parts.filter((sentence) => {
      const hit = BLACKLIST.find((e) => regexFor(e).test(sentence));
      if (hit) removed.push({ sentence: sentence.trim(), entry: hit });
      return !hit;
    });
    kept.push(keep.join("").replace(/\s+$/, ""));
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/**
 * The note shown beside copy a model wrote and the app stripped: what happened, in the same three blocks as a block message,
 * the sentence, the why and the replacement. Lighter than a block: the client did not write it and it is already gone, so it
 * reports and corrects nobody. The frame is the reviewer's wording; change it here, nowhere else.
 */
export function stripNote(removed: { sentence: string; entry: BlacklistEntry }[]): string | null {
  if (!removed.length) return null;
  return removed.map((r) => `This one doesn't hold up, so it came out of the draft:\n\n"${r.sentence}"\n\n${r.entry.why}\n\nSay this instead: ${r.entry.sayInstead}`).join("\n\n");
}
