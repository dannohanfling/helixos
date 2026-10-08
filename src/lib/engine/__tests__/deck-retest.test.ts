import { describe, expect, it } from "vitest";
import { SECTION_TEMPLATES } from "../webinar";
import { resolveSections, type SectionRow } from "../webinar-context";
import { PROOF_GAP_WHAT, SLIDE_MASTERS, STACK_ONE_ROW_H, STARTER_KIT, deckSlides, framesOverlap, masterFor, masterGeometry, overlaps, placeholderOnly, renderPlan, slideGeometry, stackBuildRows, type DeckKit } from "../deck";
import { faceWidth, fitSize, linesFor } from "../deck-fit-text";
import { deckSafe } from "../section-draft";

/**
 * Claude's client deck re-test of 7 Oct (rev 581), fixed at the source: no two boxes on a slide print over each other, no
 * placeholder is inherited from a layout, a Proof Block with no proof is one red slot, a one-row stack sits in the body band,
 * the offer's points come before the stack, the close is centred, and the fit knows a wide face.
 */
const kit: DeckKit = { ...STARTER_KIT, name: "Rooted Rest", ground: "FAF8F5", ink: "6E6256", accent: "DD2727", muted: "4B5563", surface: "ECE9E5", inverseGround: "6E6256", inverseInk: "FAF8F5", displayFont: "Montserrat", bodyFont: "Arial" };
const base = (over: Partial<Record<string, Partial<SectionRow>>> = {}): SectionRow[] =>
  SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, order: t.order, name: t.name, status: "drafted", keyPoints: null, script: null, transitionIn: null, transitionOut: null, deliveryNote: null, assetId: null, durationMin: t.durationMin, ...(over[t.key] ?? {}) }));
const keyOf = (re: RegExp) => SECTION_TEMPLATES.find((t) => re.test(t.name))!.key;
const proofs = [{ id: "p1", who: "Kate A.", name: "Kate A.: identity", longVersion: "I now see identity as the foundation of everything I build.", status: "approved" }];
const offer = {
  offer: { name: "TEST CLIENT – 30-Day Sleep Reset", price: 497, currency: "USD", container: "A 30-day program", guarantee: "Sleep through the night in 30 days or your money back", objectionAssetIds: [] },
  components: [
    { name: "The Sleep Reset Plan", type: "core", oneLiner: "The night-by-night plan for 30 days", perceivedValue: 497, beliefBreak: "vehicle" },
    { name: "Weekly Check-ins", type: "core", oneLiner: "Four calls, one a week", perceivedValue: 400, beliefBreak: "internal" },
    { name: "The 2 a.m. Toolkit", type: "bonus", oneLiner: "What to do when you wake", perceivedValue: 347, beliefBreak: "external", problemItSolves: "The 2 a.m. wake-up" },
  ],
};
type Beliefs = Parameters<typeof resolveSections>[0]["beliefs"];
const beliefs: Beliefs = [
  { type: "vehicle", fromBelief: "I need to train my baby harder", toBelief: "Sleep follows rhythm, not force" },
  { type: "internal", fromBelief: "I'm the problem", toBelief: "You were never the problem; the plan was" },
  { type: "external", fromBelief: "Nobody in my house will stick to it", toBelief: "One parent, one week, one change" },
] as unknown as Beliefs;
const ctx = (sections: SectionRow[], withOffer = true, withProofs = true) =>
  resolveSections({ webinar: { title: "Sleep Through the Night", promiseLine: "Tonight you'll leave with a plan.", reflectionPrompt: "What would one full night's sleep change?", ctaType: "Book your free sleep call" }, presenter: "Maya Reyes", sections, beliefs, proofs: withProofs ? proofs : [], assets: [], essenceStories: [], citable: [], offer: withOffer ? (offer as unknown as Parameters<typeof resolveSections>[0]["offer"]) : null });

const fullDeck = () => {
  const d = deckSlides(ctx(base({ [keyOf(/hook/i)]: { keyPoints: "Most parents try harder, not smarter\nTonight is about rhythm" }, [keyOf(/offer stack/i)]: { keyPoints: "No new ideas from here\nFrom here, I show you what I've built" }, [keyOf(/offer transition/i)]: { keyPoints: "No new ideas from here\nI've taught you everything I'm going to teach you today" } })), kit);
  return { d, plans: renderPlan(d) };
};

describe("§1: no two boxes on a slide print over each other, and no placeholder is inherited", () => {
  it("the whole deck has no overlapping boxes: the From → To dividers, the stack, the guarantee, the cards and the figures included", () => {
    const { d, plans } = fullDeck();
    const layouts = new Set(plans.map((p) => p.layout));
    for (const l of ["shift", "stack", "guarantee", "figure", "statement", "content"]) expect([...layouts], `the deck has a ${l} slide`).toContain(l);
    expect(d.slides.some((s) => s.kind === "divider")).toBe(true);
    expect(overlaps(plans)).toEqual([]);
  });
  it("names an overlap when there is one", () => {
    const [plan] = renderPlan(fullDeck().d).filter((p) => p.layout === "shift");
    const broken = { ...plan, boxes: plan.boxes.map((b) => (b.role === "small" ? { ...b } : b)) };
    // Put the From line where the headline sits: the check names the pair.
    const g = slideGeometry(broken);
    expect(framesOverlap(g.boxes.small!, g.boxes.headline!)).toBe(false);
    expect(framesOverlap({ x: 0.5, y: 0.9, w: 9, h: 0.9 }, { x: 0.5, y: 0.8, w: 9, h: 1.5 })).toBe(true);
    // Touching edges are not an overlap: the stack's name and value columns meet at 7.3.
    expect(framesOverlap({ x: 1.0, y: 1, w: 6.3, h: 0.5 }, { x: 7.3, y: 1, w: 2.2, h: 0.5 })).toBe(false);
  });
  it("a laid-out slide sits on the bare layout, so pptxgenjs has no placeholder position to pull its boxes to", () => {
    const { plans } = fullDeck();
    for (const p of plans.filter((x) => ["shift", "stack", "guarantee", "figure", "cards", "bignum"].includes(x.layout))) expect(masterFor(p)).toBe("LAID_OUT");
    expect(SLIDE_MASTERS).toContain("LAID_OUT");
    expect(masterGeometry("LAID_OUT").boxes).toEqual({});
    // The layouts carry only the boxes every slide of the family fills: no eyebrow, no footer, no body on a statement.
    expect(Object.keys(masterGeometry("CONTENT").boxes)).toEqual(["headline"]);
    expect(Object.keys(masterGeometry("COVER").boxes).sort()).toEqual(["cover-presenter", "cover-title"]);
    expect(masterGeometry("CONTENT").body).not.toBeNull();
    expect(masterGeometry("STATEMENT").body).toBeNull();
    expect(masterGeometry("STATEMENT").boxes.eyebrow).toBeUndefined();
  });
});

describe("§2: a Proof Block with no proof is one red slot, never the words [PROOF PLACEHOLDER]", () => {
  it("drops a key point that is nothing but a placeholder, at Make slides and when the deck reads stored points", () => {
    expect(placeholderOnly("[PROOF PLACEHOLDER]")).toBe(true);
    expect(placeholderOnly("[PROOF PLACEHOLDER] [CASE STUDY PLACEHOLDER]")).toBe(true);
    expect(placeholderOnly("Kate saw it in week two")).toBe(false);
    expect(placeholderOnly("Kate saw it: [PROOF PLACEHOLDER]")).toBe(false);
    expect(deckSafe(["[PROOF PLACEHOLDER]", "Rhythm beats force"], "Proof Block 1")).toEqual(["Rhythm beats force"]);
  });
  it("gives each proof section one red slot slide, counted as its one unfilled placeholder and named on the Deck step, and never a recap bullet", () => {
    const proofKeys = SECTION_TEMPLATES.filter((t) => /proof block/i.test(t.name)).map((t) => t.key);
    expect(proofKeys.length).toBeGreaterThan(0);
    const d = deckSlides(ctx(base(Object.fromEntries(proofKeys.map((k) => [k, { keyPoints: "[PROOF PLACEHOLDER]\n[PROOF PLACEHOLDER]" }]))), true, false), kit);
    const gaps = d.slides.filter((s) => s.proofGap);
    expect(gaps).toHaveLength(proofKeys.length);
    expect(gaps[0].headline).toBe(PROOF_GAP_WHAT);
    expect(gaps[0].placeholders).toHaveLength(1);
    expect(d.warnings.some((w) => w.includes("red slot"))).toBe(true);
    expect(d.refused).toEqual([]);
    for (const s of d.slides) for (const line of [s.headline, ...s.body]) expect(line).not.toContain("[PROOF PLACEHOLDER]");
    const plan = renderPlan(d).find((p) => p.n === gaps[0].n)!;
    expect(plan.pictureOnly).toBe(true);
    expect(plan.boxes).toEqual([]);
    expect(plan.placeholderSlot?.text).toBe(PROOF_GAP_WHAT);
  });
});

describe("§3: the offer and the close", () => {
  it("a one-row stack sits in the body band, tall and large, with the item's line under the table", () => {
    const one = stackBuildRows(1);
    expect(one.top).toBe(1.25);
    expect(one.h).toBe(STACK_ONE_ROW_H);
    const g = slideGeometry({ boxes: [{ slide: 1, role: "row-name", col: 0, text: "x", size: 1, color: "", fill: null, face: "", bold: false, italic: false, bullet: false, placeholder: false }, { slide: 1, role: "body", text: "y", size: 1, color: "", fill: null, face: "", bold: false, italic: false, bullet: false, placeholder: false }], layout: "stack", imageFrame: null, placeholderSlot: null, pictureOnly: false });
    expect(g.cols![0].name!.y).toBe(1.25);
    expect(g.body!.y).toBeGreaterThan(one.bottom);
    const { d, plans } = fullDeck();
    const first = d.slides.find((s) => s.stack && s.stack.newest === 0)!;
    const plan = plans.find((p) => p.n === first.n)!;
    expect(plan.boxes.find((b) => b.role === "row-name")!.size).toBeGreaterThanOrEqual(28);
    expect(plan.boxes.some((b) => b.role === "body")).toBe(true);
    // Six rows still fit above the item's line.
    expect(stackBuildRows(6).bottom).toBeLessThanOrEqual(4.6);
  });
  it("the offer section's own points come before the stack, and one that repeats the Offer Transition comes off", () => {
    const { d } = fullDeck();
    const offerKey = keyOf(/offer stack/i);
    const points = d.slides.filter((s) => s.sectionKey === offerKey && !s.stack && !s.figure && !s.seal);
    const stack = d.slides.filter((s) => s.stack || s.figure);
    expect(points.map((s) => s.headline)).toEqual(["From here, I show you what I've built"]);
    expect(Math.max(...points.map((s) => s.n))).toBeLessThan(Math.min(...stack.map((s) => s.n)));
    expect(d.echoes.some((e) => e.text === "No new ideas from here")).toBe(true);
  });
  it("the close is a centred statement with no bullet", () => {
    const { d, plans } = fullDeck();
    const close = d.slides.find((s) => s.kind === "close" && s.headline === "Book your free sleep call")!;
    expect(close.body).toEqual([]);
    const plan = plans.find((p) => p.n === close.n)!;
    expect(plan.layout).toBe("statement");
    expect(plan.centred).toBe(true);
    expect(slideGeometry(plan).boxes.headline!.align).toBe("center");
    // Drawn as a plain box (§1: a placeholder would set it left), so it sits on the bare layout and leaves no empty title (§5).
    expect(masterFor(plan)).toBe("LAID_OUT");
    expect(masterFor({ ...plan, centred: false })).toBe("STATEMENT");
  });
});

describe("§5: the fit knows a wide face", () => {
  it("Montserrat sets wider than Arial, so the same line steps down sooner", () => {
    expect(faceWidth("Montserrat")).toBeGreaterThan(faceWidth("Arial"));
    expect(faceWidth(null)).toBe(1);
    // 9 in at 40pt: Arial fits 32 characters a line, Montserrat 28; one 60-character word is 2 lines in Arial, 3 in Montserrat.
    expect(linesFor("x".repeat(60), 9, 40, "Arial")).toBe(2);
    expect(linesFor("x".repeat(60), 9, 40, "Montserrat")).toBe(3);
    const line = "Sleep follows rhythm, not force, and the plan does the work for you every single night of the thirty days ahead";
    expect(fitSize(line, { w: 9, h: 1.6 }, [40, 36, 32, 28, 24], "Montserrat")!).toBeLessThanOrEqual(fitSize(line, { w: 9, h: 1.6 }, [40, 36, 32, 28, 24], "Arial")!);
  });
});
