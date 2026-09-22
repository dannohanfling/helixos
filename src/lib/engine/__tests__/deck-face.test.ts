import { describe, expect, it } from "vitest";
import { SECTION_TEMPLATES } from "../webinar";
import { resolveSections, type SectionRow } from "../webinar-context";
import { NEUTRAL_KIT, deckSlides } from "../deck";
import { FACE_LABELS, FACE_WORDS, cleanFace, currenciesIn, currencyConflicts, faceHits } from "../deck-face";

const base = (over: Partial<Record<string, Partial<SectionRow>>> = {}): SectionRow[] =>
  SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, order: t.order, name: t.name, status: "drafted", keyPoints: null, script: null, transitionIn: null, transitionOut: null, deliveryNote: null, assetId: null, durationMin: t.durationMin, ...(over[t.key] ?? {}) }));
const proofs = [{ id: "p1", who: "Kate A.", name: "Kate A.: identity", longVersion: "I now see identity as the foundation.", status: "approved" }];
const offerIn = (currency: string) => ({ offer: { name: "The 90-Minute Diagnostic", price: 1997, currency, container: "1:1 coaching", guarantee: null, objectionAssetIds: [] }, components: [{ name: "Diagnostic", type: "core", oneLiner: "90 minutes, 1:1", perceivedValue: 0, beliefBreak: "vehicle" }] });
const ctx = (sections: SectionRow[], currency: string | null = "NZD") =>
  resolveSections({ webinar: { title: "Your Edge, Uncovered" }, presenter: "Lindsey Brittain", sections, beliefs: [{ type: "vehicle", fromBelief: "a", toBelief: "b", proofId: "p1" }], proofs, assets: [], essenceStories: [], citable: [], offer: currency ? offerIn(currency) : null });
type Deck = ReturnType<typeof deckSlides>;
const faces = (d: Deck) => d.slides.flatMap((s) => [s.eyebrow, s.headline, ...s.body, s.footer ?? ""]).filter(Boolean);

// The five lines read off the live deck on 22 Sep ("Your Edge, Uncovered", slides 23, 25 and 57, 38, 65 and 68), verbatim.
const LIVE = {
  consent: "Consent recorded 12 September 2026",
  missing: "NO CONSENTED CASE STUDY EXISTS FOR THIS ACT",
  verification: "Gallup, State of the Global Workplace 2026 — verified verbatim",
  label: "Real: most leaders never name the drift.",
  rule: "no countdown, no strikethrough, no stack theatre",
};

describe("the list of words no face carries is one module, and it proves itself", () => {
  it("every example in the list trips its own class", () => {
    for (const w of FACE_WORDS) for (const ex of w.examples) expect(faceHits(ex), ex).toContain(w.cls);
  });
  it("every field label trips as a label only at the start of a line, before a colon", () => {
    for (const l of FACE_LABELS) expect(faceHits(`${l}: something`), l).toContain("label");
    expect(faceHits("The real work starts here.")).toEqual([]);
  });
  it("the deck's own audience lines and ordinary copy trip nothing, and stand exactly as written", () => {
    const ordinary = ["The missing piece is identity.", "From: I need more tactics", "To: I need a clearer identity", "Payment plan: 3 x NZD $700", "— Kate A.", "Total value so far: NZD $2,500", "Your price: NZD $1,997", "Permission to be direct", "Real results take twelve weeks."];
    for (const o of ordinary) {
      expect(faceHits(o), o).toEqual([]);
      expect(cleanFace(o), o).toEqual({ face: o, kept: [] });
    }
  });
  it("only the clause that trips comes off; the rest of the line stands", () => {
    expect(cleanFace(LIVE.verification)).toEqual({ face: "Gallup, State of the Global Workplace 2026", kept: [{ cls: "verification", text: "verified verbatim" }] });
    expect(cleanFace(LIVE.label)).toEqual({ face: "most leaders never name the drift.", kept: [{ cls: "label", text: "Real:" }] });
    expect(cleanFace("Kate A., consent recorded 12 Sep")).toEqual({ face: "Kate A.", kept: [{ cls: "consent", text: "consent recorded 12 Sep" }] });
    expect(cleanFace("Kate A. (permission on file)")).toEqual({ face: "Kate A.", kept: [{ cls: "consent", text: "permission on file" }] });
    expect(cleanFace(LIVE.rule)).toEqual({ face: "", kept: [{ cls: "rule", text: LIVE.rule }] });
    expect(cleanFace(LIVE.missing)).toEqual({ face: "", kept: [{ cls: "missing", text: LIVE.missing }] });
  });
});

describe("a slide face says what the presenter says, never how the deck was built", () => {
  // Each live line put where the record could put it: a key point, a section's only point, a recap's first line, the offer segment.
  const sections = base({
    proof_block: { keyPoints: `Results across clients\n${LIVE.consent}` },
    problem_frame: { keyPoints: LIVE.missing },
    case_study: { keyPoints: `${LIVE.missing}\nShe named the drift, and it held.` },
    mechanism_reveal: { keyPoints: LIVE.verification },
    opportunity_frame: { keyPoints: LIVE.label },
    offer_stack_cta: { keyPoints: `NZD $1,997. ${LIVE.rule[0].toUpperCase()}${LIVE.rule.slice(1)}.` },
  });
  const d = deckSlides(ctx(sections), NEUTRAL_KIT);

  it("no face anywhere in the deck carries a word from any class", () => {
    expect(faces(d).length).toBeGreaterThan(20);
    for (const f of faces(d)) expect(faceHits(f), f).toEqual([]);
  });
  it("each live line is kept off, listed with its class, and in the notes of the slide it came from or the one before", () => {
    const listed = d.keptOff.map((k) => `${k.cls}: ${k.text}`);
    expect(listed).toEqual(expect.arrayContaining([`consent: ${LIVE.consent}`, `missing: ${LIVE.missing}`, "verification: verified verbatim", "label: Real:", `rule: ${LIVE.rule[0].toUpperCase()}${LIVE.rule.slice(1)}.`]));
    const notes = d.slides.flatMap((s) => s.notes).join("\n");
    for (const t of [LIVE.consent, LIVE.missing, "verified verbatim"]) expect(notes).toContain(t);
  });
  it("what may stand, stands: the citation without its note, the line without its label, the price without the rule", () => {
    const heads = d.slides.map((s) => s.headline);
    expect(heads).toContain("Gallup, State of the Global Workplace 2026");
    expect(heads).toContain("most leaders never name the drift.");
    expect(heads).toContain("NZD $1,997.");
  });
  it("a slide that was nothing but such text is not a slide; its words go to the slide before, and the deck is numbered again", () => {
    expect(d.slides.filter((s) => s.sectionKey === "problem_frame")).toEqual([]);
    const proof = d.slides.filter((s) => s.sectionKey === "proof_block");
    expect(proof.map((s) => s.headline)).toEqual(["“I now see identity as the foundation.”", "Results across clients"]);
    expect(proof[1].notes).toContain(`Not on the slide (consent): ${LIVE.consent}`);
    expect(d.keptOff.find((k) => k.text === LIVE.consent)?.slide).toBeNull();
    expect(d.slides.map((s) => s.n)).toEqual(d.slides.map((_, i) => i + 1));
  });
  it("a recap quotes each section's first line that can stand on a face, never the kept-off one", () => {
    const recap = d.slides.find((s) => s.kind === "recap" && s.act === "vehicle")!;
    expect(recap.body).toContain("She named the drift, and it held.");
    expect(recap.body.join("\n")).not.toMatch(/CASE STUDY EXISTS/);
  });
});

describe("one currency per deck: the offer's own field, formatted in one place", () => {
  const typed = base({ offer_stack_cta: { keyPoints: "NZD $1,997, paid once." } });
  it("with the offer in NZD, every currency any face names is NZD", () => {
    const d = deckSlides(ctx(typed, "NZD"), NEUTRAL_KIT);
    const named = new Set(faces(d).flatMap(currenciesIn));
    expect(named.has("NZD")).toBe(true);
    expect([...named].filter((c) => c !== "NZD" && c !== "$")).toEqual([]);
    expect(d.refused.filter((r) => /currency/.test(r))).toEqual([]);
  });
  it("with the offer in USD, the same typed NZD line refuses the export, naming its slide; nothing is rewritten", () => {
    const d = deckSlides(ctx(typed, "USD"), NEUTRAL_KIT);
    const slide = d.slides.find((s) => s.headline === "NZD $1,997, paid once.")!;
    expect(d.refused).toContain(`Slide ${slide.n} (Offer Stack + CTA): it names NZD, but the offer is priced in USD. One currency per deck: set the currency on the Offer, or change the line.`);
    expect(d.slides.filter((s) => s.kind === "offer" && s.body.some((b) => /USD \$1,997/.test(b))).length).toBeGreaterThan(0);
  });
  it("a dollar sign on a deck priced in pounds refuses; a pound sign on a dollar deck refuses", () => {
    expect(currencyConflicts("Save $500 today", "GBP")).toEqual(["$"]);
    expect(currencyConflicts("Save £500 today", "NZD")).toEqual(["GBP"]);
    expect(currencyConflicts("NZD $1,997", "NZD")).toEqual([]);
    const d = deckSlides(ctx(base({ offer_stack_cta: { keyPoints: "Save $500 today" } }), "GBP"), NEUTRAL_KIT);
    expect(d.refused.some((r) => /it names dollars, but the offer is priced in GBP/.test(r))).toBe(true);
  });
  it("with no offer, the first currency a face names is the deck's, and another one refuses", () => {
    const d = deckSlides(ctx(base({ hook: { keyPoints: "Most spend NZD $4,000 a year on this" }, problem_frame: { keyPoints: "That is USD $2,400 gone" } }), null), NEUTRAL_KIT);
    expect(d.refused.some((r) => /it names USD, but the deck is in NZD\. One currency per deck: change the line\./.test(r))).toBe(true);
  });
});
