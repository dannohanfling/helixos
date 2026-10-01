/**
 * Which picture a slide asks for, read off its own words (deck visuals §3). Pure, rule-based, never generated: every "what"
 * is built from the slide's line and a fixed lead, so the Deck step's instruction says the thing the coach really has
 * ("a screenshot with “602 comments on my post” circled"), not one sentence for every slide.
 *
 * The rules, in order:
 *  1. A line that names a number with a unit, a percentage, a currency amount or a count ("602 comments", "98.2% opened",
 *     "$114,400", "400 leads in one hour") is a result the coach can show: a screenshot with that figure circled.
 *  2. A line that names a mechanism (framework, system, method, process, steps, map, model, funnel, pillars, blueprint,
 *     playbook) asks for the coach's own diagram of it.
 *  3. A line about before and after asks for the two photos side by side.
 *  4. A line about comments, DMs, messages, reviews or testimonials in the plural, with no single figure, asks for a wall
 *     of those screenshots.
 *  5. Anything else asks for nothing: a picture slot is suggested where the words name something to show, never by default.
 * Then the deck is spread: no more than two picture slots in a row (MAX_SLOT_RUN), the third in a run dropped, so a run of
 * eight origin beats no longer asks for eight photos. The cover and a testimonial (a proof's own photo) are never dropped.
 */
import type { Slot, SlotKind } from "./deck";

export const MAX_SLOT_RUN = 2;

const FIGURE = /(?:[$£€]\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM])?|\d[\d,]*(?:\.\d+)?\s?%|\b\d[\d,]*(?:\.\d+)?\s?(?:k|K)\b|\b\d[\d,]*\s+(?:comments?|leads?|subscribers?|sent|opened|clients?|calls?|sales?|booked|replies|signups?|sign-ups?|members?|views?|downloads?|emails?|DMs?|messages?|orders?|customers?|days?|weeks?|months?|hours?|minutes?)\b)/i;
const MECHANISM = /(?<![-\w])(framework|system|method|process|steps?|map|model|funnel|pillars?|blueprint|playbook|flywheel|loop|ladder)\b/i;
const BEFORE_AFTER = /\bbefore\b[^.]*\bafter\b|\bafter\b[^.]*\bbefore\b/i;
const WALL = /\b(comments|DMs|messages|reviews|testimonials|replies|screenshots)\b/i;

/** The shortest readable span around a figure: up to three words before it and three after, inside its sentence. */
export function figurePhrase(line: string): string | null {
  const m = FIGURE.exec(line);
  if (!m) return null;
  const sentence = line.split(/(?<=[.!?])\s+/).find((s) => s.includes(m[0])) ?? line;
  const idx = sentence.indexOf(m[0]);
  const before = sentence.slice(0, idx).trim().split(/\s+/).filter(Boolean).slice(-3).join(" ");
  const after = sentence.slice(idx + m[0].length).trim().split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  return [before, m[0], after].filter(Boolean).join(" ").replace(/[,;:]+$/, "").trim();
}

const quote = (t: string) => `“${t}”`;

/** The slot a line asks for, by the rules above, or null when its words name nothing to show. */
export function slotForLine(line: string): { kind: SlotKind; what: string } | null {
  const text = line.trim();
  if (!text) return null;
  const figure = figurePhrase(text);
  if (figure) return { kind: "screenshot_callout", what: `A screenshot with ${quote(figure)} circled.` };
  const mech = MECHANISM.exec(text);
  if (mech) return { kind: "diagram", what: `Your own diagram of the ${mech[1].toLowerCase()} this slide names.` };
  if (BEFORE_AFTER.test(text)) return { kind: "photo_pair", what: "Two photos side by side: before and after, as this slide says." };
  const wall = WALL.exec(text);
  if (wall) return { kind: "proof_wall", what: `A wall of your real ${wall[1].toLowerCase()}, the ones this slide is about.` };
  return null;
}

/** The cover's photo: the coach on stage or on a call, Danno's own example. */
export const COVER_WHAT = "A photo of you: on stage, or on a call.";
/** An origin beat's photo, named by the beat so the coach knows which moment to find. */
export const originWhat = (label: string): string => `A photo of you from this beat: ${label.toLowerCase()}.`;
/** A story's first beat: the person the story is about. */
export const STORY_WHAT = "A photo of the person this story is about.";

/**
 * The spread (§3): walking the slides in order, a slot that would be the third in a row of slides with slots is dropped. A
 * slide's slot is left alone when it is the cover or a testimonial. Pure over the slot list: the caller maps it back.
 */
export function spreadSlots<T extends { slot: Slot | null; kind: string }>(slides: T[]): T[] {
  let run = 0;
  return slides.map((s) => {
    if (!s.slot) {
      run = 0;
      return s;
    }
    const keep = s.kind === "cover" || s.slot.kind === "testimonial" || run < MAX_SLOT_RUN;
    run = keep ? run + 1 : 0;
    return keep ? s : { ...s, slot: null };
  });
}
