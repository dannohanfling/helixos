/**
 * The word filter on Colosseum wins (H-745, App Store guideline 1.2): one plain list of slurs and explicit terms, matched as
 * whole words, any case, before a win is saved. A match means the win isn't posted; the member rewords it. No AI, no guessing:
 * a word inside an innocent word ("class", "Scunthorpe", "therapist", "cocktail") is never a match. Coaches extend the list
 * here, in this one file. Covered by src/lib/engine/__tests__/word-filter.test.ts.
 */

/** Slurs against a group of people. */
const SLURS = [
  "nigger", "niggers", "nigga", "niggas",
  "faggot", "faggots", "fag", "fags",
  "dyke", "dykes", "tranny", "trannies",
  "kike", "kikes", "spic", "spics", "chink", "chinks", "gook", "gooks",
  "wetback", "wetbacks", "beaner", "beaners", "raghead", "ragheads", "towelhead", "towelheads",
  "retard", "retards", "retarded",
];

/** Sexually explicit words and the strongest swearing. */
const EXPLICIT = [
  "fuck", "fucks", "fucked", "fucker", "fuckers", "fucking", "motherfucker", "motherfuckers",
  "cunt", "cunts", "whore", "whores", "slut", "sluts", "pussy",
  "porn", "porno", "pornography", "blowjob", "blowjobs", "handjob", "handjobs", "cumshot", "dildo", "dildos",
  "rape", "raped", "rapist", "rapists",
];

export const BLOCKED_WORDS: readonly string[] = [...SLURS, ...EXPLICIT];

export const WIN_REFUSED = "That win can't be posted as written. Please reword it.";

// A whole word: no letter or digit right before or after it, in any script, so "spice" and "Scunthorpe" pass.
const PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${BLOCKED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** Whether the text holds a listed word as a whole word, any case. Never says which: the member just rewords it. */
export function hasBlockedWord(text: string): boolean {
  return PATTERN.test(text.normalize("NFKC"));
}
