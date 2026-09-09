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

/** The explanation a block shows: the claim, where it came from, and what to say instead. Never shown without all three. */
export function explainFabricated(matches: FabricatedMatch[]): string {
  return matches.map((m) => `"${m.entry.claim}" — ${m.entry.why} Say instead: ${m.entry.sayInstead}`).join("\n");
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

/** The note stored beside a stripped draft. */
export function stripNote(removed: { sentence: string; entry: BlacklistEntry }[]): string | null {
  if (!removed.length) return null;
  return removed.map((r) => `Removed "${r.sentence}": ${r.entry.why} Say instead: ${r.entry.sayInstead}`).join("\n");
}
