import { describe, expect, it } from "vitest";
import { SECTION_TEMPLATES } from "../webinar";
import { resolveSections, type SectionRow } from "../webinar-context";
import { COVER_LOGO_BOX, FOOTER_BAND, LOGO_BOX, PHRASE_MIN_CONTRAST, STARTER_KIT, coverLogoFrame, deckSlides, layoutsFor, phraseFor, renderPlan, suggestAccentPhrase, type DeckKit } from "../deck";
import { contrastRatio } from "../subject";

/**
 * Deck layouts 10 (rev 533): one phrase in the accent, the coach's layout over the engine's, both keyed by a slide key that
 * survives edits elsewhere in the deck; and Claude's rev 592 polish on the logos.
 */
const kit = (accent: string): DeckKit => ({ ...STARTER_KIT, name: "Rooted Rest", ground: "FAF8F5", ink: "6E6256", accent, muted: "4B5563", surface: "ECE9E5", inverseGround: "6E6256", inverseInk: "FAF8F5" });
const base = (over: Partial<Record<string, Partial<SectionRow>>> = {}): SectionRow[] =>
  SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, order: t.order, name: t.name, status: "drafted", keyPoints: null, script: null, transitionIn: null, transitionOut: null, deliveryNote: null, minutes: 5, origin: "coach", ...(over[t.key] ?? {}) }) as SectionRow);
const keyOf = (re: RegExp) => SECTION_TEMPLATES.find((t) => re.test(t.name))!.key;
const ctx = (sections: SectionRow[]) =>
  resolveSections({ webinar: { title: "Sleep Through the Night", promiseLine: "Tonight you'll leave with a plan.", reflectionPrompt: "What would one full night's sleep change?", ctaType: "Book your free sleep call" } as Parameters<typeof resolveSections>[0]["webinar"], presenter: "Kate", sections, beliefs: [], proofs: [], assets: [], essenceStories: [], citable: [], offer: null, avatarFit: null });
const hook = keyOf(/hook/i);
const deck = (accent = "DD2727") => deckSlides(ctx(base({ [hook]: { keyPoints: "602 comments on my post in 48 hours\nThe rhythm beats the rules: sleep follows rhythm" } })), kit(accent));

describe("deck layouts 10: one phrase in the accent", () => {
  it("suggests the figure, else a short tail after a colon, never on a quote or a placeholder", () => {
    expect(suggestAccentPhrase("602 comments on my post in 48 hours")).toBe("602 comments");
    expect(suggestAccentPhrase("The rhythm beats the rules: sleep follows rhythm")).toBe("sleep follows rhythm");
    expect(suggestAccentPhrase("“I now see identity as the foundation.”")).toBeNull();
    expect(suggestAccentPhrase("Most parents try harder, not smarter")).toBeNull();
    expect(suggestAccentPhrase("[PROOF PLACEHOLDER]")).toBeNull();
  });
  it("the coach's phrase wins when it is in the line, a cleared phrase is none, and an empty one asks the draft again", () => {
    const line = "The rhythm beats the rules: sleep follows rhythm";
    expect(phraseFor(line, { accentPhrase: "beats the rules" })).toBe("beats the rules");
    expect(phraseFor(line, { accentPhrase: "not in the line" })).toBeNull();
    expect(phraseFor(line, { accentOff: true })).toBeNull();
    expect(phraseFor(line, { accentPhrase: "" })).toBe("sleep follows rhythm");
  });
  it("every slide off the cover carries a stable key: its section and its place in it", () => {
    const d = deck();
    const keys = d.slides.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const hookSlides = d.slides.filter((s) => s.sectionKey === hook);
    expect(hookSlides.map((s) => s.key)).toEqual([`${hook}:1`, `${hook}:2`]);
  });
  it("the phrase is in the accent where the accent reads on the ground, and bold ink where it does not; the cover carries none", () => {
    const strong = deck("8A1C1C");
    expect(contrastRatio("FAF8F5", "8A1C1C")).toBeGreaterThanOrEqual(PHRASE_MIN_CONTRAST);
    // The big number has no headline box (its figure is the face): the phrase rides on a headline, here the statement line.
    const line = "The rhythm beats the rules: sleep follows rhythm";
    const plan = renderPlan(strong).find((p) => p.boxes.some((b) => b.role === "headline" && b.text === line))!;
    expect(plan.layout).toBe("statement");
    expect(plan.boxes.find((b) => b.role === "headline")!.phrase).toEqual({ text: "sleep follows rhythm", color: "8A1C1C" });
    const pale = deck("F2A4A4");
    const pl = renderPlan(pale).find((p) => p.boxes.some((b) => b.role === "headline" && b.text === line))!;
    expect(pl.boxes.find((b) => b.role === "headline")!.phrase).toEqual({ text: "sleep follows rhythm", color: null });
    expect(renderPlan(strong)[0].boxes.every((b) => !b.phrase)).toBe(true);
  });
  it("the coach's layout wins among the layouts the slide may take, and 'content' turns a one-liner into a headline at the top", () => {
    const d = deck();
    const figure = d.slides.find((s) => s.headline.startsWith("602 comments"))!;
    expect(layoutsFor(figure)).toEqual(["content", "statement", "bignum"]);
    expect(layoutsFor(d.slides[0])).toEqual([]);
    const auto = renderPlan(d).find((p) => p.n === figure.n)!;
    expect(auto.layout).toBe("bignum");
    const asStatement = renderPlan(d, new Set(), new Set(), new Map([[figure.key!, { layout: "statement" }]])).find((p) => p.n === figure.n)!;
    expect(asStatement.layout).toBe("statement");
    const asContent = renderPlan(d, new Set(), new Set(), new Map([[figure.key!, { layout: "content" }]])).find((p) => p.n === figure.n)!;
    expect(asContent.layout).toBe("content");
    // A layout the slide may not take is ignored: the engine's own stands.
    const ignored = renderPlan(d, new Set(), new Set(), new Map([[figure.key!, { layout: "cards" }]])).find((p) => p.n === figure.n)!;
    expect(ignored.layout).toBe("bignum");
  });
});

describe("Claude's rev 592 polish: the logos", () => {
  it("the cover logo sits left-aligned with the title in a box up to an inch tall, clear of the title; the footer logo is 0.3 in inside its band", () => {
    expect(coverLogoFrame({ x: 1.35, y: 0.3, w: 0.9, h: 0.9 })).toEqual({ x: COVER_LOGO_BOX.x, y: 0.3, w: 0.9, h: 0.9 });
    expect(COVER_LOGO_BOX.h).toBe(1.0);
    expect(COVER_LOGO_BOX.y + COVER_LOGO_BOX.h).toBeLessThanOrEqual(1.35);
    expect(LOGO_BOX.h).toBe(0.3);
    expect(LOGO_BOX.y).toBeGreaterThanOrEqual(FOOTER_BAND.y);
    expect(LOGO_BOX.y + LOGO_BOX.h).toBeLessThanOrEqual(FOOTER_BAND.y + FOOTER_BAND.h);
    expect(FOOTER_BAND.y + FOOTER_BAND.h).toBeLessThanOrEqual(5.625);
  });
});
