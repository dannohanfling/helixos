/**
 * The plaque's one line (H-306): what the Council Chamber's table shows for a turn or the recommendation. The AI writes a
 * headline with the answer; when it is missing (every answer saved before H-306) the text is cut at the first sentence end
 * under the cap, never mid-word, with an ellipsis only when a single sentence had to be cut. The full text is never shortened:
 * it stays in the discussion under the room, one tap away.
 */
export const HEADLINE_WORDS = 25;
/**
 * Where the plaque sits, % of the room: between the side chairs (their inner edges at 38.1 and 62.2), below the head chair's
 * statue (its box ends at 32.84) and above the front chairs (their boxes start at 52.97). H-433 asked for most of the table
 * top; wider than this covers the side statues, which are the seat buttons, so the plaque keeps this band and the whole
 * recommendation goes in the card under the scene (plaqueTextOf).
 */
export const PLAQUE_BOX = { l: 38.6, t: 33.5, w: 23, h: 19.2 };

/** The card under the scene (H-433): this many characters of the recommendation and its first step, at a sentence end. */
export const PLAQUE_CHARS = 400;

const sentencesOf = (t: string): string[] => t.split(/(?<=[.!?])\s+/).filter(Boolean);

/**
 * The recommendation as the card under the scene shows it (H-433): the whole recommendation and the first next step
 * ("Next: …"), up to about 400 characters, cut only at a sentence end; a single sentence longer than the cap is cut at a word
 * with an ellipsis, never mid-word. The full answer stays in the discussion below, one tap away.
 */
export function plaqueTextOf(recommendation: string, firstStep?: string | null, cap = PLAQUE_CHARS): string {
  const rec = (recommendation ?? "").trim();
  const step = (firstStep ?? "").trim();
  const full = step ? `${rec}${rec && !/[.!?]$/.test(rec) ? "." : ""} Next: ${step}${/[.!?]$/.test(step) ? "" : "."}`.trim() : rec;
  if (full.length <= cap) return full;
  const kept: string[] = [];
  for (const s of sentencesOf(full)) {
    if ([...kept, s].join(" ").length > cap) break;
    kept.push(s);
  }
  if (kept.length) return kept.join(" ");
  const out: string[] = [];
  for (const w of words(full)) {
    if ([...out, w].join(" ").length > cap - 1) break;
    out.push(w);
  }
  return `${out.join(" ").replace(/[,;:]+$/, "")}…`;
}

const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);

export function headlineOf(text: string, given?: string | null, cap = HEADLINE_WORDS): string {
  const g = (given ?? "").trim();
  if (g && words(g).length <= cap) return g;
  const t = (text ?? "").trim();
  if (!t) return "";
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const s of sentences) {
    if (words([...kept, s].join(" ")).length > cap) break;
    kept.push(s);
  }
  if (kept.length) return kept.join(" ");
  const cut = words(sentences[0]).slice(0, cap).join(" ").replace(/[,;:]+$/, "");
  return `${cut}…`;
}

/** The plaque's type size by the line's length: the longest lines step down, never past the floor the CSS sets. */
export function headlineSize(line: string): "l" | "m" | "s" {
  const n = line.length;
  return n <= 90 ? "l" : n <= 130 ? "m" : "s";
}
