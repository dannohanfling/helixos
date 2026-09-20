import { describe, expect, it } from "vitest";
import { SECTION_TEMPLATES } from "../webinar";
import { resolveSections, type SectionRow } from "../webinar-context";
import { BODY_SIZE, EYEBROW_SIZE, HEADLINE_FLOOR, HEADLINE_MAX_CHARS, HEADLINE_TIERS, NEUTRAL_KIT, PLACEHOLDER_FALLBACK, deckSlides, headlineTier, offSlidePlaceholders, outlineText, placeholderHits, renderPlan, type DeckKit } from "../deck";

const kit: DeckKit = { name: "Turas — True North", ground: "FAF8F5", ink: "6E6256", accent: "DD2727", muted: "4B5563", surface: "ECE9E5", inverseGround: "6E6256", inverseInk: "FAF8F5", displayFont: "Red Hat Display", bodyFont: "Helvetica Now Display", quoteFont: "Libre Baskerville", fontFallback: "Arial", bannedColors: ["000000"], placeholder: "FFF3A3" };
const base = (over: Partial<Record<string, Partial<SectionRow>>> = {}): SectionRow[] =>
  SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, order: t.order, name: t.name, status: "drafted", keyPoints: null, script: null, transitionIn: null, transitionOut: null, deliveryNote: null, assetId: null, durationMin: t.durationMin, ...(over[t.key] ?? {}) }));
const proofs = [{ id: "p1", who: "Kate A.", name: "Kate A.: identity", longVersion: "I now see identity as the foundation.", status: "approved" }];
const citable = [{ id: "e1", source: "own" as const, claim: "Impostor phenomenon is common among high achievers.", authors: "Bravata et al.", year: 2019, title: "Prevalence of Impostor Syndrome", doi: "10.1/x" }];
const assets = [{ id: "s1", type: "story", name: "Chasing the symptom", body: "She fixed the wrong thing. Then she named the drift. It held.", extra: { moral: "Name the drift." } }];
const offer = { offer: { name: "The 90-Minute Diagnostic", price: 1997, currency: "NZD", container: "1:1 coaching", guarantee: null, objectionAssetIds: [] }, components: [{ name: "Diagnostic", type: "core", oneLiner: "90 minutes, 1:1", perceivedValue: 0, beliefBreak: "vehicle" }] };
type Beliefs = Parameters<typeof resolveSections>[0]["beliefs"];
const ctx = (sections: SectionRow[], beliefs: Beliefs = [], withOffer = true) => resolveSections({ webinar: { title: "Your Edge, Uncovered" }, presenter: "Lindsey Brittain", sections, beliefs, proofs, assets, essenceStories: [], citable, offer: withOffer ? offer : null });
const bySection = (d: ReturnType<typeof deckSlides>, key: string) => d.slides.filter((s) => s.sectionKey === key);

describe("the headline steps down a tier as it lengthens and is never cut", () => {
  it("names the tiers and the floor as point sizes", () => {
    expect(HEADLINE_TIERS).toEqual([
      { maxChars: 48, size: 40 },
      { maxChars: 80, size: 32 },
      { maxChars: 120, size: 26 },
      { maxChars: 160, size: 22 },
    ]);
    expect(HEADLINE_FLOOR).toBe(22);
    expect(HEADLINE_MAX_CHARS).toBe(160);
    expect(headlineTier("x".repeat(48))).toEqual({ size: 40, overflow: false });
    expect(headlineTier("x".repeat(49))).toEqual({ size: 32, overflow: false });
    expect(headlineTier("x".repeat(120))).toEqual({ size: 26, overflow: false });
    expect(headlineTier("x".repeat(160))).toEqual({ size: 22, overflow: false });
    expect(headlineTier("x".repeat(161))).toEqual({ size: 22, overflow: true });
  });
  it("past the floor the sentence moves to the body whole, the section name stands in, and the outline says so at the section", () => {
    const long = "This is the sentence that runs on and on, well past the last tier a headline can step down to, so it is moved whole to the body of the slide rather than shrunk any further.";
    expect(long.length).toBeGreaterThan(HEADLINE_MAX_CHARS);
    const d = deckSlides(ctx(base({ hook: { keyPoints: `${long}\nSecond point` } })), kit);
    const hook = bySection(d, "hook")[0];
    expect(hook.overflow).toBe(true);
    expect(hook.headline).toBe("Hook");
    expect(hook.headlineSize).toBe(HEADLINE_FLOOR);
    expect(hook.body).toEqual([long, "Second point"]);
    expect(d.warnings.some((w) => w.startsWith("Slide 2 (Hook): the first key point is over 160 characters"))).toBe(true);
    expect(d.refused).toEqual([]);
  });
});

describe("what a slide holds is what the record holds, or there is no slide", () => {
  it("the Proof Block is the bank's proof as the bank stores it: first name and initial, no consent date; the key points follow", () => {
    const d = deckSlides(ctx(base({ proof_block: { keyPoints: "Results across clients\nSecond" } }), [{ type: "vehicle", fromBelief: "a", toBelief: "b", proofId: "p1" }]), kit);
    const [quote, points] = bySection(d, "proof_block");
    expect(quote.kind).toBe("proof");
    expect(quote.headline).toBe("“I now see identity as the foundation.”");
    expect(quote.body).toEqual(["— Kate A."]);
    expect(quote.notes.join("\n")).not.toMatch(/2026|consent|permission/);
    expect(points).toMatchObject({ kind: "proof", headline: "Results across clients", body: ["Second"] });
  });
  it("with no proof the citation stands; with neither, no slide and no sentence about the absence", () => {
    const withStudy = deckSlides(ctx(base(), [{ type: "vehicle", fromBelief: "a", toBelief: "b", evidenceId: "e1" }]), kit);
    expect(bySection(withStudy, "proof_block")).toHaveLength(1);
    expect(bySection(withStudy, "proof_block")[0]).toMatchObject({ kind: "evidence", headline: "Impostor phenomenon is common among high achievers.", body: ["Bravata et al. (2019). Prevalence of Impostor Syndrome. https://doi.org/10.1/x"] });
    const nothing = deckSlides(ctx(base()), kit);
    expect(bySection(nothing, "proof_block")).toEqual([]);
    expect(nothing.slides.map((s) => s.headline).join(" ")).not.toMatch(/no proof|missing|not yet/i);
  });
  it("the Case Study renders the story wired to its act, or its key points, or nothing", () => {
    const story = deckSlides(ctx(base(), [{ type: "vehicle", fromBelief: "a", toBelief: "b", storyAssetId: "s1" }]), kit);
    expect(bySection(story, "case_study")[0]).toMatchObject({ kind: "story", headline: "Chasing the symptom", body: ["She fixed the wrong thing.", "Then she named the drift.", "It held."] });
    expect(bySection(deckSlides(ctx(base()), kit), "case_study")).toEqual([]);
  });
  it("the Offer Stack is the linked stack with its currency; unlinked, nothing", () => {
    const d = deckSlides(ctx(base()), kit);
    const stack = bySection(d, "offer_stack_cta")[0];
    expect(stack).toMatchObject({ kind: "offer", headline: "The 90-Minute Diagnostic", body: ["Diagnostic — 90 minutes, 1:1", "NZD $1,997"] });
    expect(bySection(deckSlides(ctx(base(), [], false), kit), "offer_stack_cta")).toEqual([]);
  });
  it("an omitted section is absent from the deck and the outline", () => {
    const d = deckSlides(ctx(base({ credibility_origin: { status: "omitted", keyPoints: "My origin\nThe week it changed" } })), kit);
    expect(bySection(d, "credibility_origin")).toEqual([]);
    expect(outlineText("t", d)).not.toContain("origin");
    expect(outlineText("t", d)).toContain("Deck outline · ");
  });
  it("the cover carries the title and the presenter, and the art direction is in the notes and never on a face", () => {
    const d = deckSlides(ctx(base({ hook: { keyPoints: "Open the loop", deliveryNote: "Wait for the chat." } })), kit);
    expect(d.slides[0]).toMatchObject({ kind: "cover", headline: "Your Edge, Uncovered", body: ["Lindsey Brittain"] });
    const hook = bySection(d, "hook")[0];
    expect(hook.notes).toEqual(["Section: Hook", "Visual direction: One line, lots of air.", "Delivery: Wait for the chat."]);
    const faces = renderPlan(d).flatMap((p) => p.boxes.map((b) => b.text)).join("\n");
    expect(faces).not.toMatch(/Visual|Delivery:/);
    expect(outlineText("Your Edge, Uncovered", d)).not.toMatch(/Visual/);
  });
});

describe("placeholders: refused in a claim or on a proof or price slide, warned anywhere else", () => {
  it("(a) a placeholder in a sentence carrying a number, a percentage or a currency refuses; (b) any placeholder on a Proof Block or Offer Stack slide refuses; the rest warn", () => {
    expect(placeholderHits("section", ["Promise [X]% fewer no-shows"])[0]).toMatchObject({ text: "[X]%", refuse: true });
    expect(placeholderHits("section", ["Send them to [SALES PAGE URL]"])[0]).toMatchObject({ text: "[SALES PAGE URL]", refuse: false });
    expect(placeholderHits("section", ["[N] clients ran it"])[0].refuse).toBe(true);
    expect(placeholderHits("section", ["It costs [PRICE] in USD"])[0].refuse).toBe(true);
    expect(placeholderHits("section", ["Save $[N] a month"])[0].refuse).toBe(true);
    expect(placeholderHits("section", ["Since [year] the channel has decayed"])[0].refuse).toBe(false);
    expect(placeholderHits("section", ["Terri the bookkeeper, [$N] competitor on the same keywords"])[0].refuse).toBe(true);
    expect(placeholderHits("proof", ["[CLIENT NAME] doubled her list"])[0]).toMatchObject({ refuse: true, why: "[CLIENT NAME] sits on a proof slide, which is a claim by its nature." });
    expect(placeholderHits("offer", ["Bonus: [NAME OF BONUS]"])[0]).toMatchObject({ refuse: true, why: "[NAME OF BONUS] sits on a price slide, which is a claim by its nature." });
  });
  it("the deck refuses with the slide named, from the same function the route runs, and a warning carries the count", () => {
    const d = deckSlides(ctx(base({ hook: { keyPoints: "Promise [X]% fewer no-shows" }, problem_frame: { keyPoints: "Send them to [SALES PAGE URL]" }, proof_block: { keyPoints: "[CLIENT NAME] doubled her list" } })), kit);
    expect(d.refused).toEqual(["Slide 2 (Hook): [X]% sits in a sentence that carries a number: a claim with a hole in it.", "Slide 4 (Proof Block): [CLIENT NAME] sits on a proof slide, which is a claim by its nature."]);
    expect(d.warnings).toEqual(["Slide 3 (Problem Frame): [SALES PAGE URL] is a gap to fill."]);
    expect(d.placeholderCount).toBe(3);
    expect(outlineText("t", d)).toContain("Deck outline · 5 slides · 3 unfilled on slides");
  });
  it("the deck refuses only on what it renders; the run sheet names the rest as off-slide", () => {
    // A fifth key point past the four a slide carries, and a placeholder in the script: neither is on a slide
    const c = ctx(base({ hook: { keyPoints: "Open the loop\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight\nPromise [X]% fewer no-shows", script: "Send them to [SALES PAGE URL]." }, problem_frame: { keyPoints: "Costs [$N] a month" } }));
    const d = deckSlides(c, kit);
    expect(d.refused).toEqual(["Slide 4 (Problem Frame): [$N] sits in a sentence that carries a number: a claim with a hole in it."]);
    expect(offSlidePlaceholders(c, d)).toEqual({ total: 3, offSlide: 2, sections: [{ section: "Hook", onSlide: [], offSlide: ["[X]%", "[SALES PAGE URL]"] }, { section: "Problem Frame", onSlide: ["[$N]"], offSlide: [] }] });
  });
});

describe("the brand kit on the file", () => {
  it("every colour is the kit's hex verbatim, accent draws rules and fills and never letters, the proof headline takes the quote face, and a placeholder is drawn in the kit's colour", () => {
    const d = deckSlides(ctx(base({ hook: { keyPoints: "Open the loop\nSend them to [SALES PAGE URL]" }, proof_block: {} }), [{ type: "vehicle", fromBelief: "a", toBelief: "b", proofId: "p1" }]), kit);
    const plan = renderPlan(d);
    for (const p of plan) {
      expect(p.background).toBe("FAF8F5");
      for (const b of p.boxes) {
        // Letters are ink or muted, both refused under 4.5:1 by the kit rules; the accent never colours a text box or sits under one
        expect(["6E6256", "4B5563"]).toContain(b.color);
        expect(b.fill).not.toBe("DD2727");
        if (b.role === "eyebrow") expect(b).toMatchObject({ size: EYEBROW_SIZE, color: "4B5563" });
      }
      for (const r of p.rules) expect(r.color).toBe("DD2727");
    }
    expect(plan[0].rules).toEqual([]);
    expect(plan[1].rules).toHaveLength(1);
    const hook = plan[1];
    expect(hook.boxes.find((b) => b.role === "headline")).toMatchObject({ text: "Open the loop", size: 40, color: "6E6256", fill: null, face: "Red Hat Display", bold: true });
    expect(hook.boxes.find((b) => b.role === "body")).toMatchObject({ text: "Send them to [SALES PAGE URL]", size: BODY_SIZE, fill: "FFF3A3", face: "Helvetica Now Display", placeholder: true });
    const proof = plan.find((p) => d.slides[p.n - 1].kind === "proof")!;
    expect(proof.boxes.find((b) => b.role === "headline")).toMatchObject({ face: "Libre Baskerville", italic: true, bold: false });
    expect(proof.boxes.find((b) => b.role === "attribution")).toMatchObject({ text: "— Kate A.", color: "4B5563" });
  });
  it("a kit whose pair cannot read refuses the render with the pair named; no kit renders neutral and says so; no placeholder colour falls back to one colour, named", () => {
    const bad = deckSlides(ctx(base()), { ...kit, ink: "9CA3AF" });
    expect(bad.refused).toEqual(["Brand kit: ink on ground is 2.4:1; it needs 4.5:1 to read on a slide.", "Brand kit: ink on placeholder is 2.25:1; it needs 4.5:1, or the unfilled slot cannot be read."]);
    const none = deckSlides(ctx(base()), null);
    expect(none.kit).toBe(NEUTRAL_KIT);
    expect(none.kitApplied).toBe(false);
    expect(none.warnings).toContain("No brand kit on this workspace: rendered black on white with no brand applied. Add the kit on Settings.");
    const noSlot = deckSlides(ctx(base({ hook: { keyPoints: "Send them to [SALES PAGE URL]" } })), { ...kit, placeholder: null });
    expect(noSlot.warnings).toContain(`The brand kit reserves no placeholder colour, so unfilled slots are drawn in ${PLACEHOLDER_FALLBACK}.`);
    expect(renderPlan(noSlot)[1].boxes.find((b) => b.role === "headline")?.fill).toBe(PLACEHOLDER_FALLBACK);
  });
});
