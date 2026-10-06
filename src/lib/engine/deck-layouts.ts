/**
 * Which layout a slide takes beyond headline and body (deck layouts brief, rev 502; order agreed at rev 535). Each rule reads
 * the slide's own words and where it came from, never a model's guess; nothing here draws. Pure.
 *
 * 1. Big number: a key point whose line carries one to three figures the coach can show (the slot rules' own detection: a
 *    currency amount, a percentage, or a count with its unit). A duration ("in 48 hours") is never the figure.
 * 3. Three cards: a slide built from the record that lists 2 to 4 parallel lines (the outcomes, who it is for and not for).
 * 11. From → To: a belief divider that has both its "From" and its "To".
 */
import { FIGURE } from "./deck-slot-rules";

export type BigNumber = { value: string; label: string };

const TIME = /\b(?:days?|weeks?|months?|hours?|minutes?)\b/i;
const NUMBER = /^[$£€]?\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM%])?/;
const tidy = (t: string) => t.replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "").replace(/\s{2,}/g, " ").trim();

/**
 * The figures a line carries, each as its number and the words that say what it counts. One figure: the label is the rest of
 * the line ("602" · "comments on my post in 48 hours"). Two or three: each label is the words after its number up to the next
 * figure or comma ("1,838" · "sent", "98.2%" · "opened"). Null when the line has none, or more than three.
 */
export function bigNumbers(line: string): BigNumber[] | null {
  const re = new RegExp(FIGURE.source, "gi");
  const found = [...line.matchAll(re)].filter((m) => !TIME.test(m[0]));
  if (!found.length || found.length > 3) return null;
  const spans = found.map((m) => {
    const value = (m[0].match(NUMBER)?.[0] ?? m[0]).trim();
    return { value, start: m.index!, valueEnd: m.index! + (m[0].match(NUMBER)?.[0].length ?? m[0].length) };
  });
  if (spans.length === 1) {
    const s = spans[0];
    // The words after the figure when they say what it counts ("602 · comments on my post"); otherwise the whole line, so the
    // label never reads with a hole where the number was ("We hit in launch revenue").
    const after = tidy(line.slice(s.valueEnd).replace(/[.!]$/, ""));
    const label = after.split(/\s+/).length >= 2 ? after : tidy(line.replace(/[.!]$/, ""));
    return [{ value: s.value, label }];
  }
  return spans.map((s, i) => {
    const end = i + 1 < spans.length ? spans[i + 1].start : line.length;
    const label = tidy(line.slice(s.valueEnd, end).split(/[,;]/)[0].replace(/\b(?:and|with|from|of)\s*$/i, "").replace(/[.!]$/, ""));
    return { value: s.value, label };
  });
}

/** The longest card line, in characters: past it a line wants a slide of its own, not a card. */
export const CARD_MAX = 90;

/** 2 to 4 lines a reader takes in side by side: none too long for a card, and none more than three times another's length. */
export function isCardList(lines: string[]): boolean {
  if (lines.length < 2 || lines.length > 4) return false;
  const lens = lines.map((l) => l.trim().length);
  return lens.every((n) => n > 0 && n <= CARD_MAX) && Math.max(...lens) <= 3 * Math.min(...lens);
}

/** A divider's "From" line, as the deck builds it (`From: …`); null when the divider announces only its "To". */
export const shiftFrom = (body: string[]): string | null => (body.length === 1 && body[0].startsWith("From: ") ? body[0].slice("From: ".length).trim() || null : null);
