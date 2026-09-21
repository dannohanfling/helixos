import { describe, expect, it } from "vitest";
import { SECTION_TEMPLATES } from "../webinar";
import { resolveSections, type SectionRow } from "../webinar-context";
import { BODY_SIZE, EYEBROW_SIZE, HEADLINE_FLOOR, HEADLINE_MAX_CHARS, HEADLINE_TIERS, NEUTRAL_KIT, PACE_BAND, PLACEHOLDER_FALLBACK, TEXT_LEFT_ZONE, deckPace, deckSlides, headlineTier, offSlidePlaceholders, offerBuild, outlineText, paceLine, placeholderHits, renderPlan, slotFrame, suggestedSlots, SLOT_WHAT, type DeckKit } from "../deck";

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
    const [hook, second] = bySection(d, "hook");
    expect(hook.overflow).toBe(true);
    expect(hook.headline).toBe("Hook");
    expect(hook.headlineSize).toBe(HEADLINE_FLOOR);
    expect(hook.body).toEqual([long]);
    expect(second).toMatchObject({ headline: "Second point", body: [], overflow: false, headlineSize: 40 });
    expect(d.warnings.some((w) => w.startsWith("Slide 2 (Hook): the key point is over 160 characters"))).toBe(true);
    expect(d.refused).toEqual([]);
  });
});

describe("what a slide holds is what the record holds, or there is no slide", () => {
  it("the Proof Block is the bank's proof as the bank stores it: first name and initial, no consent date; the key points follow", () => {
    const d = deckSlides(ctx(base({ proof_block: { keyPoints: "Results across clients\nSecond" } }), [{ type: "vehicle", fromBelief: "a", toBelief: "b", proofId: "p1" }]), kit);
    const [quote, first, second] = bySection(d, "proof_block");
    expect(quote.kind).toBe("proof");
    expect(quote.headline).toBe("“I now see identity as the foundation.”");
    expect(quote.body).toEqual(["— Kate A."]);
    expect(quote.notes.join("\n")).not.toMatch(/2026|consent|permission/);
    // One key point per slide, each under the section's eyebrow
    expect(first).toMatchObject({ kind: "proof", headline: "Results across clients", body: [], eyebrow: "Proof Block · Vehicle" });
    expect(second).toMatchObject({ kind: "proof", headline: "Second", body: [] });
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
  it("the Offer Stack is the linked stack as a build with its currency, then the price; unlinked, nothing", () => {
    const d = deckSlides(ctx(base()), kit);
    const [item, anchor] = bySection(d, "offer_stack_cta");
    expect(item).toMatchObject({ kind: "offer", headline: "Diagnostic", body: ["90 minutes, 1:1"] });
    // The one item carries no value, so no total renders anywhere and the price stands alone
    expect(anchor).toMatchObject({ kind: "offer", headline: "The 90-Minute Diagnostic", body: ["NZD $1,997"] });
    expect(bySection(deckSlides(ctx(base(), [], false), kit), "offer_stack_cta")).toEqual([]);
  });
  it("the build re-shows the running total after each item and the price against it; any item without a value and no total renders at all", () => {
    const o = { name: "The 90-Day Reset", price: 1997, currency: "NZD", container: "group", guarantee: "Free until you lose 10.", paymentPlan: "3 x $700", scarcity: null, urgency: "Doors close Friday.", ctaFooter: null, forYouIf: null, notForYouIf: null, objections: [], components: [
      { name: "The program", type: "core", oneLiner: "12 weeks", perceivedValue: 3000, beliefBreak: "vehicle" },
      { name: "Template library", type: "bonus", description: "You pick.", perceivedValue: 497, beliefBreak: "internal" },
      { name: "Free until you lose 10", type: "guarantee", perceivedValue: 0, beliefBreak: "none" },
    ] };
    expect(offerBuild(o)).toEqual([
      { headline: "The program", body: ["12 weeks", "Total value so far: NZD $3,000"] },
      { headline: "Template library", body: ["You pick.", "Total value so far: NZD $3,497"] },
      { headline: "The 90-Day Reset", body: ["Total value: NZD $3,497", "Your price: NZD $1,997", "You save NZD $1,500", "Payment plan: 3 x $700"] },
      { headline: "Free until you lose 10.", body: [] },
      { headline: "Doors close Friday.", body: [] },
    ]);
    // The anchor off: the running totals still build, the price stands on its own, and nothing else changes
    const noAnchor = offerBuild(o, false);
    expect(noAnchor.map((x) => x.body)).toEqual([["12 weeks", "Total value so far: NZD $3,000"], ["You pick.", "Total value so far: NZD $3,497"], ["NZD $1,997", "Payment plan: 3 x $700"], [], []]);
    expect(JSON.stringify(noAnchor)).not.toMatch(/Total value:|save/);
    const kitOff = deckSlides(ctx(base()), { ...kit, showPriceAnchor: false });
    expect(bySection(kitOff, "offer_stack_cta").map((s) => s.headline)).toEqual(["Diagnostic", "The 90-Minute Diagnostic"]);
    const zero = offerBuild({ ...o, components: [o.components[0], { ...o.components[1], perceivedValue: 0 }, o.components[2]] });
    expect(zero.map((x) => x.body)).toEqual([["12 weeks"], ["You pick."], ["NZD $1,997", "Payment plan: 3 x $700"], [], []]);
    expect(JSON.stringify(zero)).not.toMatch(/Total|save/);
  });
  it("a divider opens each belief act with the shift from the record, on the kit's inverse pair; a recap closes it with each section's first line", () => {
    const d = deckSlides(ctx(base({ problem_frame: { keyPoints: "Name the enemy\nSecond" }, mechanism_reveal: { keyPoints: "Draw the hub" } }), [{ type: "vehicle", fromBelief: "Diets are all the same.", toBelief: "It was the plan." }]), kit);
    const divider = d.slides.find((s) => s.kind === "divider")!;
    expect(divider).toMatchObject({ n: 2, act: "vehicle", headline: "Act 1 · Vehicle", body: ["From: Diets are all the same.", "To: It was the plan."], inverse: true, sectionKey: null });
    const recap = d.slides.find((s) => s.kind === "recap")!;
    expect(recap).toMatchObject({ act: "vehicle", headline: "Act 1 · Vehicle · recap", body: ["Name the enemy", "Draw the hub"], inverse: false });
    expect(d.slides.filter((s) => s.kind === "divider").map((s) => s.act)).toEqual(["vehicle", "internal", "external"]);
    expect(d.slides.filter((s) => s.kind === "recap")).toHaveLength(1);
    const plan = renderPlan(d);
    expect(plan[1].background).toBe("6E6256");
    for (const b of plan[1].boxes) expect(b.color).toBe("FAF8F5");
    expect(plan[0].background).toBe("6E6256");
    // No inverse pair on the kit: the dark surfaces sit on ground like everything else
    expect(renderPlan(deckSlides(d.slides.length ? ctx(base()) : ctx(base()), { ...kit, inverseGround: null, inverseInk: null }))[1].background).toBe("FAF8F5");
  });
  it("the footer is the offer's one line on every slide from the Offer Stack onward and on none before; a hole in it refuses", () => {
    const withFooter = { ...offer, offer: { ...offer.offer, ctaFooter: "DM me the word PLAN" } };
    const c = resolveSections({ webinar: { title: "t" }, presenter: "L", sections: base({ hook: { keyPoints: "Open" }, offer_transition: { keyPoints: "DIY or done with you" }, q_a_close: { keyPoints: "Ask anything" } }), beliefs: [], proofs, assets, essenceStories: [], citable, offer: withFooter });
    const d = deckSlides(c, kit);
    expect(bySection(d, "hook")[0].footer).toBeNull();
    expect(bySection(d, "offer_transition")[0].footer).toBeNull();
    expect(bySection(d, "offer_stack_cta").map((s) => s.footer)).toEqual(["DM me the word PLAN", "DM me the word PLAN"]);
    expect(bySection(d, "q_a_close")[0].footer).toBe("DM me the word PLAN");
    const plan = renderPlan(d);
    expect(plan[plan.length - 1].boxes.find((b) => b.role === "footer")).toMatchObject({ text: "DM me the word PLAN", size: EYEBROW_SIZE, color: "4B5563" });
    const holed = deckSlides(resolveSections({ webinar: { title: "t" }, presenter: "L", sections: base(), beliefs: [], proofs, assets, essenceStories: [], citable, offer: { ...offer, offer: { ...offer.offer, ctaFooter: "Go to [SALES PAGE URL]" } } }), kit);
    expect(holed.refused[0]).toMatch(/\[SALES PAGE URL\] sits on a price slide/);
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
    // 1 cover · 2 Hook · 3 Act 1 divider · 4 Problem Frame · 5 Proof Block · 6 Act 1 recap · 7, 8 dividers · 9 item · 10 price
    expect(d.refused).toEqual(["Slide 2 (Hook): [X]% sits in a sentence that carries a number: a claim with a hole in it.", "Slide 5 (Proof Block): [CLIENT NAME] sits on a proof slide, which is a claim by its nature."]);
    // The recap repeats the act's lines, so the slot is on two slides and counted twice, but named once, at its source
    expect(d.warnings).toEqual(["Slide 4 (Problem Frame): [SALES PAGE URL] is a gap to fill."]);
    expect(d.slides[5].kind).toBe("recap");
    expect(d.slides[5].placeholders.map((p) => p.text)).toEqual(["[SALES PAGE URL]", "[CLIENT NAME]"]);
    expect(d.placeholderCount).toBe(5);
    expect(outlineText("t", d)).toContain("Deck outline · 10 slides · 5 unfilled on slides");
  });
  it("the deck refuses only on what it renders; the run sheet names the rest as off-slide", () => {
    // Every key point is on a slide now, so the only slot the deck does not show is one in a script
    const c = ctx(base({ hook: { keyPoints: "Open the loop", script: "Send them to [SALES PAGE URL]." }, problem_frame: { keyPoints: "Costs [$N] a month" } }));
    const d = deckSlides(c, kit);
    expect(d.refused).toEqual(["Slide 4 (Problem Frame): [$N] sits in a sentence that carries a number: a claim with a hole in it."]);
    expect(offSlidePlaceholders(c, d)).toEqual({ total: 2, offSlide: 1, sections: [{ section: "Hook", onSlide: [], offSlide: ["[SALES PAGE URL]"] }, { section: "Problem Frame", onSlide: ["[$N]"], offSlide: [] }] });
  });
});

describe("the brand kit on the file", () => {
  it("every colour is the kit's hex verbatim, accent draws rules and fills and never letters, the proof headline takes the quote face, and a placeholder is drawn in the kit's colour", () => {
    const d = deckSlides(ctx(base({ hook: { keyPoints: "Open the loop\nSend them to [SALES PAGE URL]" }, proof_block: {} }), [{ type: "vehicle", fromBelief: "a", toBelief: "b", proofId: "p1" }]), kit);
    const plan = renderPlan(d);
    for (const p of plan) {
      const dark = d.slides[p.n - 1].inverse;
      expect(p.background).toBe(dark ? "6E6256" : "FAF8F5");
      for (const b of p.boxes) {
        // Letters are ink or muted (inverseInk on the dark surfaces), all refused under 4.5:1 by the kit rules; the accent never colours a text box or sits under one
        expect(dark ? ["FAF8F5"] : ["6E6256", "4B5563"]).toContain(b.color);
        expect(b.fill).not.toBe("DD2727");
        if (b.role === "eyebrow" && !dark) expect(b).toMatchObject({ size: EYEBROW_SIZE, color: "4B5563" });
      }
      for (const r of p.rules) expect(r.color).toBe("DD2727");
    }
    expect(plan[0].rules).toEqual([]);
    expect(plan[1].rules).toHaveLength(1);
    const hook = plan[1];
    expect(hook.boxes.find((b) => b.role === "headline")).toMatchObject({ text: "Open the loop", size: 40, color: "6E6256", fill: null, face: "Red Hat Display", bold: true });
    // The second key point is its own slide; its headline is the unfilled slot, drawn on the kit's placeholder colour
    expect(plan[2].boxes.find((b) => b.role === "headline")).toMatchObject({ text: "Send them to [SALES PAGE URL]", fill: "FFF3A3", face: "Red Hat Display", placeholder: true });
    expect(plan.flatMap((p) => p.boxes).find((b) => b.role === "body")?.size).toBe(BODY_SIZE);
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

describe("the deck against the clock", () => {
  it("slides a minute over the minutes without Q&A, per act, with the thin acts named and the offer's share", () => {
    const c = ctx(base({ hook: { keyPoints: "One\nTwo\nThree" }, problem_frame: { keyPoints: "Four" } }));
    const d = deckSlides(c, kit);
    const p = deckPace(c, d);
    const qa = c.sections.find((s) => s.sectionKey === "q_a_close")!.durationMin;
    expect(qa).toBeGreaterThan(0);
    expect(p.minutes).toBe(c.totalMin - qa);
    expect(p.slides).toBe(d.slides.length);
    expect(p.rate).toBe(Math.round((d.slides.length / p.minutes) * 10) / 10);
    expect(p.offerSlides).toBe(2);
    // Two of the twenty sections carry key points; the deck reads only those, and the readout says so
    expect(p.sectionsWithPoints).toBe(2);
    expect(p.sections).toBe(20);
    const vehicle = p.acts.find((a) => a.key === "vehicle")!;
    // divider, Problem Frame, recap: three slides over the act's minutes
    expect(vehicle.slides).toBe(3);
    expect(vehicle.thin).toBe(vehicle.rate !== null && vehicle.rate < PACE_BAND[0]);
    const closing = p.acts.find((a) => a.key === "closing")!;
    expect(closing.minutes).toBe(c.acts.find((a) => a.key === "closing")!.durationMin - qa);
    expect(paceLine(p)).toMatch(/^\d+ slides · ~\d+ min without Q&A · [\d.]+ slides a minute\. Reference pace is 1\.7, measured from a live 90-minute deck with Q&A not counted; the band is 1\.2 to 1\.5\.( Thin: .+, each over its own minutes without Q&A\.)? Offer segment is 2 of \d+ slides\.$/);
  });
});

describe("the opening the record can fill, and a section that builds", () => {
  it("who it is for and not for come off the Offer record and the stay line off Foundation, after the opening act's first section; the beats are the origin section's own slides, only the filled ones, in order", () => {
    const withFit = { ...offer, offer: { ...offer.offer, forYouIf: "You run a practice. You have tried a plan before.", notForYouIf: "You want a pill." } };
    const c = resolveSections({ webinar: { title: "t", stayLine: "Stay to the end for the one swap that matters.", originStory: { wall: "The week I rebuilt everything at 2am.", wanted: "I wanted a practice that ran without me.", nope: "ignored" } }, presenter: "L", sections: base({ hook: { keyPoints: "Open the loop" }, credibility_origin: { keyPoints: "The week it changed" } }), beliefs: [], proofs, assets, essenceStories: [], citable, offer: withFit });
    expect(c.originStory).toEqual([{ key: "wanted", label: "What you wanted", text: "I wanted a practice that ran without me." }, { key: "wall", label: "The wall", text: "The week I rebuilt everything at 2am." }]);
    const d = deckSlides(c, kit);
    expect(d.slides.slice(1, 8).map((s) => [s.headline, s.eyebrow])).toEqual([
      ["Open the loop", "Hook · Opening frame"],
      ["This is for you if…", "Who it is for · Opening frame"],
      ["This is not for you if…", "Who it is for · Opening frame"],
      ["Stay to the end for the one swap that matters.", "Stay to the end · Opening frame"],
      ["I wanted a practice that ran without me.", "Credibility / Origin · What you wanted"],
      ["The week I rebuilt everything at 2am.", "Credibility / Origin · The wall"],
      ["The week it changed", "Credibility / Origin · Opening frame"],
    ]);
    expect(d.slides[2].body).toEqual(["You run a practice.", "You have tried a plan before."]);
    // Nothing on the record, nothing on the deck; an omitted origin section takes its beats with it
    const bare = deckSlides(ctx(base({ hook: { keyPoints: "Open the loop" } })), kit);
    expect(bare.slides.slice(1, 3).map((s) => s.kind)).toEqual(["section", "divider"]);
    const omitted = deckSlides(resolveSections({ webinar: { title: "t", originStory: { wall: "x" } }, presenter: "L", sections: base({ credibility_origin: { status: "omitted" } }), beliefs: [], proofs, assets, essenceStories: [], citable, offer: null }), kit);
    expect(omitted.slides.some((s) => s.headline === "x")).toBe(false);
  });
  it("a section set to reveal keeps its first point as the line and adds each further point beneath it, one slide per point", () => {
    const d = deckSlides(ctx(base({ hook: { keyPoints: "One\nTwo\nThree", buildStyle: "reveal" }, problem_frame: { keyPoints: "A\nB" } })), kit);
    expect(bySection(d, "hook").map((s) => [s.headline, s.body])).toEqual([["One", []], ["One", ["Two"]], ["One", ["Two", "Three"]]]);
    expect(bySection(d, "problem_frame").map((s) => [s.headline, s.body])).toEqual([["A", []], ["B", []]]);
  });
});

describe("deck v2: the opening contract, the reflection beat, the moment family, and picture slots (all from the record)", () => {
  // A context with the opening contract filled, one line (permission) left blank, and a reflection question.
  const openCtx = (over: Record<string, unknown> = {}) =>
    resolveSections({
      webinar: {
        title: "Your Edge, Uncovered",
        promiseLine: "Leave with a plan you'll actually run.",
        chatPrompt: "Say hi and where you're tuning in from.",
        groundRule: "Nothing here is a guarantee of income.",
        outcomes: ["A clear next step", "A plan for the week", "One belief broken"],
        sessionGoal: "Get you to your first booked call.",
        permissionLine: null,
        reflectionPrompt: "What is this costing you already?",
        footerBar: true,
        ctaBar: true,
        ...over,
      },
      presenter: "Lindsey Brittain",
      sections: base({ credibility_origin: { keyPoints: null }, case_study: { keyPoints: null } }),
      beliefs: [{ type: "vehicle", fromBelief: "a", toBelief: "b", proofId: "p1", storyAssetId: "s1" }],
      proofs,
      assets,
      essenceStories: [],
      citable,
      offer,
    });

  it("each filled opening line is its own slide, in order, and a blank one is omitted and listed", () => {
    const d = deckSlides(openCtx(), kit);
    const opening = d.slides.filter((s) => s.kind === "opening").map((s) => s.headline);
    // Promise, chat, ground rule, the outcomes slide, then the goal. Permission is blank, so it is not here and is listed.
    expect(opening).toEqual([
      "Leave with a plan you'll actually run.",
      "Say hi and where you're tuning in from.",
      "Nothing here is a guarantee of income.",
      "By the end you'll have",
      "Get you to your first booked call.",
    ]);
    expect(d.slides.find((s) => s.headline === "By the end you'll have")!.body).toEqual(["A clear next step", "A plan for the week", "One belief broken"]);
    expect(d.openingOmitted).toEqual(["Permission to be direct"]);
    // Every opening slide is one of the coach's own lines: no invented copy.
    for (const s of d.slides.filter((s) => s.kind === "opening")) expect(s.section).toBe("");
  });

  it("with no opening lines filled, there are no opening slides and every one is listed", () => {
    const d = deckSlides(openCtx({ promiseLine: null, chatPrompt: null, groundRule: null, outcomes: [], sessionGoal: null, permissionLine: null }), kit);
    expect(d.slides.filter((s) => s.kind === "opening")).toEqual([]);
    expect(d.openingOmitted).toEqual(["The promise", "Say hi in the chat", "Ground rule", "Three outcomes", "My goal today", "Permission to be direct"]);
  });

  it("the reflection beat is the coach's own question, on a moment slide, and only when the field is set", () => {
    const withIt = deckSlides(openCtx(), kit).slides.filter((s) => s.kind === "reflection");
    expect(withIt.map((s) => s.headline)).toEqual(["What is this costing you already?"]);
    expect(withIt[0].inverse).toBe(true);
    expect(deckSlides(openCtx({ reflectionPrompt: null }), kit).slides.filter((s) => s.kind === "reflection")).toEqual([]);
  });

  it("the price slide joins the moment family; the item slides do not", () => {
    const offerSlides = deckSlides(openCtx(), kit).slides.filter((s) => s.kind === "offer");
    const price = offerSlides.find((s) => s.headline === offer.offer.name)!;
    expect(price.inverse).toBe(true);
    expect(offerSlides.filter((s) => s.headline !== offer.offer.name).every((s) => !s.inverse)).toBe(true);
  });

  it("picture slots are suggested by rule from the slide kind, each with its fixed instruction, and never on the price slide", () => {
    const d = deckSlides(openCtx({ credibility_origin: undefined }), kit);
    const slots = suggestedSlots(d);
    const kinds = new Set(slots.map((x) => x.slot.kind));
    expect(kinds.has("photo")).toBe(true); // cover and story
    expect(kinds.has("testimonial")).toBe(true); // the proof slide
    expect(kinds.has("screenshot_callout")).toBe(false); // no evidence wired in this ctx
    // The cover carries a photo slot; the price slide carries none.
    expect(d.slides.find((s) => s.kind === "cover")!.slot?.kind).toBe("photo");
    expect(d.slides.filter((s) => s.kind === "offer").every((s) => s.slot === null)).toBe(true);
    // Every slot's instruction is the fixed one for its kind, never generated.
    for (const x of slots) expect(x.slot.what).toBe(SLOT_WHAT[x.slot.kind]);
  });

  it("a testimonial slot carries its bank proof's id, so its photo can only be that approved proof's own", () => {
    const d = deckSlides(openCtx({ credibility_origin: undefined }), kit);
    const testimonial = d.slides.find((s) => s.slot?.kind === "testimonial");
    expect(testimonial?.slot?.proofId).toBe("p1"); // the approved bank proof wired to the belief
  });

  it("a picture frame stays inside the 10×5.625 slide, for the cover and for a content slide alike", () => {
    for (const kind of ["cover", "section"] as const) {
      const f = slotFrame(kind);
      expect(f.x + f.w).toBeLessThanOrEqual(10);
      expect(f.y + f.h).toBeLessThanOrEqual(5.625);
      expect(f.x).toBeGreaterThan(TEXT_LEFT_ZONE.x + TEXT_LEFT_ZONE.w - 0.01); // the picture starts to the right of the text column
    }
  });

  it("renderPlan draws no picture frame by default, and one only on the slides told to carry an image", () => {
    const d = deckSlides(openCtx({ credibility_origin: undefined }), kit);
    expect(renderPlan(d).every((p) => p.imageFrame === null)).toBe(true);
    const plan = renderPlan(d, new Set([1])); // the cover
    expect(plan[0].imageFrame).not.toBeNull();
    expect(plan.slice(1).every((p) => p.imageFrame === null)).toBe(true);
    // The cover's title still renders alongside the picture; nothing is dropped to make room.
    expect(plan[0].boxes.some((b) => b.role === "cover-title")).toBe(true);
  });
});
