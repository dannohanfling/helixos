/**
 * The plaque's one line (H-306): what the Council Chamber's table shows for a turn or the recommendation. The AI writes a
 * headline with the answer; when it is missing (every answer saved before H-306) the text is cut at the first sentence end
 * under the cap, never mid-word, with an ellipsis only when a single sentence had to be cut. The full text is never shortened:
 * it stays in the discussion under the room, one tap away.
 */
export const HEADLINE_WORDS = 25;
/** Where the plaque sits, % of the room: between the side chairs, below the head chair's statue, above the front chairs. */
export const PLAQUE_BOX = { l: 38.6, t: 34, w: 23, h: 18.5 };

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
