/**
 * The deck, from the record: every slide is built from what the resolver found wired to a section, and nothing a slide says
 * is something the record does not know. Pure. Two outputs: the slides (what a person reads on the Deck step and in the
 * outline) and the render plan (every text box with its size, face and colours, so the renderer is a mapping and the rules
 * about colour and truncation can be tested here rather than caught on a screen).
 */
import { formatPrice } from "./offer-score";
import { brandKitProblems, normaliseHex } from "./subject";
import { QA_SECTION_KEY, placeholdersIn, type ResolvedOffer, type SectionContext, type WebinarContext } from "./webinar-context";

/** The brand as the renderer reads it. Null renders the neutral kit and says so. */
export type DeckKit = { name: string; ground: string; ink: string; accent: string; muted: string; surface: string; inverseGround?: string | null; inverseInk?: string | null; displayFont: string; bodyFont: string; quoteFont?: string | null; fontFallback: string; bannedColors: string[]; placeholder?: string | null; /** The price against the total (the anchor). Undefined means on: the control. */ showPriceAnchor?: boolean | null };
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

export type SlideKind = "cover" | "divider" | "recap" | "section" | "proof" | "evidence" | "story" | "offer" | "opening" | "reflection";
/** A picture slot the deck suggests by rule from the slide's kind. The coach fills it from their image library; empty, it lists on the Deck step and the slide exports as text. Never on the price slide. */
export type SlotKind = "photo" | "photo_pair" | "screenshot" | "screenshot_callout" | "proof_wall" | "testimonial" | "diagram";
export type Slot = { key: string; kind: SlotKind; what: string };
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
  /** The offer's one line, on every slide from the offer onward. */
  footer: string | null;
  /** The picture slot this slide suggests, or null. Filled by the coach from the image library; empty here, listed on the Deck step. */
  slot: Slot | null;
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

type SlideInput = { n: number; kind: SlideKind; s: SectionContext | null; headline: string; body?: string[]; extraNotes?: string[]; eyebrow?: string; act?: string; inverse?: boolean; footer?: string | null; slot?: Slot | null };
function slideOf(i: SlideInput): Slide {
  const { n, kind, s } = i;
  const body = i.body ?? [];
  const tier = headlineTier(i.headline);
  const headline = tier.overflow ? (s?.name ?? "") : i.headline.trim();
  const finalBody = tier.overflow ? [i.headline.trim(), ...body] : body;
  const notes = [s ? `Section: ${s.name}` : "", direction(kind, finalBody) ? `Visual direction: ${direction(kind, finalBody)}` : "", s?.deliveryNote ? `Delivery: ${s.deliveryNote}` : "", ...(i.extraNotes ?? [])].filter(Boolean);
  const footer = i.footer ?? null;
  // The footer is the offer's line on a price slide: a hole in it refuses as clause (b) does, on every slide it sits on.
  const placeholders = [...placeholderHits(kind, [headline, ...finalBody]), ...(footer ? placeholderHits("offer", [footer]) : [])].filter((h, idx, all) => all.findIndex((x) => x.text === h.text) === idx);
  return { slot: i.slot ?? null, n, kind, sectionKey: s?.sectionKey ?? null, section: s?.name ?? "", act: i.act ?? s?.act ?? "opening", eyebrow: i.eyebrow ?? (s ? `${s.name} · ${ACT_LABEL[s.act] ?? s.act}` : ""), headline, headlineSize: tier.overflow ? HEADLINE_FLOOR : tier.size, body: finalBody, notes, placeholders, overflow: tier.overflow, inverse: Boolean(i.inverse), footer };
}

/**
 * The offer as a build, read off the Offer record: one slide per item, the running total re-shown after each, then the price
 * against the total (the anchor, the standard close and the control), the payment plan, the guarantee, and the scarcity and
 * urgency lines only when the offer carries them. The total is a real sum or it is not shown: any item without a value and no
 * total renders anywhere, because a total that quietly leaves an item out is a wrong number. With the kit's price anchor off
 * (a house policy some brands hold), the comparison is not drawn and the price stands on its own; everything else still renders.
 */
export function offerBuild(o: ResolvedOffer, showPriceAnchor = true): { headline: string; body: string[] }[] {
  const items = o.components.filter((x) => x.type !== "guarantee");
  const totals = items.length > 0 && items.every((x) => x.perceivedValue > 0);
  const out: { headline: string; body: string[] }[] = [];
  let running = 0;
  for (const x of items) {
    running += x.perceivedValue;
    const line = (x.oneLiner ?? x.description ?? "").trim();
    out.push({ headline: x.name, body: [...(line ? [line] : []), ...(totals ? [`Total value so far: ${formatPrice(running, o.currency)}`] : [])] });
  }
  const saving = totals ? running - o.price : 0;
  const anchor = totals && showPriceAnchor;
  out.push({ headline: o.name, body: [...(anchor ? [`Total value: ${formatPrice(running, o.currency)}`, `Your price: ${formatPrice(o.price, o.currency)}`, ...(saving > 0 ? [`You save ${formatPrice(saving, o.currency)}`] : [])] : [formatPrice(o.price, o.currency)]), ...(o.paymentPlan ? [`Payment plan: ${o.paymentPlan}`] : [])] });
  if (o.guarantee) out.push({ headline: o.guarantee, body: [] });
  if (o.scarcity) out.push({ headline: o.scarcity, body: [] });
  if (o.urgency) out.push({ headline: o.urgency, body: [] });
  return out;
}

/** The slides for one webinar: one read of the resolver, nothing invented, nothing narrated. One idea per slide. */
export function deckSlides(c: WebinarContext, kitIn: DeckKit | null): DeckResult {
  const kit = kitIn ?? NEUTRAL_KIT;
  const slides: Slide[] = [];
  const warnings: string[] = [];
  let n = 1;
  const offer = c.sections.find((s) => s.offer)?.offer ?? null;
  const stackOrder = c.sections.find(isOfferStack)?.order ?? Infinity;
  // The footer runs from the offer onward: every slide of a section at or after the Offer Stack.
  const footerFor = (s: SectionContext) => (offer?.ctaFooter && s.order >= stackOrder ? offer.ctaFooter : null);
  slides.push({ slot: { key: "cover:photo", kind: "photo", what: SLOT_WHAT.photo }, n: n++, kind: "cover", sectionKey: null, section: "", act: "opening", eyebrow: "", headline: c.title, headlineSize: headlineTier(c.title).size, body: [c.presenter], notes: [`Presented by ${c.presenter}.`, `Faces: ${kit.displayFont} for headlines, ${kit.bodyFont} for body. If a face is missing on this machine, use ${kit.fontFallback}.`], placeholders: [], overflow: false, inverse: true, footer: null });
  // The opening contract, before any content: each of the coach's own lines is one slide; a line the coach left empty is not a
  // slide (omitted, listed on the Deck step), never a placeholder on a face. The order is the reference deck's.
  const openingOmitted: string[] = [];
  const openSlide = (label: string, text: string | null, headline?: string, body?: string[]) => {
    if (!text) { openingOmitted.push(label); return; }
    slides.push(slideOf({ n: n++, kind: "opening", s: null, act: "opening", eyebrow: `Opening · ${label}`, headline: headline ?? text, body: body ?? [] }));
  };
  openSlide("The promise", c.opening.promiseLine);
  openSlide("Say hi in the chat", c.opening.chatPrompt);
  openSlide("Ground rule", c.opening.groundRule);
  if (c.opening.outcomes.length) slides.push(slideOf({ n: n++, kind: "opening", s: null, act: "opening", eyebrow: "Opening · What you'll leave with", headline: "By the end you'll have", body: c.opening.outcomes.slice(0, 3) }));
  else openingOmitted.push("Three outcomes");
  openSlide("My goal today", c.opening.sessionGoal);
  openSlide("Permission to be direct", c.opening.permissionLine);
  for (const act of c.acts) {
    const belief = act.sections.find((s) => s.belief)?.belief ?? null;
    // A divider opens each belief act: the act's label the wizard already holds, and the shift it makes, from the record.
    if (BELIEF_ACTS.has(act.key)) slides.push(slideOf({ n: n++, kind: "divider", s: null, headline: act.label, body: belief ? [`From: ${belief.from}`, `To: ${belief.to}`] : [], eyebrow: act.label, act: act.key, inverse: true }));
    for (const s of act.sections) {
      if (s.status === "omitted") continue;
      const points = s.keyPoints;
      const footer = footerFor(s);
      // One key point per slide, each under the section's eyebrow: the builder's own rule, kept by the exporter. A section set to
      // reveal builds instead: the first point as the line, then the same line with each further point added beneath it.
      const pointSlides = (kind: SlideKind, extraOnFirst: string[] = []) =>
        points.forEach((p, i) => slides.push(slideOf(s.buildStyle === "reveal" ? { n: n++, kind, s, headline: points[0], body: points.slice(1, i + 1), extraNotes: i === 0 ? extraOnFirst : [], footer } : { n: n++, kind, s, headline: p, extraNotes: i === 0 ? extraOnFirst : [], footer })));
      // The origin story's beats are the Credibility / Origin section's own slides, one each, before its key points.
      if (isOrigin(s)) for (const b of c.originStory) slides.push(slideOf({ n: n++, kind: "section", s, headline: b.text, eyebrow: `${s.name} · ${b.label}`, footer, slot: { key: `${s.sectionKey}:${b.key}:photo`, kind: "photo", what: SLOT_WHAT.photo } }));
      if (isProofBlock(s)) {
        // From the bank or the shelf, as they store it; failing both, no slide. Never a sentence about the slide's own absence.
        if (s.proof) slides.push(slideOf({ n: n++, kind: "proof", s, headline: `“${s.proof.quote}”`, body: s.proof.who ? [`— ${s.proof.who}`] : [], footer, slot: { key: `${s.sectionKey}:testimonial`, kind: "testimonial", what: SLOT_WHAT.testimonial } }));
        else if (s.evidence) slides.push(slideOf({ n: n++, kind: "evidence", s, headline: s.evidence.claim, body: [s.evidence.citation], footer, slot: { key: `${s.sectionKey}:screenshot_callout`, kind: "screenshot_callout", what: SLOT_WHAT.screenshot_callout } }));
        pointSlides("proof");
        continue;
      }
      if (isCaseStudy(s)) {
        if (s.story) slides.push(slideOf({ n: n++, kind: "story", s, headline: s.story.name, body: sentencesOf(s.story.body).slice(0, 3), footer, slot: { key: `${s.sectionKey}:photo`, kind: "photo", what: SLOT_WHAT.photo } }));
        else pointSlides("section");
        continue;
      }
      if (isOfferStack(s)) {
        // The reflection beat before the offer: the coach's own private question on a moment slide. Its words, or no beat.
        if (s.offer && c.opening.reflectionPrompt) slides.push(slideOf({ n: n++, kind: "reflection", s: null, act: s.act, eyebrow: "A moment before we go on", headline: c.opening.reflectionPrompt, inverse: true }));
        if (s.offer) for (const b of offerBuild(s.offer, kit.showPriceAnchor !== false)) slides.push(slideOf({ n: n++, kind: "offer", s, headline: b.headline, body: b.body, footer, inverse: b.headline === s.offer.name }));
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
    // A recap closes each belief act: the first line of every section that has one. Nothing new on it.
    const lines = act.sections.filter((s) => s.status !== "omitted" && s.keyPoints.length).map((s) => s.keyPoints[0]);
    if (BELIEF_ACTS.has(act.key) && lines.length) slides.push(slideOf({ n: n++, kind: "recap", s: null, headline: `${act.label} · recap`, body: lines.slice(0, 6), eyebrow: act.label, act: act.key }));
  }
  const refused: string[] = [];
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
  if (!kitIn) warnings.push("No brand kit on this workspace: rendered black on white with no brand applied. Add the kit on Settings.");
  if (kitIn && !normaliseHex(kitIn.placeholder)) warnings.push(`The brand kit reserves no placeholder colour, so unfilled slots are drawn in ${PLACEHOLDER_FALLBACK}.`);
  return { slides, refused, warnings, placeholderCount: slides.reduce((a, sl) => a + sl.placeholders.length, 0), kit, kitApplied: Boolean(kitIn), openingOmitted, footerBar: c.footerBar, ctaBar: c.ctaBar, ctaFooter: offer?.ctaFooter ?? null };
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
/** The readout on the Deck step, one line. */
export function paceLine(p: DeckPace): string {
  const thin = p.acts.filter((a) => a.thin).map((a) => `${a.label} is at ${a.rate}`);
  // The reference carries its source in the sentence: an unsourced number becomes folklore. Each act is paced over its own
  // minutes with Q&A netted off, the way the reference was measured.
  return `${p.slides} slides · ~${p.minutes} min without Q&A · ${p.rate ?? "–"} slides a minute. Reference pace is ${REFERENCE_PACE}, measured from a live 90-minute deck with Q&A not counted; the band is ${PACE_BAND[0]} to ${PACE_BAND[1]}.${thin.length ? ` Thin: ${thin.join("; ")}, each over its own minutes without Q&A.` : ""} Offer segment is ${p.offerSlides} of ${p.slides} slides.`;
}

/** The picture slots the deck suggests, in slide order, each with its kind and one-line instruction: what the Deck step lists as "not added" until the coach fills them. */
export function suggestedSlots(d: DeckResult): { slide: number; section: string; slot: Slot }[] {
  return d.slides.filter((s) => s.slot).map((s) => ({ slide: s.n, section: s.section || s.eyebrow || "cover", slot: s.slot! }));
}

/* ───────────── The render plan ───────────── */

export type TextBox = { slide: number; role: "eyebrow" | "headline" | "body" | "attribution" | "footer" | "cover-title" | "cover-presenter"; text: string; size: number; color: string; fill: string | null; face: string; bold: boolean; italic: boolean; bullet: boolean; placeholder: boolean };
/** A rule drawn in the accent: the one thing the accent draws besides a fill. Never under text. */
export type Rule = { slide: number; color: string; y: number };
export type SlidePlan = { n: number; background: string; boxes: TextBox[]; rules: Rule[]; notes: string };

/**
 * Every box the renderer will draw, with the kit's hex written verbatim: no tint, no derived shade. Text sits on ground only.
 * Accent draws rules and fills, never letters: every text box is ink or muted (both refused under 4.5:1 by the kit rules), and
 * the accent's one appearance is the rule under the eyebrow, so text in or on the accent cannot arrive without this changing.
 */
export function renderPlan(d: DeckResult): SlidePlan[] {
  const k = d.kit;
  const hex = (v: string) => normaliseHex(v);
  const placeholderColor = hex(k.placeholder ?? "") || PLACEHOLDER_FALLBACK;
  const hasInverse = Boolean(hex(k.inverseGround ?? "") && hex(k.inverseInk ?? ""));
  return d.slides.map((s) => {
    const boxes: TextBox[] = [];
    const mark = (text: string) => placeholdersIn(text).length > 0;
    // The dark surfaces take the inverse pair when the kit has one; on it every letter is inverseInk, the one pair the kit checked.
    const dark = s.inverse && hasInverse;
    const ink = dark ? hex(k.inverseInk!) : hex(k.ink);
    const muted = dark ? hex(k.inverseInk!) : hex(k.muted);
    if (s.kind === "cover") {
      boxes.push({ slide: s.n, role: "cover-title", text: s.headline, size: s.headlineSize, color: ink, fill: null, face: k.displayFont, bold: true, italic: false, bullet: false, placeholder: false });
      boxes.push({ slide: s.n, role: "cover-presenter", text: s.body[0] ?? "", size: BODY_SIZE, color: muted, fill: null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: false });
    } else {
      boxes.push({ slide: s.n, role: "eyebrow", text: s.eyebrow, size: EYEBROW_SIZE, color: muted, fill: null, face: k.displayFont, bold: false, italic: false, bullet: false, placeholder: false });
      boxes.push({ slide: s.n, role: "headline", text: s.headline, size: s.headlineSize, color: ink, fill: mark(s.headline) ? placeholderColor : null, face: s.kind === "proof" && k.quoteFont ? k.quoteFont : k.displayFont, bold: s.kind !== "proof", italic: s.kind === "proof", bullet: false, placeholder: mark(s.headline) });
      for (const line of s.body) {
        const attribution = s.kind === "proof" && line.startsWith("— ");
        boxes.push({ slide: s.n, role: attribution ? "attribution" : "body", text: line, size: attribution ? EYEBROW_SIZE + 3 : BODY_SIZE, color: attribution ? muted : ink, fill: mark(line) ? placeholderColor : null, face: k.bodyFont, bold: false, italic: false, bullet: !attribution && s.kind !== "offer" && s.kind !== "divider", placeholder: mark(line) });
      }
      if (s.footer) boxes.push({ slide: s.n, role: "footer", text: s.footer, size: EYEBROW_SIZE, color: muted, fill: mark(s.footer) ? placeholderColor : null, face: k.bodyFont, bold: false, italic: false, bullet: false, placeholder: mark(s.footer) });
    }
    return { n: s.n, background: dark ? hex(k.inverseGround!) : hex(k.ground), boxes, rules: s.kind === "cover" ? [] : [{ slide: s.n, color: hex(k.accent), y: 0.68 }], notes: s.notes.join("\n") };
  });
}

/** The plain-text outline: what the .txt export and the Deck step's copy carry. Never the notes' art direction on a face. */
export function outlineText(title: string, d: DeckResult): string {
  return [title, `Deck outline · ${d.slides.length} slides${d.placeholderCount ? ` · ${d.placeholderCount} unfilled on slides` : ""}`, "", ...d.slides.flatMap((s) => [`${s.n}. ${s.headline}`, s.eyebrow ? `   ${s.eyebrow}` : "", ...s.body.map((b) => `   - ${b}`), ""])].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
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
