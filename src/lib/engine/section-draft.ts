/**
 * "Draft this section for me" writes the slides too (first-deck brief §2, 5 Oct): one call returns the spoken script, then a
 * marker line, then the section's deck lines, one per slide. Pure: the action parses and checks what came back, and "Make slides
 * from my script" reads the same lines. A deck line may quote a figure only when the record or the script already has it; a
 * placeholder ("[PROOF PLACEHOLDER]") stays, so the deck shows the red box rather than a result nobody had.
 */
import type { ResolvedOffer } from "./webinar-context";
import { placeholderHits, pointKindFor } from "./deck";

export const SLIDES_MARK = "---SLIDES---";
/** The longest deck line kept: a slide holds one idea, and the deck's longest headline tier is about this long. */
export const SLIDE_LINE_MAX = 140;

/** About one slide per two minutes of the section, two to six. */
export const slideCountFor = (minutes: number): number => Math.min(6, Math.max(2, Math.round(minutes / 2)));

/** The instruction that asks for the deck lines, appended to the section's own task. */
export function slidesInstruction(minutes: number): string {
  const n = slideCountFor(minutes);
  return `After the script, write a line that says exactly ${SLIDES_MARK} and then ${n} deck lines, one per slide, each on its own line starting with "- ". A deck line is a short phrase the audience reads while the presenter speaks (under 15 words), drawn from the script you just wrote, in the order it is said. Quote a number only if it appears in the material given or the script. Where the script has a bracketed placeholder such as [PROOF PLACEHOLDER], give that placeholder its own deck line, word for word.`;
}

/** The task for "Make slides from my script": deck lines only, from a script the client already has. */
export function slidesOnlyTask(minutes: number): string {
  const n = slideCountFor(minutes);
  return `You turn one section of a spoken webinar script into deck lines. Output exactly ${n} lines, each starting with "- ", one per slide: a short phrase the audience reads while the presenter speaks (under 15 words), in the order the script says them. Use only what the script says. Quote a number only if it appears in the script. Keep any bracketed placeholder, such as [PROOF PLACEHOLDER], as a line of its own, word for word. Output nothing else.`;
}

const bullet = /^\s*(?:[-•*]|\d+[.)])\s+/;

/** The lines of a slides block: bullets and numbering off, blanks and the marker gone. */
export function slideLines(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.replace(bullet, "").replace(/^\*\*(.*)\*\*$/, "$1").trim())
    .filter((l) => l && l !== SLIDES_MARK);
}

/** The script and the deck lines, read back from one reply. No marker, or nothing after it: the slides are null, the script whole. */
export function parseSectionDraft(text: string): { script: string; slides: string[] | null } {
  const at = text.indexOf(SLIDES_MARK);
  if (at < 0) return { script: text.trim(), slides: null };
  const slides = slideLines(text.slice(at + SLIDES_MARK.length));
  return { script: text.slice(0, at).trim(), slides: slides.length ? slides : null };
}

/** Every figure a line names, as digits only: "$1,997" is "1997", "2.5x" is "2.5", "47%" is "47". */
const figures = (s: string): string[] => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((f) => f.replace(/,/g, ""));

/**
 * The deck lines that may go on a face: each figure in a line must already be in the record or the script, a line too long for
 * a slide is dropped rather than cut, and a line said twice is kept once. What was dropped is returned with the reason.
 */
export function checkSlides(lines: string[], known: string): { kept: string[]; dropped: { line: string; why: "figure" | "long" }[] } {
  const have = new Set(figures(known));
  const kept: string[] = [];
  const dropped: { line: string; why: "figure" | "long" }[] = [];
  for (const line of lines) {
    if (line.length > SLIDE_LINE_MAX) dropped.push({ line, why: "long" });
    else if (figures(line).some((f) => !have.has(f))) dropped.push({ line, why: "figure" });
    else if (!kept.some((k) => k.toLowerCase() === line.toLowerCase())) kept.push(line);
  }
  return { kept, dropped };
}

/**
 * Only lines the deck can export (found 5 Oct, the first-deck walk): a placeholder on a proof or price slide, or inside a
 * sentence with a number, refuses the whole export. Such a line stays out of the slides; the script keeps its placeholder, and
 * the check panel still names what is missing.
 */
export function deckSafe(lines: string[], sectionName: string): string[] {
  const kind = pointKindFor(sectionName);
  return lines.filter((l) => !placeholderHits(kind, [l]).some((h) => h.refuse));
}

/** As the Key points box stores them: one bullet per line. */
export const keyPointsText = (lines: string[]): string => lines.map((l) => `• ${l}`).join("\n");

/** Whether a section has words to speak and nothing for the deck to show: "Make slides from my script" is offered. */
export const needsSlides = (s: { script: string | null; keyPoints: string | null; status?: string }): boolean => s.status !== "omitted" && Boolean(s.script?.trim()) && !s.keyPoints?.trim();

/**
 * The offer, as the closing frame's draft is given it: the record's own names, values and price, so the script and the deck say
 * the same numbers. With no offer linked, the draft is told to leave a placeholder rather than name a price.
 */
export function offerBlock(offer: ResolvedOffer | null): string {
  if (!offer) return "No offer is linked to this webinar yet: name no price, value or bonus; write [OFFER PLACEHOLDER] where the offer is presented.";
  const money = (n: number) => `${offer.currency === "USD" ? "$" : `${offer.currency} `}${n.toLocaleString("en-US")}`;
  const total = offer.components.reduce((a, c) => a + (c.perceivedValue || 0), 0);
  return [
    `The offer, from the record. Quote its names, values and price exactly, and nothing else:`,
    `Name: ${offer.name}`,
    `Price: ${money(offer.price)}${offer.paymentPlan ? ` (payment plan: ${offer.paymentPlan})` : ""}`,
    offer.container ? `What it is: ${offer.container}` : "",
    offer.components.length ? `The stack:\n${offer.components.map((c) => `- ${c.name}${c.perceivedValue ? ` (${money(c.perceivedValue)} value)` : ""}${c.oneLiner ? `: ${c.oneLiner}` : ""}`).join("\n")}` : "The stack has no components yet: name none.",
    total ? `Total value: ${money(total)}` : "",
    offer.guarantee ? `Guarantee: ${offer.guarantee}` : "",
    offer.scarcity ? `Scarcity: ${offer.scarcity}` : "",
    offer.urgency ? `Urgency: ${offer.urgency}` : "",
    offer.ctaFooter ? `Call to action: ${offer.ctaFooter}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
