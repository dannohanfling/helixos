/**
 * The deck, from the record: every slide is built from what the resolver found wired to a section, and nothing a slide says
 * is something the record does not know. Pure. Two outputs: the slides (what a person reads on the Deck step and in the
 * outline) and the render plan (every text box with its size, face and colours, so the renderer is a mapping and the rules
 * about colour and truncation can be tested here rather than caught on a screen).
 */
import { formatPrice } from "./offer-score";
import { FACE_CLASS_LABEL, cleanFace, currenciesIn, currencyConflicts, type FaceClass, type KeptOff } from "./deck-face";
import { brandKitProblems, contrastRatio, normaliseHex } from "./subject";
import { QA_SECTION_KEY, placeholdersIn, type ResolvedOffer, type ResolvedProof, type SectionContext, type WebinarContext } from "./webinar-context";
import { COVER_WHAT, STORY_WHAT, originWhat, slotForLine, spreadSlots } from "./deck-slot-rules";
import { fitSize } from "./deck-fit-text";

/** The brand as the renderer reads it. Null renders the neutral kit and says so. */
export type DeckKit = { name: string; logoImageId?: string | null; logoDarkImageId?: string | null; ground: string; ink: string; accent: string; muted: string; surface: string; inverseGround?: string | null; inverseInk?: string | null; displayFont: string; bodyFont: string; quoteFont?: string | null; fontFallback: string; bannedColors: string[]; placeholder?: string | null; /** The price against the total (the anchor). Undefined means on: the control. */ showPriceAnchor?: boolean | null };
/**
 * The house starter kit (first-deck brief §1, Danno 5 Oct): every workspace without a kit of its own gets a designed deck on day
 * one, neutral on purpose (never Evolve Omega's gold, never our name: it is the client's deck), until they save their own on
 * Settings. Ink reads 13.3:1 on the ground; the accent 5.0:1, used for rules only on the dark ground.
 */
export const STARTER_KIT: DeckKit = { name: "House starter kit", ground: "F7F5F0", ink: "1F2A37", accent: "0F766E", muted: "5B6472", surface: "ECE8E1", inverseGround: "1F2A37", inverseInk: "F7F5F0", displayFont: "Montserrat", bodyFont: "Arial", quoteFont: "Playfair Display", fontFallback: "Arial", bannedColors: [] };
/** A plain black-on-white kit, for tests that want no styling in the way. */
export const NEUTRAL_KIT: DeckKit = { name: "No brand kit", ground: "FFFFFF", ink: "111111", accent: "555555", muted: "555555", surface: "F2F2F2", displayFont: "Arial", bodyFont: "Arial", fontFallback: "Arial", bannedColors: [] };
/** The one colour an unfilled [text] placeholder is ever drawn in when the kit reserves none: unmissable, and named in the export note. */
export const PLACEHOLDER_FALLBACK = "FFF3A3";
/**
 * The red an empty picture slot is drawn in (deck visuals §2, Danno 1 Oct: "if there are empty slots, it will show in red text").
 * Fixed, never the brand accent, so a client whose accent is red keeps the signal. 4.83:1 on white, 4.4:1 on a warm paper,
 * 3.99:1 on the kit surface ECE9E5: large text (14pt) reads at every one of those.
 */
export const PLACEHOLDER_RED = "D92D20";
/** Readable on a projector (first-deck §4, 5 Oct: at 14pt in a 4 by 3.5 in frame it was hard to read), centred in its frame. */
export const PLACEHOLDER_TEXT_SIZE = 20;

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
/** The reading size where the slide has room (first-deck §4: 18pt under 32 to 44pt headlines read small from the back). */
export const BODY_SIZE = 24;
export const EYEBROW_SIZE = 11;
/** A body shrinks to these before anything else gives (§4): 24 is the reading size, 14 the floor. */
export const BODY_FIT_SIZES = [BODY_SIZE, 22, 20, 18, 16, 14];
/** The presenter's name and the event's date on the cover, under the title. */
export const COVER_LINE_SIZE = 20;
/**
 * A figure slide (first-deck §5): the price huge, an item's value large, each stepping down until it fits its box. The total
 * struck through and the small lines (the saving, the running total, the payment plan) sit around it in muted.
 */
export const PRICE_SIZES = [96, 80, 66, 54];
export const VALUE_SIZES = [60, 54, 44, 36];
export const STRUCK_SIZE = 28;
export const SMALL_SIZE = 20;
/** A statement slide (one line, no body, §4): the line sits vertically centred, large by its length. */
export const STATEMENT_SIZES: { maxChars: number; size: number }[] = [
  { maxChars: 30, size: 60 },
  { maxChars: 48, size: 52 },
  { maxChars: 80, size: 44 },
];
/** When a picture slide's text cannot fit beside the picture even at the floor, the picture takes the next slide, this big. */
export const PICTURE_ONLY_FRAME: Frame = { x: 1.5, y: 0.6, w: 7, h: 4.4 };

export type SlideKind = "cover" | "divider" | "recap" | "section" | "proof" | "evidence" | "story" | "offer" | "opening" | "reflection" | "close";
/** A figure on a slide (first-deck §5): the price or an item's value, set large; the anchor struck through; the small lines under it. */
export type SlideFigure = { value: string; size: "price" | "value"; struck: string | null; small: string[] };
/** A picture slot the deck suggests by rule from the slide's kind. The coach fills it from their image library; empty, it lists on the Deck step and the slide exports with a red placeholder in the picture's frame (§2). Never on the price slide. */
export type SlotKind = "photo" | "photo_pair" | "screenshot" | "screenshot_callout" | "proof_wall" | "testimonial" | "diagram";
/** A testimonial slot carries the bank proof it belongs to, so its photo is that proof's own approved attachment and nothing else. */
export type Slot = { key: string; kind: SlotKind; what: string; proofId?: string };
/** The one-line instruction each suggested slot carries, from a fixed table, never generated. */
export const SLOT_WHAT: Record<SlotKind, string> = {
  photo: "A photo of you or the person in this beat.",
  photo_pair: "Two photos side by side: before and after.",
  screenshot: "A screenshot of the thing you are describing.",
  screenshot_callout: "A screenshot with the number or line that matters circled.",
  proof_wall: "A wall of your real screenshots: comments, DMs, results.",
  testimonial: "The client's photo beside their approved quote.",
  diagram: "Your own diagram of this mechanism or framework.",
};
/**
 * What an empty slot's placeholder says on the face (§2): "Add " and the slot's own instruction, which since §3 names the thing
 * to show ("Add a screenshot with “602 comments on my post” circled."). Filling the slot replaces the placeholder with the
 * picture in the same frame.
 */
export function placeholderLine(slot: Slot): string {
  const what = slot.what.trim();
  return `Add ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
}
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
  /** The cover and the act dividers: the dark surfaces, on the kit's inverse pair when it has one. */
  inverse: boolean;
  /** The offer's one line (first-deck §5): on the offer and Q&A slides and the close, nowhere else. */
  footer: string | null;
  /** The price or a stack item's value, set as a figure (first-deck §5); null on every other slide. */
  figure?: SlideFigure | null;
  /** The picture slot this slide suggests, or null. Filled by the coach from the image library; empty here, listed on the Deck step. */
  slot: Slot | null;
  /** What the record's text carried that no face may (deck-face.ts): kept off this slide, in its notes and on the Deck step. */
  keptOff: KeptOff[];
  /** On a Proof Block slide: the proof it shows (the bank id, or the typed words), so the deck shows each proof once. */
  proofKey?: string;
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
  /** Opening-contract lines the coach has not filled: not slides, listed on the Deck step, never a placeholder on a face. */
  openingOmitted: string[];
  /**
   * Every piece of consent, verification, missing-item, rule or field-label text the record put on a face, kept off it: the slide
   * it would have sat on (null when the whole slide was that text and so is not a slide), its section, and the words.
   */
  keptOff: { slide: number | null; section: string; cls: FaceClass; text: string }[];
  /**
   * Each proof appears once in a deck unless the coach ticked "show it again" for that act. A repeat that was a whole slide is not
   * a slide (slide null); a repeat that was a line comes off that slide. Each names whose proof and the slide it is shown on.
   */
  repeats: { slide: number | null; section: string; who: string; shownOn: number; text: string }[];
  /**
   * Key points that say again what the opening or the origin story already said (deck layouts 16, round 1: the emoji ask on
   * slides 3 and 8, the origin story twice). Each comes off its section, named with the line it repeats, never silently.
   */
  echoes: { section: string; text: string; sameAs: string }[];
  /** Per-webinar chrome the renderer draws, carried so renderPlan stays pure over the result. */
  footerBar: boolean;
  ctaBar: boolean;
  ctaFooter: string | null;
};

const ACT_LABEL: Record<string, string> = { opening: "Opening frame", vehicle: "Vehicle", internal: "Internal", external: "External", closing: "Closing frame" };
const BELIEF_ACTS = new Set(["vehicle", "internal", "external"]);
const isProofBlock = (s: SectionContext) => /proof block/i.test(s.name);
const isCaseStudy = (s: SectionContext) => /case study/i.test(s.name);
const isOfferStack = (s: SectionContext) => /offer stack/i.test(s.name);
/** The kind of slide a section's key points become (proof, price or plain): what decides whether a placeholder may sit on one. */
export const pointKindFor = (sectionName: string): SlideKind => (/proof block/i.test(sectionName) ? "proof" : /offer stack/i.test(sectionName) ? "offer" : "section");
const isOrigin = (s: SectionContext) => /credibility|origin/i.test(s.name);
/** The fit slides' lines: the Offer form's own labels for the two fields they read. */
export const FIT_HEADLINES = { forYouIf: "This is for you if…", notForYouIf: "This is not for you if…" };
/** The reference deck's pace and the band a first draft should land in (code-deck-density-spec §4). Slides a minute. */
export const REFERENCE_PACE = 1.7;
export const PACE_BAND: [number, number] = [1.2, 1.5];

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
  if (kind === "offer") return body.length ? "The stack builds one line at a time. The price on its own, last." : "One line, lots of air.";
  if (kind === "divider") return "Full-bleed on the dark ground. The act's name, then the shift.";
  if (kind === "recap") return "The act's lines, one under another. Nothing new on this slide.";
  if (!body.length) return "One line, lots of air.";
  return null;
}

/** A proof's identity in a deck: its bank id, or its typed words. */
const proofKeyOf = (p: ResolvedProof): string => (p.source === "bank" ? p.id : `typed:${normQuote(p.quote)}`);
/** Words compared without their quotes, dashes, case or spacing: “I now see…” and "i now see…" are the same words. */
const normQuote = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Shorter than this, a match is a common phrase, not a quotation. */
const QUOTE_MIN = 30;

/** Whether a key point says again what a line already on the slides says: the same words, or one inside the other when long enough to be more than a common phrase. */
export function echoes(point: string, line: string): boolean {
  const a = normQuote(point);
  const b = normQuote(line);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= QUOTE_MIN && (a.includes(b) || b.includes(a));
}

/**
 * A quote that starts mid-sentence ("ran a five-day challenge…") reads with no one doing it (deck layouts 16, round 1): it
 * takes the person's first name ("Terri ran a five-day challenge…"). A quote that starts with a capital, or a person with no
 * name on the record, stands as stored.
 */
export function quoteWithSubject(quote: string, who: string): string {
  const q = quote.trim();
  const first = who.replace(/^[—–-]\s*/, "").trim().split(/\s+/)[0]?.replace(/[^\p{L}'-]/gu, "") ?? "";
  const lead = q.match(/^[“"'‘…\.\s]*/)?.[0] ?? "";
  const rest = q.slice(lead.length);
  if (!first || !/^\p{Ll}/u.test(rest) || /^i\b/.test(rest)) return q;
  return `${first} ${rest}`;
}
/** The proof a line quotes, if any: what sits inside its quotation marks, or the whole line, found inside one of a proof's versions (or containing one). */
function quotedProof(line: string, proofs: Map<string, { texts: string[] }>): string | null {
  const inside = [...line.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1]);
  for (const seg of inside.length ? inside : [line]) {
    const n = normQuote(seg);
    if (n.length < QUOTE_MIN) continue;
    for (const [key, p] of proofs) if (p.texts.some((t) => t.includes(n) || n.includes(t))) return key;
  }
  return null;
}

/** The note a kept-off line leaves: the presenter still has it, on the slide it came from, said as what it is. */
const notOnFace = (k: KeptOff) => `Not on the slide (${FACE_CLASS_LABEL[k.cls]}): ${k.text}`;
/** A slide whose face was nothing but kept-off text: no line to show, so it is not a slide. */
const emptied = (sl: Slide) => !sl.headline && !sl.body.length && sl.keptOff.length > 0;

type SlideInput = { n: number; kind: SlideKind; s: SectionContext | null; headline: string; body?: string[]; extraNotes?: string[]; eyebrow?: string; act?: string; inverse?: boolean; footer?: string | null; slot?: Slot | null; figure?: SlideFigure | null };
function slideOf(i: SlideInput): Slide {
  const { n, kind, s } = i;
  // The face first: every line the record hands a slide is read against deck-face.ts, and what may not stand on a face comes off
  // here, at the one place every slide passes, whichever field it came from. A headline that was nothing but such text gives way
  // to the first body line; a slide left with nothing is dropped by deckSlides, its words kept in the notes before it.
  const head = cleanFace(i.headline);
  const lines = (i.body ?? []).map(cleanFace);
  const foot = i.footer ? cleanFace(i.footer) : null;
  const keptOff = [...head.kept, ...lines.flatMap((l) => l.kept), ...(foot?.kept ?? [])];
  let headlineIn = head.face.trim();
  let body = lines.map((l) => l.face).filter(Boolean);
  if (!headlineIn && body.length) [headlineIn, body] = [body[0], body.slice(1)];
  const tier = headlineTier(headlineIn);
  const headline = tier.overflow ? (s?.name ?? "") : headlineIn;
  const finalBody = tier.overflow ? [headlineIn, ...body] : body;
  // The section name is in the notes, never on the face (§9): the record's section, or the deck's own label for a slide without one.
  const art = i.figure ? (i.figure.size === "price" ? "The price huge. The total struck through above it; the saving small beneath." : "The item's value large; the running total small beneath it.") : direction(kind, finalBody);
  const notes = [s ? `Section: ${s.name}` : i.eyebrow ? `Section: ${i.eyebrow}` : "", art ? `Visual direction: ${art}` : "", s?.deliveryNote ? `Delivery: ${s.deliveryNote}` : "", ...(i.extraNotes ?? []), ...keptOff.map(notOnFace)].filter(Boolean);
  const footer = foot?.face || null;
  // The footer is the offer's line on a price slide: a hole in it refuses as clause (b) does, on every slide it sits on.
  const placeholders = [...placeholderHits(kind, [headline, ...finalBody]), ...(footer ? placeholderHits("offer", [footer]) : [])].filter((h, idx, all) => all.findIndex((x) => x.text === h.text) === idx);
  return { keptOff, slot: i.slot ?? null, n, kind, sectionKey: s?.sectionKey ?? null, section: s?.name ?? "", act: i.act ?? s?.act ?? "opening", eyebrow: i.eyebrow ?? (s ? `${s.name} · ${ACT_LABEL[s.act] ?? s.act}` : ""), headline, headlineSize: tier.overflow ? HEADLINE_FLOOR : tier.size, body: finalBody, notes, placeholders, overflow: tier.overflow, inverse: Boolean(i.inverse), footer, figure: i.figure ?? null };
}

/**
 * The offer as a build, read off the Offer record: one slide per item, the running total re-shown after each, then the price
 * against the total (the anchor, the standard close and the control), the payment plan, the guarantee, and the scarcity and
 * urgency lines only when the offer carries them. The total is a real sum or it is not shown: any item without a value and no
 * total renders anywhere, because a total that quietly leaves an item out is a wrong number. With the kit's price anchor off
 * (a house policy some brands hold), the comparison is not drawn and the price stands on its own; everything else still renders.
 */
export type OfferBuildSlide = { headline: string; body: string[]; eyebrow?: string; figure?: SlideFigure; price?: boolean };
export function offerBuild(o: ResolvedOffer, showPriceAnchor = true): OfferBuildSlide[] {
  const items = o.components.filter((x) => x.type !== "guarantee");
  const totals = items.length > 0 && items.every((x) => x.perceivedValue > 0);
  const out: OfferBuildSlide[] = [];
  let running = 0;
  for (const x of items) {
    running += x.perceivedValue;
    const line = (x.oneLiner ?? x.description ?? "").trim();
    // An item's own value large, the running total small under it (first-deck §5); an item with no value has no figure.
    const figure: SlideFigure | undefined = x.perceivedValue > 0 ? { value: `${formatPrice(x.perceivedValue, o.currency)} value`, size: "value", struck: null, small: totals ? [`Total value so far: ${formatPrice(running, o.currency)}`] : [] } : undefined;
    out.push({ headline: x.name, body: line ? [line] : [], figure });
  }
  const saving = totals ? running - o.price : 0;
  const anchor = totals && showPriceAnchor;
  // The price slide (first-deck §5): "Get started today" as the line, the price huge, the total struck through, the saving small.
  // The offer's name is the eyebrow, never the headline (it is the coach's filing name, "TEST CLIENT – 30-Day Sleep Reset").
  out.push({
    headline: "Get started today",
    eyebrow: o.name,
    body: [],
    price: true,
    figure: { value: formatPrice(o.price, o.currency), size: "price", struck: anchor ? `Total value ${formatPrice(running, o.currency)}` : null, small: [...(anchor && saving > 0 ? [`You save ${formatPrice(saving, o.currency)}`] : []), ...(o.paymentPlan ? [`Payment plan: ${o.paymentPlan}`] : [])] },
  });
  if (o.guarantee) out.push({ headline: o.guarantee, body: [] });
  if (o.scarcity) out.push({ headline: o.scarcity, body: [] });
  if (o.urgency) out.push({ headline: o.urgency, body: [] });
  return out;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/**
 * The cover's date line (first-deck §4) from the webinar's date and time as the coach typed it ("2026-10-12T18:00"): "Monday
 * 12 October 2026 · 6:00 PM". The time is the coach's own clock, as entered; no zone is added or guessed. Null without a date.
 */
export function eventLine(when: string | null | undefined): string | null {
  const m = (when ?? "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1) return null;
  const date = `${WEEKDAYS[day.getUTCDay()]} ${d} ${MONTHS[mo - 1]} ${y}`;
  if (!m[4]) return date;
  const h = Number(m[4]);
  return `${date} · ${h % 12 || 12}:${m[5]} ${h < 12 ? "AM" : "PM"}`;
}

/** The slides for one webinar: one read of the resolver, nothing invented, nothing narrated. One idea per slide. */
export function deckSlides(c: WebinarContext, kitIn: DeckKit | null): DeckResult {
  const kit = kitIn ?? STARTER_KIT;
  const slides: Slide[] = [];
  const warnings: string[] = [];
  let n = 1;
  const offer = c.sections.find((s) => s.offer)?.offer ?? null;
  // The offer's line sits on the offer and Q&A slides only (first-deck §5: it showed on every slide from the offer onward, and
  // twice with the CTA bar on); the close carries it too.
  const footerFor = (s: SectionContext) => (offer?.ctaFooter && (isOfferStack(s) || s.sectionKey === QA_SECTION_KEY) ? offer.ctaFooter : null);
  slides.push({ keptOff: [], slot: { key: "cover:photo", kind: "photo", what: COVER_WHAT }, n: n++, kind: "cover", sectionKey: null, section: "", act: "opening", eyebrow: "", headline: c.title, headlineSize: headlineTier(c.title).size, body: [c.presenter, ...(eventLine(c.close.when) ? [eventLine(c.close.when)!] : [])], notes: [`Presented by ${c.presenter}.`, `Faces: ${kit.displayFont} for headlines, ${kit.bodyFont} for body. If a face is missing on this machine, use ${kit.fontFallback}.`], placeholders: [], overflow: false, inverse: true, footer: null });
  // The opening contract, before any content: each of the coach's own lines is one slide; a line the coach left empty is not a
  // slide (omitted, listed on the Deck step), never a placeholder on a face. The order is the reference deck's.
  const openingOmitted: string[] = [];
  const openSlide = (label: string, text: string | null, headline?: string, body?: string[]) => {
    if (!text) { openingOmitted.push(label); return; }
    slides.push(slideOf({ n: n++, kind: "opening", s: null, act: "opening", eyebrow: `Opening · ${label}`, headline: headline ?? text, body: body ?? [] }));
  };
  // What the opening and the origin story say on their own slides, so a section's key point never says it a second time.
  const alreadySaid: { label: string; text: string }[] = [
    ...([["the promise", c.opening.promiseLine], ["the chat prompt", c.opening.chatPrompt], ["the ground rule", c.opening.groundRule], ["your goal today", c.opening.sessionGoal], ["the permission line", c.opening.permissionLine], ["the stay line", c.stayLine]] as [string, string | null][]).flatMap(([label, text]) => (text ? [{ label, text }] : [])),
    ...c.opening.outcomes.map((text) => ({ label: "an outcome", text })),
    // The beats are slides only where an origin section runs; without one, a key point that tells the story is the only telling.
    ...(c.sections.some((x) => x.status !== "omitted" && isOrigin(x)) ? c.originStory.map((b) => ({ label: `the origin story's ${b.label.toLowerCase()} beat`, text: b.text })) : []),
  ];
  const echoed: DeckResult["echoes"] = [];
  openSlide("The promise", c.opening.promiseLine);
  openSlide("Say hi in the chat", c.opening.chatPrompt);
  openSlide("Ground rule", c.opening.groundRule);
  if (c.opening.outcomes.length) slides.push(slideOf({ n: n++, kind: "opening", s: null, act: "opening", eyebrow: "Opening · What you'll leave with", headline: "By the end you'll have", body: c.opening.outcomes.slice(0, 3) }));
  else openingOmitted.push("Three outcomes");
  openSlide("My goal today", c.opening.sessionGoal);
  openSlide("Permission to be direct", c.opening.permissionLine);
  for (const act of c.acts) {
    const belief = act.sections.find((s) => s.belief)?.belief ?? null;
    // A divider opens each belief act (§9, Danno 1 Oct: "the headliners calling them out shouldn't be on there"): never the wizard's
    // act label on the face. Its headline is the belief's own shift, the "To:" line, with the "From:" line under it; an act with
    // no belief row has no shift to announce, so no divider (its first key point is said once, on its own slide, not twice).
    // The act's name goes to the notes, where the coach finds their place.
    const shift = belief?.to?.trim() || belief?.from?.trim() || null;
    if (BELIEF_ACTS.has(act.key) && shift) slides.push(slideOf({ n: n++, kind: "divider", s: null, headline: shift, body: belief?.to?.trim() && belief.from?.trim() ? [`From: ${belief.from.trim()}`] : [], eyebrow: act.label, act: act.key, inverse: true }));
    for (const s of act.sections) {
      if (s.status === "omitted") continue;
      // A key point the opening or the origin story already put on a slide comes off here, named on the Deck step (layouts 16).
      const points = s.keyPoints.filter((p) => {
        const hit = alreadySaid.find((l) => echoes(p, l.text));
        if (hit) echoed.push({ section: s.name, text: p, sameAs: hit.label });
        return !hit;
      });
      const footer = footerFor(s);
      // One key point per slide, each under the section's eyebrow: the builder's own rule, kept by the exporter. A section set to
      // reveal builds instead: the first point as the line, then the same line with each further point added beneath it.
      // A key point's picture is read off its words (§3, deck-slot-rules.ts): a figure asks for a screenshot with it circled,
      // a mechanism for a diagram, and a line that names nothing to show asks for nothing. Never on a price slide (the offer).
      const pointSlot = (p: string, i: number): Slot | null => {
        if (kind_ === "offer") return null;
        const r = slotForLine(p);
        return r ? { key: `${s.sectionKey}:kp${i}:${r.kind}`, kind: r.kind, what: r.what } : null;
      };
      let kind_: SlideKind = "section";
      const pointSlides = (kind: SlideKind, extraOnFirst: string[] = []) => {
        kind_ = kind;
        points.forEach((p, i) => slides.push(slideOf(s.buildStyle === "reveal" ? { n: n++, kind, s, headline: points[0], body: points.slice(1, i + 1), extraNotes: i === 0 ? extraOnFirst : [], footer, slot: i === 0 ? pointSlot(points[0], 0) : null } : { n: n++, kind, s, headline: p, extraNotes: i === 0 ? extraOnFirst : [], footer, slot: pointSlot(p, i) })));
      };
      // The origin story's beats are the Credibility / Origin section's own slides, one each, before its key points.
      if (isOrigin(s)) for (const b of c.originStory) slides.push(slideOf({ n: n++, kind: "section", s, headline: b.text, eyebrow: `${s.name} · ${b.label}`, footer, slot: { key: `${s.sectionKey}:${b.key}:photo`, kind: "photo", what: originWhat(b.label) } }));
      if (isProofBlock(s)) {
        // From the bank or the shelf, as they store it; failing both, no slide. Never a sentence about the slide's own absence.
        if (s.proof) slides.push({ ...slideOf({ n: n++, kind: "proof", s, headline: `“${quoteWithSubject(s.proof.quote, s.proof.who)}”`, body: s.proof.who ? [`— ${s.proof.who}`] : [], footer, slot: { key: `${s.sectionKey}:testimonial`, kind: "testimonial", what: SLOT_WHAT.testimonial, proofId: s.proof.source === "bank" ? s.proof.id : undefined } }), proofKey: proofKeyOf(s.proof) });
        else if (s.evidence) slides.push(slideOf({ n: n++, kind: "evidence", s, headline: s.evidence.claim, body: [s.evidence.citation], footer, slot: { key: `${s.sectionKey}:screenshot_callout`, kind: "screenshot_callout", what: SLOT_WHAT.screenshot_callout } }));
        pointSlides("proof");
        continue;
      }
      if (isCaseStudy(s)) {
        // A story is told on the slide, never titled (§9): the bank's title is the coach's filing label and goes to the notes;
        // the story runs as beats, one sentence per slide, the picture slot on the first beat only. A beat too long for a face
        // (past the longest headline tier) goes to the notes of the beat before it, never shortened and never invented.
        if (s.story) {
          const beats = sentencesOf(s.story.body);
          const faces = beats.filter((b) => b.length <= HEADLINE_MAX_CHARS);
          const long = beats.filter((b) => b.length > HEADLINE_MAX_CHARS);
          faces.forEach((beat, i) =>
            slides.push(slideOf({ n: n++, kind: "story", s, headline: beat, eyebrow: `${s.name} · story`, footer, extraNotes: [`Story: ${s.story!.name}`, ...(i === faces.length - 1 ? long.map((b) => `Beat too long for a face: ${b}`) : [])], slot: i === 0 ? { key: `${s.sectionKey}:photo`, kind: "photo", what: STORY_WHAT } : null }))
          );
          if (!faces.length) pointSlides("section", [`Story: ${s.story.name}`, ...long.map((b) => `Beat too long for a face: ${b}`)]);
        } else pointSlides("section");
        continue;
      }
      if (isOfferStack(s)) {
        // The reflection beat before the offer: the coach's own private question on a moment slide. Its words, or no beat.
        if (s.offer && c.opening.reflectionPrompt) slides.push(slideOf({ n: n++, kind: "reflection", s: null, act: s.act, eyebrow: "A moment before we go on", headline: c.opening.reflectionPrompt, inverse: true }));
        if (s.offer) for (const b of offerBuild(s.offer, kit.showPriceAnchor !== false)) slides.push(slideOf({ n: n++, kind: "offer", s, headline: b.headline, body: b.body, footer, inverse: Boolean(b.price), figure: b.figure ?? null, ...(b.eyebrow ? { eyebrow: b.eyebrow } : {}) }));
        pointSlides("offer");
        continue;
      }
      pointSlides("section", s.sectionKey === QA_SECTION_KEY && s.objections.length ? [`Objections to hand: ${s.objections.map((o) => o.name).join("; ")}`] : []);
      // After the opening act's first section: who this is for and not for, off the Offer record, and the line for staying to the end.
      if (act.key === "opening" && s === act.sections.find((x) => x.status !== "omitted")) {
        // These are the record's, not the section's: no section key, so a section's own count and notes stay its own.
        if (c.fit.forYouIf) slides.push(slideOf({ n: n++, kind: "section", s: null, act: "opening", headline: FIT_HEADLINES.forYouIf, body: sentencesOf(c.fit.forYouIf).slice(0, 4), eyebrow: `Who it is for · ${ACT_LABEL.opening}` }));
        if (c.fit.notForYouIf) slides.push(slideOf({ n: n++, kind: "section", s: null, act: "opening", headline: FIT_HEADLINES.notForYouIf, body: sentencesOf(c.fit.notForYouIf).slice(0, 4), eyebrow: `Who it is for · ${ACT_LABEL.opening}` }));
        if (c.stayLine) slides.push(slideOf({ n: n++, kind: "section", s: null, act: "opening", headline: c.stayLine, eyebrow: `Stay to the end · ${ACT_LABEL.opening}` }));
      }
    }
    // A recap closes each belief act: the first line of every section that has one. Nothing new on it. "Has one" means a line that
    // can stand on a face: a section whose first key point is kept off (deck-face.ts) is quoted by its next, or not at all.
    const lines = act.sections.filter((s) => s.status !== "omitted").map((s) => s.keyPoints.map((p) => cleanFace(p).face).find(Boolean)).filter((l): l is string => Boolean(l));
    // Its headline is the act's own line (the belief's "To:", else the first line), never "Act 1 · Vehicle · recap" (§9).
    const recapHead = belief?.to?.trim() || lines[0];
    if (BELIEF_ACTS.has(act.key) && lines.length) slides.push(slideOf({ n: n++, kind: "recap", s: null, headline: recapHead, body: lines.filter((l) => l !== recapHead).slice(0, 6), eyebrow: act.label, act: act.key }));
  }
  // The close (first-deck §5: the deck ended on "Enrollment closes when the group starts."): always a call-to-action slide from
  // the Foundation's call to action, then a Q&A slide that keeps it on screen, both from the record whatever the Q&A section holds.
  if (c.close.cta) {
    slides.push(slideOf({ n: n++, kind: "close", s: null, act: "closing", eyebrow: "The next step", headline: c.close.cta, body: offer?.ctaFooter ? [offer.ctaFooter] : [], inverse: true }));
    slides.push(slideOf({ n: n++, kind: "close", s: null, act: "closing", eyebrow: "Q&A", headline: "Your questions", footer: offer?.ctaFooter ?? c.close.cta }));
  }
  // Each proof once (22 Sep: Kate A. on slides 20 and 22, Rachael C. on 21 and 36). A proof's home is its Proof Block slide, the
  // first in deck order; with none, the first line that quotes it. Any later appearance, a second Proof Block slide or a key
  // point quoting the same words (any of the proof's versions), comes off, unless the coach ticked "show it again" for that act.
  const repeatOk = new Set<string>(c.sections.filter((s) => s.proofRepeat).map((s) => s.act));
  const proofWords = new Map<string, { who: string; texts: string[] }>();
  for (const s of c.sections) if (s.proof) proofWords.set(proofKeyOf(s.proof), { who: s.proof.who, texts: s.proof.texts.map(normQuote).filter((t) => t.length >= QUOTE_MIN) });
  const home = new Map<string, Slide>();
  const repeated: { sl: Slide; key: string; text: string; whole: boolean }[] = [];
  for (const sl of slides) {
    if (!sl.proofKey) continue;
    if (!home.has(sl.proofKey)) home.set(sl.proofKey, sl);
    else if (!repeatOk.has(sl.act)) repeated.push({ sl, key: sl.proofKey, text: sl.headline, whole: true });
  }
  const gone = new Set(repeated.map((r) => r.sl));
  for (const sl of slides) {
    if (gone.has(sl) || sl.kind === "cover") continue;
    const lines = [sl.headline, ...sl.body];
    const stay = lines.filter((line, i) => {
      if (sl.proofKey && i === 0) return true; // the Proof Block slide's own quote
      const key = quotedProof(line, proofWords);
      if (!key || home.get(key) === sl) return true;
      if (!home.has(key)) {
        home.set(key, sl);
        return true;
      }
      if (repeatOk.has(sl.act)) return true;
      repeated.push({ sl, key, text: line, whole: false });
      return false;
    });
    if (stay.length === lines.length) continue;
    if (!stay.length) {
      gone.add(sl);
      continue;
    }
    const tier = headlineTier(stay[0]);
    sl.headline = tier.overflow ? sl.section : stay[0];
    sl.headlineSize = tier.overflow ? HEADLINE_FLOOR : tier.size;
    sl.body = tier.overflow ? stay : stay.slice(1);
  }
  for (let i = slides.length - 1; i >= 0; i--) if (gone.has(slides[i])) slides.splice(i, 1);
  // A slide the record filled with nothing but kept-off text is not a slide: its words go to the notes of the slide before it,
  // where the presenter meets them, and the deck is numbered again so every later line names the slide the coach will see.
  const keptOff: DeckResult["keptOff"] = [];
  const kept: Slide[] = [];
  for (const sl of slides) {
    if (!emptied(sl)) {
      kept.push(sl);
      continue;
    }
    const prev = kept.at(-1);
    if (prev) prev.notes.push(...sl.keptOff.map(notOnFace));
    for (const k of sl.keptOff) keptOff.push({ slide: null, section: sl.section || sl.eyebrow, cls: k.cls, text: k.text });
  }
  kept.forEach((sl, i) => {
    sl.n = i + 1;
    for (const k of sl.keptOff) keptOff.push({ slide: sl.n, section: sl.section || sl.eyebrow || "cover", cls: k.cls, text: k.text });
  });
  slides.splice(0, slides.length, ...kept);
  keptOff.sort((a, b) => (a.slide ?? 0) - (b.slide ?? 0));
  const repeats: DeckResult["repeats"] = [];
  for (const r of repeated) {
    const shownOn = home.get(r.key)!.n;
    const stays = !r.whole && slides.includes(r.sl);
    const who = proofWords.get(r.key)?.who || "This";
    if (stays) r.sl.notes.push(`Not shown again (${who}'s proof is on slide ${shownOn}): ${r.text}`);
    repeats.push({ slide: stays ? r.sl.n : null, section: r.sl.section || r.sl.eyebrow, who, shownOn, text: r.text });
  }
  const refused: string[] = [];
  // One currency per deck. With an offer, it is the offer's own field, and every price the deck composes is formatPrice of it;
  // a line the coach typed that names another currency refuses the export, naming the slide. Never rewritten: changing the
  // currency a price is stated in changes the claim. With no offer, the first currency a face names is the deck's.
  let deckCurrency: string | null = offer?.currency ?? null;
  for (const sl of slides) {
    const face = [sl.headline, ...sl.body, sl.footer ?? ""].join("\n");
    const where = `Slide ${sl.n} (${sl.section || sl.eyebrow || "cover"})`;
    if (!deckCurrency) deckCurrency = currenciesIn(face).find((c) => c !== "$") ?? null;
    const bad = deckCurrency ? currencyConflicts(face, deckCurrency) : [];
    if (bad.length) refused.push(`${where}: it names ${bad.map((c) => (c === "$" ? "dollars" : c)).join(" and ")}, but ${offer ? `the offer is priced in ${deckCurrency}` : `the deck is in ${deckCurrency}`}. One currency per deck: ${offer ? "set the currency on the Offer, or change the line" : "change the line"}.`);
  }
  // A recap only quotes its act's lines, so a hole on one is named once, at its source slide; the recap keeps the slot in its
  // count (two slides carry it) but adds no second line to the list.
  const named = new Set<string>();
  for (const sl of slides) {
    for (const p of sl.placeholders) {
      if (sl.kind === "recap" && named.has(p.text)) continue;
      named.add(p.text);
      if (p.refuse) refused.push(`Slide ${sl.n} (${sl.section || sl.eyebrow || "cover"}): ${p.why}`);
      else warnings.push(`Slide ${sl.n} (${sl.section || sl.eyebrow || "cover"}): ${p.why}`);
    }
    if (sl.overflow) warnings.push(`Slide ${sl.n} (${sl.section}): the key point is over ${HEADLINE_MAX_CHARS} characters, so it is the body and the section name stands as the headline. Shorten the key point to bring it back up.`);
  }
  const kitProblems = kitIn ? brandKitProblems(kitIn) : [];
  for (const p of kitProblems) refused.push(`Brand kit: ${p}`);
  if (!kitIn) warnings.push("No brand kit of your own yet: the deck uses the house starter kit. Replace it with your colours, faces and logo on Settings.");
  if (kitIn && !normaliseHex(kitIn.placeholder)) warnings.push(`The brand kit reserves no placeholder colour, so unfilled slots are drawn in ${PLACEHOLDER_FALLBACK}.`);
  // The spread (§3): never more than two picture slots in a row; the cover and a testimonial are never dropped.
  slides.splice(0, slides.length, ...spreadSlots(slides));
  return { slides, refused, warnings, placeholderCount: slides.reduce((a, sl) => a + sl.placeholders.length, 0), kit, kitApplied: Boolean(kitIn), openingOmitted, keptOff, repeats, echoes: echoed, footerBar: c.footerBar, ctaBar: c.ctaBar, ctaFooter: offer?.ctaFooter ?? null };
}

/**
 * The deck against the clock: slides a minute over the minutes a generator actually fills (Q&A netted off, as the reference
 * deck's 90 minutes were), per act too, and the offer's share. A count on its own says nothing; a count against a rate does.
 */
export type DeckPace = { slides: number; minutes: number; rate: number | null; acts: { key: string; label: string; slides: number; minutes: number; rate: number | null; thin: boolean }[]; offerSlides: number; /** Sections that carry key points, of those not left out: the deck reads only those. */ sectionsWithPoints: number; sections: number };
export function deckPace(c: WebinarContext, d: DeckResult): DeckPace {
  const qa = c.sections.find((s) => s.sectionKey === QA_SECTION_KEY);
  const per = (slides: number, minutes: number) => (minutes > 0 ? Math.round((slides / minutes) * 10) / 10 : null);
  const minutes = c.totalMin - (qa?.durationMin ?? 0);
  const acts = c.acts.map((a) => {
    const mins = a.durationMin - (a.key === "closing" ? (qa?.durationMin ?? 0) : 0);
    const count = d.slides.filter((s) => s.act === a.key && s.kind !== "cover").length;
    const rate = per(count, mins);
    return { key: a.key, label: a.label, slides: count, minutes: mins, rate, thin: rate !== null && rate < PACE_BAND[0] };
  });
  const live = c.sections.filter((s) => s.status !== "omitted");
  return { slides: d.slides.length, minutes, rate: per(d.slides.length, minutes), acts, offerSlides: d.slides.filter((s) => s.kind === "offer").length, sectionsWithPoints: live.filter((s) => s.keyPoints.length).length, sections: live.length };
}
/** "1 slide", "2 slides": the count and its noun agree. */
export const slidesWord = (n: number): string => `${n} ${n === 1 ? "slide" : "slides"}`;
/** "1 slide a minute", "1.3 slides a minute", "– slides a minute" with no minutes to pace against. */
export const perMinute = (rate: number | null): string => (rate === null ? "– slides a minute" : `${rate} ${rate === 1 ? "slide" : "slides"} a minute`);
/** The readout on the Deck step, one line. */
export function paceLine(p: DeckPace): string {
  const thin = p.acts.filter((a) => a.thin).map((a) => `${a.label} is at ${a.rate}`);
  // The reference carries its source in the sentence: an unsourced number becomes folklore. Each act is paced over its own
  // minutes with Q&A netted off, the way the reference was measured.
  // Two different numbers, said as what each is: the band is where a first draft should land; 1.7 is what the finished reference
  // deck ran at when delivered, so a draft is expected to sit under it. Read as one line they looked like a target outside its band.
  return `${slidesWord(p.slides)} · ~${p.minutes} min without Q&A · ${perMinute(p.rate)}. A first draft lands between ${PACE_BAND[0]} and ${PACE_BAND[1]}; the finished reference deck ran at ${REFERENCE_PACE} (a live 90-minute deck, Q&A not counted).${thin.length ? ` Thin: ${thin.join("; ")}, each over its own minutes without Q&A.` : ""} Offer segment is ${p.offerSlides} of ${slidesWord(p.slides)}.`;
}

/** The picture slots the deck suggests, in slide order, each with its kind and one-line instruction: what the Deck step lists as "not added" until the coach fills them. */
export function suggestedSlots(d: DeckResult): { slide: number; section: string; slot: Slot }[] {
  return d.slides.filter((s) => s.slot).map((s) => ({ slide: s.n, section: s.section || s.eyebrow || "cover", slot: s.slot! }));
}

/* ───────────── The render plan ───────────── */

export type TextBox = { slide: number; role: "eyebrow" | "headline" | "body" | "attribution" | "footer" | "cover-title" | "cover-presenter" | "cover-date" | "figure" | "struck" | "small"; text: string; size: number; color: string; fill: string | null; face: string; bold: boolean; italic: boolean; bullet: boolean; placeholder: boolean; /** Struck through: the total the price is set against (first-deck §5). */ strike?: boolean };
/** A rule drawn in the accent: the one thing the accent draws besides a fill. Never under text. */
export type Rule = { slide: number; color: string; y: number };
/** A picture's frame in inches on the 10×5.625 slide. A photo fills it, cropped (cover); evidence sits whole inside it (contain); nothing is ever stretched (src/lib/engine/deck-fit.ts). */
export type Frame = { x: number; y: number; w: number; h: number };
/** An empty picture slot on the face (§2): the frame the picture would take, a dashed outline and red text saying what to add. */
export type PlaceholderSlot = { frame: Frame; text: string; color: string };
/** Every label of the deck's own that may never reach a face (§9): the act names, the deck's section-less eyebrows, and the words of a label. The walk reads every face against this list and the record's section names. */
export const FACE_LABELS_NEVER = [...Object.values(ACT_LABEL), "Act 1", "Act 2", "Act 3", "Opening ·", "What you'll leave with", "Who it is for", "Stay to the end", "A moment before we go on", "· recap", "· story", "Vehicle Story", "Internal Story", "External Story"];
/** The slide's layout family (§4): the cover, a content slide, or a statement (one line, no body, vertically centred and large). */
export type SlideLayout = "cover" | "content" | "statement" | "figure";
export type SlidePlan = { n: number; background: string; boxes: TextBox[]; rules: Rule[]; notes: string; layout: SlideLayout; /** The CTA bar's line on this slide (first-deck §5): the offer and Q&A slides and the close, with the bar on; it then replaces the footer's CTA. */ ctaBar?: string | null; /** A slide that carries only the picture of the slide before it (§4: its text would not fit beside the picture even at the floor). */ pictureOnly: boolean; /** Where a filled picture sits, or null when the slide carries none. */ imageFrame: Frame | null; /** The red placeholder where a suggested picture is missing, or null when the slot is filled or the slide has none. The text keeps the picture-slide layout either way, so filling the slot later changes nothing else. */ placeholderSlot: PlaceholderSlot | null };

/**
 * The frame a filled picture occupies, by the slide's kind. The cover's picture fills the right half; every content slide's
 * picture sits in a right-hand column, and the text moves to a left column that never overlaps it. One frame per slot: a
 * before/after is one image the coach composes, a proof wall is one image, so nothing here needs two boxes. How the picture
 * sits inside the frame (covered or contained, by its kind) is the fit engine's call.
 */
export function slotFrame(kind: SlideKind): Frame {
  return kind === "cover" ? { x: 5.2, y: 0.9, w: 4.3, h: 3.85 } : { x: 5.35, y: 1.05, w: 4.15, h: 3.5 };
}
/** With a picture on the right, the text lives in this left column; without one, boxes keep their full-width geometry. */
export const TEXT_LEFT_ZONE = { x: 0.5, w: 4.5 };

/** The footer bar's logo box and the cover's (§4), inches: the route and the thumbnail both place the logo here. */
export const LOGO_BOX: Frame = { x: 9.0, y: 5.35, w: 0.9, h: 0.24 };
/** At least 2.5 in wide (first-deck brief §3, 5 Oct: at 1.8 by 0.55 a wordmark read as a smudge); still clear of the title. */
export const COVER_LOGO_BOX: Frame = { x: 0.5, y: 0.3, w: 2.6, h: 0.9 };
/** No logo anywhere (§3, Danno's decision): the cover says what to add, in the picture placeholders' style. Never the footer. */
export const COVER_LOGO_PLACEHOLDER = "Your logo here";
/** The contrast a logo needs against the cover before it stands on it bare; under it, it sits on a small badge of the kit's ground. */
export const LOGO_MIN_CONTRAST = 3;

/**
 * Which logo the cover carries, and on what (§3). The cover sits on the inverse ground when the kit has one, where a dark
 * wordmark vanishes: the kit's "Logo for dark backgrounds" goes there when it has one. With only the one logo, its measured
 * colour decides: under 3:1 on the cover's background, it sits on a badge of the kit's ground, unless the ground reads no
 * better (a white logo on a light kit stays bare). On a light cover the one logo stands as it is.
 */
export function coverLogoPlan(o: { coverBackground: string; ground: string; hasLogo: boolean; hasDark: boolean; logoColor: string | null }): { use: "logo" | "dark" | "none"; badge: string | null } {
  if (!o.hasLogo && !o.hasDark) return { use: "none", badge: null };
  const dark = normaliseHex(o.coverBackground) !== normaliseHex(o.ground);
  if (dark && o.hasDark) return { use: "dark", badge: null };
  if (!o.hasLogo) return { use: "none", badge: null };
  if (!dark || !o.logoColor) return { use: "logo", badge: null };
  const onCover = contrastRatio(o.logoColor, o.coverBackground);
  return { use: "logo", badge: onCover < LOGO_MIN_CONTRAST && contrastRatio(o.logoColor, o.ground) > onCover ? normaliseHex(o.ground) : null };
}
/** The badge behind a logo placed in its box: the drawn picture with a margin, never past the slide's edge. */
export function logoBadgeFrame(placed: Frame, pad = 0.1): Frame {
  const x = Math.max(0.05, placed.x - pad);
  const y = Math.max(0.05, placed.y - pad);
  return { x, y, w: placed.w + (placed.x - x) + pad, h: placed.h + (placed.y - y) + pad };
}

/** The file's layouts (§6.6): one master, a layout per slide family, each with real placeholders where slideGeometry puts them. */
export const SLIDE_MASTERS = ["COVER", "COVER_PICTURE", "CONTENT", "CONTENT_PICTURE", "STATEMENT", "STATEMENT_PICTURE", "PICTURE_ONLY"] as const;
export type SlideMaster = (typeof SLIDE_MASTERS)[number];
/** Which layout a planned slide sits on: its family, and whether a picture (or an empty slot's frame) narrows the text. */
export function masterFor(plan: Pick<SlidePlan, "boxes" | "layout" | "imageFrame" | "placeholderSlot" | "pictureOnly">): SlideMaster {
  if (plan.pictureOnly) return "PICTURE_ONLY";
  const picture = Boolean(plan.imageFrame ?? plan.placeholderSlot);
  const family = plan.boxes.some((b) => b.role === "cover-title") ? "COVER" : plan.layout === "statement" ? "STATEMENT" : "CONTENT";
  return (picture ? `${family}_PICTURE` : family) as SlideMaster;
}
/** The geometry a layout's placeholders take: the same slideGeometry, over a plan of that family. */
export function masterGeometry(master: SlideMaster): SlideGeometry {
  const picture = master.endsWith("_PICTURE");
  const family = master.replace("_PICTURE", "");
  const box = (role: TextBox["role"]): TextBox => ({ slide: 0, role, text: "", size: 0, color: "", fill: null, face: "", bold: false, italic: false, bullet: false, placeholder: false });
  if (master === "PICTURE_ONLY") return slideGeometry({ boxes: [], layout: "content", imageFrame: PICTURE_ONLY_FRAME, placeholderSlot: null, pictureOnly: true });
  const boxes = family === "COVER" ? [box("cover-title"), box("cover-presenter")] : family === "STATEMENT" ? [box("eyebrow"), box("headline"), box("footer")] : [box("eyebrow"), box("headline"), box("body"), box("footer")];
  return slideGeometry({ boxes, layout: family === "COVER" ? "cover" : family === "STATEMENT" ? "statement" : "content", imageFrame: picture ? slotFrame(family === "COVER" ? "cover" : "section") : null, placeholderSlot: null, pictureOnly: false });
}

/** Where a text box sits on the 10 by 5.625 in slide, and how its text is set inside it. */
export type BoxGeometry = Frame & { align: "left" | "center"; valign: "top" | "middle" };
/** Every box's place on one slide (§6.4): the route draws from this and the Deck step's thumbnail draws the same, so the two cannot drift. */
export type SlideGeometry = { boxes: Partial<Record<TextBox["role"], BoxGeometry>>; /** The body lines share one box. */ body: BoxGeometry | null; rules: { x: number; w: number } };

/**
 * The geometry of a planned slide. A filled slot's frame, or the empty slot's, puts the text in the left column; without one
 * the boxes keep the full width. The cover sets its title and presenter centred on a bare cover and left beside a picture; a
 * statement (§4) sits vertically centred and large; a content headline sits at the top of its box over the body's box.
 */
export function slideGeometry(plan: Pick<SlidePlan, "boxes" | "layout" | "imageFrame" | "placeholderSlot" | "pictureOnly">): SlideGeometry {
  const frame = plan.imageFrame ?? plan.placeholderSlot?.frame ?? null;
  const zone = frame ? TEXT_LEFT_ZONE : { x: 0.5, w: 9 };
  const bodyZone = frame ? { x: TEXT_LEFT_ZONE.x + 0.2, w: TEXT_LEFT_ZONE.w - 0.2 } : { x: 0.7, w: 8.6 };
  const boxes: SlideGeometry["boxes"] = {};
  let body: BoxGeometry | null = null;
  if (plan.pictureOnly) return { boxes, body, rules: { x: 0.5, w: 9 } };
  if (plan.boxes.some((b) => b.role === "cover-title")) {
    // The title, then air, then the presenter and the date (first-deck §4: the title and the name touched).
    boxes["cover-title"] = frame ? { x: zone.x, y: 1.4, w: zone.w, h: 1.8, align: "left", valign: "middle" } : { x: 0.5, y: 1.35, w: 9, h: 1.6, align: "center", valign: "middle" };
    boxes["cover-presenter"] = frame ? { x: zone.x, y: 3.55, w: zone.w, h: 0.45, align: "left", valign: "top" } : { x: 0.5, y: 3.35, w: 9, h: 0.45, align: "center", valign: "top" };
    boxes["cover-date"] = frame ? { x: zone.x, y: 4.0, w: zone.w, h: 0.45, align: "left", valign: "top" } : { x: 0.5, y: 3.8, w: 9, h: 0.45, align: "center", valign: "top" };
  } else if (plan.layout === "figure") {
    // A figure slide (first-deck §5): the line at the top, the struck total (or the item's line) over the figure, the small
    // lines under it. Full width: a price or a value slide carries no picture.
    boxes.eyebrow = { x: 0.5, y: 0.25, w: 9, h: 0.4, align: "left", valign: "top" };
    boxes.headline = { x: 0.5, y: 0.8, w: 9, h: 0.8, align: "left", valign: "top" };
    boxes.struck = { x: 0.5, y: 1.65, w: 9, h: 0.55, align: "center", valign: "middle" };
    boxes.figure = { x: 0.5, y: 2.2, w: 9, h: 1.5, align: "center", valign: "middle" };
    boxes.small = { x: 0.5, y: 3.75, w: 9, h: 1.15, align: "center", valign: "top" };
    if (plan.boxes.some((b) => b.role === "body")) body = { x: 0.5, y: 1.65, w: 9, h: 0.55, align: "center", valign: "top" };
    boxes.footer = { x: 0.5, y: 5.0, w: 9, h: 0.3, align: "center", valign: "top" };
  } else {
    boxes.eyebrow = { x: zone.x, y: 0.25, w: zone.w, h: 0.4, align: "left", valign: "top" };
    boxes.headline = plan.layout === "statement" ? { x: zone.x, y: 1.0, w: zone.w, h: 3.4, align: "left", valign: "middle" } : { x: zone.x, y: 0.8, w: zone.w, h: 1.5, align: "left", valign: "top" };
    if (plan.boxes.some((b) => b.role === "body" || b.role === "attribution")) body = { x: bodyZone.x, y: 2.4, w: bodyZone.w, h: 2.4, align: "left", valign: "top" };
    boxes.footer = { x: 0.5, y: 5.0, w: 9, h: 0.3, align: "center", valign: "top" };
  }
  return { boxes, body, rules: { x: 0.5, w: frame ? zone.w : 9 } };
}

/**
 * Every box the renderer will draw, with the kit's hex written verbatim: no tint, no derived shade. Text sits on ground only.
 * Accent draws rules and fills, never letters: every text box is ink or muted (both refused under 4.5:1 by the kit rules), and
 * the accent's one appearance is the rule under the eyebrow, so text in or on the accent cannot arrive without this changing.
 */
export function renderPlan(d: DeckResult, withImage: Set<number> = new Set(), dropped: Set<number> = new Set()): SlidePlan[] {
  const k = d.kit;
  const hex = (v: string) => normaliseHex(v);
  const placeholderColor = hex(k.placeholder ?? "") || PLACEHOLDER_FALLBACK;
  const hasInverse = Boolean(hex(k.inverseGround ?? "") && hex(k.inverseInk ?? ""));
  const plans: SlidePlan[] = [];
  for (const s of d.slides) {
    let imageFrame = withImage.has(s.n) ? slotFrame(s.kind) : null;
    // A slot the coach said they don't have (§6.3) is no slot: no placeholder, and the text keeps the full width.
    let placeholderSlot = !imageFrame && s.slot && !dropped.has(s.n) ? { frame: slotFrame(s.kind), text: placeholderLine(s.slot), color: PLACEHOLDER_RED } : null;
    const boxes: TextBox[] = [];
    const mark = (text: string) => placeholdersIn(text).length > 0;
    // The dark surfaces take the inverse pair when the kit has one; on it every letter is inverseInk, the one pair the kit checked.
    const dark = s.inverse && hasInverse;
    const ink = dark ? hex(k.inverseInk!) : hex(k.ink);
    const muted = dark ? hex(k.inverseInk!) : hex(k.muted);
    if (s.kind === "cover") {
      boxes.push({ slide: s.n, role: "cover-title", text: s.headline, size: s.headlineSize, color: ink, fill: null, face: k.displayFont, bold: true, italic: false, bullet: false, placeholder: false });
      boxes.push({ slide: s.n, role: "cover-presenter", text: s.body[0] ?? "", size: COVER_LINE_SIZE, color: muted, fill: null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: false });
      if (s.body[1]) boxes.push({ slide: s.n, role: "cover-date", text: s.body[1], size: COVER_LINE_SIZE, color: muted, fill: null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: false });
    } else if (s.figure) {
      // The price or an item's value as a figure (first-deck §5). Ink and muted only, as everywhere: the accent never sets letters.
      const f = s.figure;
      boxes.push({ slide: s.n, role: "headline", text: s.headline, size: fitSize(s.headline, { w: 9, h: 0.8 }, [...new Set([s.headlineSize, ...HEADLINE_TIERS.map((t) => t.size).filter((z) => z < s.headlineSize), HEADLINE_FLOOR])].sort((a, b) => b - a)) ?? HEADLINE_FLOOR, color: ink, fill: null, face: k.displayFont, bold: true, italic: false, bullet: false, placeholder: false });
      if (s.body[0]) boxes.push({ slide: s.n, role: "body", text: s.body[0], size: SMALL_SIZE + 2, color: ink, fill: null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: false });
      if (f.struck) boxes.push({ slide: s.n, role: "struck", text: f.struck, size: STRUCK_SIZE, color: muted, fill: null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: false, strike: true });
      boxes.push({ slide: s.n, role: "figure", text: f.value, size: fitSize(f.value, { w: 9, h: 1.5 }, f.size === "price" ? PRICE_SIZES : VALUE_SIZES) ?? (f.size === "price" ? PRICE_SIZES : VALUE_SIZES).at(-1)!, color: ink, fill: null, face: k.displayFont, bold: true, italic: false, bullet: false, placeholder: false });
      if (f.small.length) boxes.push({ slide: s.n, role: "small", text: f.small.join("\n"), size: SMALL_SIZE, color: muted, fill: null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: false });
    } else {
      // No eyebrow on any face (§9, Danno): the section and act names live in the notes and on the Deck step. The accent rule stays.
      boxes.push({ slide: s.n, role: "headline", text: s.headline, size: s.headlineSize, color: ink, fill: mark(s.headline) ? placeholderColor : null, face: s.kind === "proof" && k.quoteFont ? k.quoteFont : k.displayFont, bold: s.kind !== "proof", italic: s.kind === "proof", bullet: false, placeholder: mark(s.headline) });
      for (const line of s.body) {
        const attribution = s.kind === "proof" && line.startsWith("— ");
        boxes.push({ slide: s.n, role: attribution ? "attribution" : "body", text: line, size: attribution ? EYEBROW_SIZE + 3 : BODY_SIZE, color: attribution ? muted : ink, fill: mark(line) ? placeholderColor : null, face: k.bodyFont, bold: false, italic: false, bullet: !attribution && s.kind !== "offer" && s.kind !== "divider", placeholder: mark(line) });
      }
    }
    // The CTA once (first-deck §5): with the CTA bar on, the bar carries the offer's line and the footer does not repeat it.
    const ctaAsBar = Boolean(d.ctaBar && d.ctaFooter && s.footer === d.ctaFooter);
    if (s.kind !== "cover") {
      if (s.footer && !ctaAsBar) boxes.push({ slide: s.n, role: "footer", text: s.footer, size: EYEBROW_SIZE, color: muted, fill: mark(s.footer) ? placeholderColor : null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: mark(s.footer) });
    }
    // The fit (§4): text beside a picture lives in the left column, so the headline steps down its tiers and the body its sizes
    // until each fits its box; when the body cannot fit beside the picture even at the floor, the picture takes the next slide
    // and this one keeps the full width. A one-line slide with no body is a statement: centred, large by its length.
    const background = dark ? hex(k.inverseGround!) : hex(k.ground);
    const notes = s.notes.join("\n");
    const rules = s.kind === "cover" ? [] : [{ slide: s.n, color: hex(k.accent), y: 0.68 }];
    const headlineBox = boxes.find((b) => b.role === "headline");
    const bodyBoxes = boxes.filter((b) => b.role === "body" || b.role === "attribution");
    let layout: SlideLayout = s.kind === "cover" ? "cover" : s.figure ? "figure" : "content";
    let pictureOnly = false;
    const ctaBar = ctaAsBar ? s.footer : null;
    if (s.kind !== "cover" && !s.figure) {
      const narrow = Boolean(imageFrame || placeholderSlot);
      const zoneW = narrow ? TEXT_LEFT_ZONE.w : 9;
      if (headlineBox && !bodyBoxes.length) {
        layout = "statement";
        const sizes = [...STATEMENT_SIZES.filter((t) => headlineBox.text.trim().length <= t.maxChars).map((t) => t.size), ...HEADLINE_TIERS.map((t) => t.size).filter((z) => z <= headlineBox.size), HEADLINE_FLOOR];
        headlineBox.size = fitSize(headlineBox.text, { w: zoneW, h: 3.4 }, [...new Set(sizes)].sort((a, b) => b - a)) ?? HEADLINE_FLOOR;
      } else if (headlineBox) {
        const tiers = [...new Set([headlineBox.size, ...HEADLINE_TIERS.map((t) => t.size).filter((z) => z < headlineBox.size), HEADLINE_FLOOR])].sort((a, b) => b - a);
        headlineBox.size = fitSize(headlineBox.text, { w: zoneW, h: 1.5 }, tiers) ?? HEADLINE_FLOOR;
      }
      if (bodyBoxes.length) {
        const text = bodyBoxes.map((b) => b.text).join("\n");
        let size = fitSize(text, { w: narrow ? TEXT_LEFT_ZONE.w - 0.2 : 8.6, h: 2.4 }, BODY_FIT_SIZES);
        if (size === null && narrow) {
          // The picture to its own slide; this one keeps the full width and fits again.
          pictureOnly = true;
          size = fitSize(text, { w: 8.6, h: 2.4 }, BODY_FIT_SIZES) ?? BODY_FIT_SIZES[BODY_FIT_SIZES.length - 1];
          if (headlineBox) headlineBox.size = fitSize(headlineBox.text, { w: 9, h: 1.5 }, [...new Set([s.headlineSize, ...HEADLINE_TIERS.map((t) => t.size).filter((z) => z < s.headlineSize), HEADLINE_FLOOR])].sort((a, b) => b - a)) ?? HEADLINE_FLOOR;
        }
        for (const b of bodyBoxes) if (b.role === "body") b.size = size ?? BODY_FIT_SIZES[BODY_FIT_SIZES.length - 1];
      }
    }
    if (pictureOnly) {
      const picture = { imageFrame: imageFrame ? PICTURE_ONLY_FRAME : null, placeholderSlot: placeholderSlot ? { ...placeholderSlot, frame: PICTURE_ONLY_FRAME } : null };
      imageFrame = null;
      placeholderSlot = null;
      plans.push({ n: s.n, background, boxes, rules, notes, layout, ctaBar, pictureOnly: false, imageFrame, placeholderSlot });
      plans.push({ n: s.n, background, boxes: [], rules: [], notes: "The picture for the slide before: its text would not fit beside it.", layout: "content", ctaBar: null, pictureOnly: true, ...picture });
      continue;
    }
    plans.push({ n: s.n, background, boxes, rules, notes, layout, ctaBar, pictureOnly, imageFrame, placeholderSlot });
  }
  return plans;
}

/** A figure slide's words in reading order, for the outline and the Deck step: the struck total, the figure, the small lines. */
export const figureLines = (s: Pick<Slide, "figure">): string[] => (s.figure ? [...(s.figure.struck ? [`${s.figure.struck} (struck through)`] : []), s.figure.value, ...s.figure.small] : []);

/** The plain-text outline: what the .txt export and the Deck step's copy carry. Never the notes' art direction on a face. */
export function outlineText(title: string, d: DeckResult): string {
  return [title, `Deck outline · ${d.slides.length} slides${d.placeholderCount ? ` · ${d.placeholderCount} unfilled on slides` : ""}`, "", ...d.slides.flatMap((s) => [`${s.n}. ${s.headline}`, s.eyebrow ? `   ${s.eyebrow}` : "", ...s.body.map((b) => `   - ${b}`), ...figureLines(s).map((b) => `   - ${b}`), ""])].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

/**
 * The deck refuses only on what it renders, and the run sheet counts the whole section because the presenter reads all of it
 * aloud. This names the difference: per section, the placeholders the deck shows on a slide and the ones it does not.
 */
export function offSlidePlaceholders(c: WebinarContext, d: DeckResult): { total: number; offSlide: number; sections: { section: string; onSlide: string[]; offSlide: string[] }[] } {
  const shown = new Map<string, Set<string>>();
  for (const sl of d.slides) {
    if (!sl.sectionKey) continue;
    const set = shown.get(sl.sectionKey) ?? new Set<string>();
    for (const p of sl.placeholders) set.add(p.text);
    shown.set(sl.sectionKey, set);
  }
  const sections = c.sections
    .filter((s) => s.placeholders.length)
    .map((s) => ({ section: s.name, onSlide: s.placeholders.filter((t) => shown.get(s.sectionKey)?.has(t)), offSlide: s.placeholders.filter((t) => !shown.get(s.sectionKey)?.has(t)) }));
  return { total: sections.reduce((a, s) => a + s.onSlide.length + s.offSlide.length, 0), offSlide: sections.reduce((a, s) => a + s.offSlide.length, 0), sections };
}
