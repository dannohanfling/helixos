/**
 * The deck, from the record: every slide is built from what the resolver found wired to a section, and nothing a slide says
 * is something the record does not know. Pure. Two outputs: the slides (what a person reads on the Deck step and in the
 * outline) and the render plan (every text box with its size, face and colours, so the renderer is a mapping and the rules
 * about colour and truncation can be tested here rather than caught on a screen).
 */
import { formatPrice } from "./offer-score";
import { brandKitProblems, normaliseHex } from "./subject";
import { QA_SECTION_KEY, placeholdersIn, type SectionContext, type WebinarContext } from "./webinar-context";

/** The brand as the renderer reads it. Null renders the neutral kit and says so. */
export type DeckKit = { name: string; ground: string; ink: string; accent: string; muted: string; surface: string; inverseGround?: string | null; inverseInk?: string | null; displayFont: string; bodyFont: string; quoteFont?: string | null; fontFallback: string; bannedColors: string[]; placeholder?: string | null };
/** With no kit on the workspace: black on white, the accent a plain grey, and the export note says no brand was applied. */
export const NEUTRAL_KIT: DeckKit = { name: "No brand kit", ground: "FFFFFF", ink: "111111", accent: "555555", muted: "555555", surface: "F2F2F2", displayFont: "Arial", bodyFont: "Arial", fontFallback: "Arial", bannedColors: [] };
/** The one colour an unfilled slot is ever drawn in when the kit reserves none: unmissable, and named in the export note. */
export const PLACEHOLDER_FALLBACK = "FFF3A3";

/**
 * A headline steps down a tier as it lengthens and is never cut. Characters → points. Past the floor the sentence moves to
 * the body, so the smallest headline a slide carries is 22pt, readable from the back of a room.
 */
export const HEADLINE_TIERS: { maxChars: number; size: number }[] = [
  { maxChars: 48, size: 40 },
  { maxChars: 80, size: 32 },
  { maxChars: 120, size: 26 },
  { maxChars: 160, size: 22 },
];
export const HEADLINE_FLOOR = 22;
export const HEADLINE_MAX_CHARS = 160;
export const BODY_SIZE = 18;
export const EYEBROW_SIZE = 11;

export type SlideKind = "cover" | "section" | "proof" | "evidence" | "story" | "offer";
export type PlaceholderHit = { text: string; refuse: boolean; why: string };
export type Slide = {
  n: number;
  kind: SlideKind;
  sectionKey: string | null;
  section: string;
  act: string;
  eyebrow: string;
  headline: string;
  headlineSize: number;
  body: string[];
  /** The art direction and the delivery note, for the speaker notes and nowhere else. */
  notes: string[];
  placeholders: PlaceholderHit[];
  /** The headline was longer than the floor allows, so the sentence is the first body line and the section name stands in. */
  overflow: boolean;
};
export type DeckResult = {
  slides: Slide[];
  /** Why the export is refused, each a sentence naming the slide. Empty means it can go. */
  refused: string[];
  /** Worth a look, never a block: warned placeholders, an overflowing headline, no kit. */
  warnings: string[];
  placeholderCount: number;
  kit: DeckKit;
  kitApplied: boolean;
};

const ACT_LABEL: Record<string, string> = { opening: "Opening frame", vehicle: "Vehicle", internal: "Internal", external: "External", closing: "Closing frame" };
const isProofBlock = (s: SectionContext) => /proof block/i.test(s.name);
const isCaseStudy = (s: SectionContext) => /case study/i.test(s.name);
const isOfferStack = (s: SectionContext) => /offer stack/i.test(s.name);

export function headlineTier(text: string): { size: number; overflow: boolean } {
  const n = text.trim().length;
  for (const t of HEADLINE_TIERS) if (n <= t.maxChars) return { size: t.size, overflow: false };
  return { size: HEADLINE_FLOOR, overflow: true };
}

/**
 * A sentence with a number, a percentage or a currency in it is a claim; a placeholder inside one is a hole in a claim. The
 * sentence is read with its brackets off and their contents kept, so "[X]%" and "[$N]" carry their own percentage and currency;
 * a bare single-letter slot ("[N]", "[X]") is a number by the examples' own convention.
 */
const CLAIM_SENTENCE = /\d|%|[$£€]|\b(USD|NZD|AUD|CAD|GBP|EUR|SGD)\b/;
const NUMBER_SLOT = /^\[\$?[A-Z]\]%?$/;
const isClaim = (sentence: string, token: string) => NUMBER_SLOT.test(token) || CLAIM_SENTENCE.test(sentence.replace(/\[|\]/g, ""));
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n/).map((s) => s.trim()).filter(Boolean);

/** Every placeholder on a slide, and whether it refuses the export: clause (a) the sentence is a claim, clause (b) the slide is proof or offer. */
export function placeholderHits(kind: SlideKind, texts: string[]): PlaceholderHit[] {
  const out: PlaceholderHit[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    for (const sentence of sentencesOf(text)) {
      for (const token of placeholdersIn(sentence)) {
        if (seen.has(token)) continue;
        seen.add(token);
        const claim = isClaim(sentence, token);
        const onClaimSlide = kind === "proof" || kind === "evidence" || kind === "offer";
        if (onClaimSlide) out.push({ text: token, refuse: true, why: `${token} sits on a ${kind === "offer" ? "price" : "proof"} slide, which is a claim by its nature.` });
        else if (claim) out.push({ text: token, refuse: true, why: `${token} sits in a sentence that carries a number: a claim with a hole in it.` });
        else out.push({ text: token, refuse: false, why: `${token} is a gap to fill.` });
      }
    }
  }
  return out;
}

/** What a slide is asked to look like, read off what it holds, or nothing. To the notes, never the face. */
function direction(kind: SlideKind, body: string[]): string | null {
  if (kind === "proof") return "One quote, large. The attribution small beneath it. Nothing else on the slide.";
  if (kind === "evidence") return "The claim as the line. The source small beneath it.";
  if (kind === "story") return "The person's name as the line; the beats build beneath it.";
  if (kind === "offer") return "The stack, one line each. The price on its own, last.";
  if (!body.length) return "One line, lots of air.";
  return null;
}

function slideOf(n: number, kind: SlideKind, s: SectionContext | null, headlineRaw: string, body: string[], extraNotes: string[] = []): Slide {
  const tier = headlineTier(headlineRaw);
  const headline = tier.overflow ? (s?.name ?? "") : headlineRaw.trim();
  const finalBody = tier.overflow ? [headlineRaw.trim(), ...body] : body;
  const notes = [s ? `Section: ${s.name}` : "", direction(kind, finalBody) ? `Visual direction: ${direction(kind, finalBody)}` : "", s?.deliveryNote ? `Delivery: ${s.deliveryNote}` : "", ...extraNotes].filter(Boolean);
  return { n, kind, sectionKey: s?.sectionKey ?? null, section: s?.name ?? "", act: s?.act ?? "opening", eyebrow: s ? `${s.name} · ${ACT_LABEL[s.act] ?? s.act}` : "", headline, headlineSize: tier.overflow ? HEADLINE_FLOOR : tier.size, body: finalBody, notes, placeholders: placeholderHits(kind, [headline, ...finalBody]), overflow: tier.overflow };
}

/** The slides for one webinar: one read of the resolver, nothing invented, nothing narrated. */
export function deckSlides(c: WebinarContext, kitIn: DeckKit | null): DeckResult {
  const kit = kitIn ?? NEUTRAL_KIT;
  const slides: Slide[] = [];
  const warnings: string[] = [];
  let n = 1;
  slides.push({ n: n++, kind: "cover", sectionKey: null, section: "", act: "opening", eyebrow: "", headline: c.title, headlineSize: headlineTier(c.title).size, body: [c.presenter], notes: [`Presented by ${c.presenter}.`, `Faces: ${kit.displayFont} for headlines, ${kit.bodyFont} for body. If a face is missing on this machine, use ${kit.fontFallback}.`], placeholders: [], overflow: false });
  for (const s of c.sections) {
    if (s.status === "omitted") continue;
    const points = s.keyPoints;
    const pointsSlide = () => (points.length ? slides.push(slideOf(n++, "section", s, points[0], points.slice(1, 4))) : 0);
    if (isProofBlock(s)) {
      // From the bank or the shelf, as they store it; failing both, no slide. Never a sentence about the slide's own absence.
      if (s.proof) slides.push(slideOf(n++, "proof", s, `“${s.proof.quote}”`, s.proof.who ? [`— ${s.proof.who}`] : []));
      else if (s.evidence) slides.push(slideOf(n++, "evidence", s, s.evidence.claim, [s.evidence.citation]));
      if (points.length) slides.push(slideOf(n++, "proof", s, points[0], points.slice(1, 4)));
      continue;
    }
    if (isCaseStudy(s)) {
      if (s.story) slides.push(slideOf(n++, "story", s, s.story.name, sentencesOf(s.story.body).slice(0, 3)));
      else pointsSlide();
      continue;
    }
    if (isOfferStack(s)) {
      if (s.offer) slides.push(slideOf(n++, "offer", s, s.offer.name, [...s.offer.components.map((x) => (x.oneLiner ? `${x.name} — ${x.oneLiner}` : x.name)), formatPrice(s.offer.price, s.offer.currency)]));
      if (points.length) slides.push(slideOf(n++, "offer", s, points[0], points.slice(1, 4)));
      continue;
    }
    if (points.length) {
      const extra = s.sectionKey === QA_SECTION_KEY && s.objections.length ? [`Objections to hand: ${s.objections.map((o) => o.name).join("; ")}`] : [];
      slides.push(slideOf(n++, "section", s, points[0], points.slice(1, 4), extra));
      if (points.length > 4) slides.push(slideOf(n++, "section", s, points[4], points.slice(5, 8)));
    }
  }
  const refused: string[] = [];
  for (const sl of slides) {
    for (const p of sl.placeholders) {
      if (p.refuse) refused.push(`Slide ${sl.n} (${sl.section || "cover"}): ${p.why}`);
      else warnings.push(`Slide ${sl.n} (${sl.section || "cover"}): ${p.why}`);
    }
    if (sl.overflow) warnings.push(`Slide ${sl.n} (${sl.section}): the first key point is over ${HEADLINE_MAX_CHARS} characters, so it is the first body line and the section name stands as the headline. Shorten the key point to bring it back up.`);
  }
  const kitProblems = kitIn ? brandKitProblems(kitIn) : [];
  for (const p of kitProblems) refused.push(`Brand kit: ${p}`);
  if (!kitIn) warnings.push("No brand kit on this workspace: rendered black on white with no brand applied. Add the kit on Settings.");
  if (kitIn && !normaliseHex(kitIn.placeholder)) warnings.push(`The brand kit reserves no placeholder colour, so unfilled slots are drawn in ${PLACEHOLDER_FALLBACK}.`);
  return { slides, refused, warnings, placeholderCount: slides.reduce((a, sl) => a + sl.placeholders.length, 0), kit, kitApplied: Boolean(kitIn) };
}

/* ───────────── The render plan ───────────── */

export type TextBox = { slide: number; role: "eyebrow" | "headline" | "body" | "attribution" | "cover-title" | "cover-presenter"; text: string; size: number; color: string; fill: string | null; face: string; bold: boolean; italic: boolean; bullet: boolean; placeholder: boolean };
export type SlidePlan = { n: number; background: string; boxes: TextBox[]; notes: string };

/**
 * Every box the renderer will draw, with the kit's hex written verbatim: no tint, no derived shade. Text sits on ground only;
 * accent is a colour for an eyebrow, never a ground under text, so ink on accent cannot arrive without this changing.
 */
export function renderPlan(d: DeckResult): SlidePlan[] {
  const k = d.kit;
  const hex = (v: string) => normaliseHex(v);
  const placeholderColor = hex(k.placeholder ?? "") || PLACEHOLDER_FALLBACK;
  return d.slides.map((s) => {
    const boxes: TextBox[] = [];
    const mark = (text: string) => placeholdersIn(text).length > 0;
    if (s.kind === "cover") {
      boxes.push({ slide: s.n, role: "cover-title", text: s.headline, size: s.headlineSize, color: hex(k.ink), fill: null, face: k.displayFont, bold: true, italic: false, bullet: false, placeholder: false });
      boxes.push({ slide: s.n, role: "cover-presenter", text: s.body[0] ?? "", size: BODY_SIZE, color: hex(k.muted), fill: null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: false });
    } else {
      boxes.push({ slide: s.n, role: "eyebrow", text: s.eyebrow, size: EYEBROW_SIZE, color: hex(k.accent), fill: null, face: k.displayFont, bold: false, italic: false, bullet: false, placeholder: false });
      boxes.push({ slide: s.n, role: "headline", text: s.headline, size: s.headlineSize, color: mark(s.headline) ? hex(k.ink) : hex(k.ink), fill: mark(s.headline) ? placeholderColor : null, face: s.kind === "proof" && k.quoteFont ? k.quoteFont : k.displayFont, bold: s.kind !== "proof", italic: s.kind === "proof", bullet: false, placeholder: mark(s.headline) });
      for (const line of s.body) {
        const attribution = s.kind === "proof" && line.startsWith("— ");
        boxes.push({ slide: s.n, role: attribution ? "attribution" : "body", text: line, size: attribution ? EYEBROW_SIZE + 3 : BODY_SIZE, color: attribution ? hex(k.muted) : hex(k.ink), fill: mark(line) ? placeholderColor : null, face: k.bodyFont, bold: false, italic: false, bullet: !attribution && s.kind !== "offer" ? true : false, placeholder: mark(line) });
      }
    }
    return { n: s.n, background: hex(k.ground), boxes, notes: s.notes.join("\n") };
  });
}

/** The plain-text outline: what the .txt export and the Deck step's copy carry. Never the notes' art direction on a face. */
export function outlineText(title: string, d: DeckResult): string {
  return [title, `Deck outline · ${d.slides.length} slides${d.placeholderCount ? ` · ${d.placeholderCount} unfilled` : ""}`, "", ...d.slides.flatMap((s) => [`${s.n}. ${s.headline}`, s.eyebrow ? `   ${s.eyebrow}` : "", ...s.body.map((b) => `   - ${b}`), ""])].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
