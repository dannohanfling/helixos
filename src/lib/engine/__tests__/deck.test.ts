import { describe, expect, it } from "vitest";
import { SECTION_TEMPLATES } from "../webinar";
import { resolveSections, type SectionRow } from "../webinar-context";
import { BODY_SIZE, EYEBROW_SIZE, HEADLINE_FLOOR, HEADLINE_MAX_CHARS, HEADLINE_TIERS, NEUTRAL_KIT, STARTER_KIT, PACE_BAND, PLACEHOLDER_FALLBACK, TEXT_LEFT_ZONE, deckPace, deckSlides, headlineTier, offSlidePlaceholders, offerBuild, outlineText, paceLine, placeholderHits, renderPlan, slotFrame, suggestedSlots, SLOT_WHAT, type DeckKit, PLACEHOLDER_RED, placeholderLine, PICTURE_ONLY_FRAME, slideGeometry, COVER_LOGO_BOX, coverLogoPlan, logoBadgeFrame, eventLine, BODY_FIT_SIZES, PLACEHOLDER_TEXT_SIZE, echoes, quoteWithSubject, boxAt } from "../deck";

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
    // §9: a story is told as beats, one sentence per slide, the picture slot on the first beat only; the bank's title is in the notes, never on a face.
    const beats = bySection(story, "case_study");
    expect(beats.map((b) => [b.kind, b.headline, b.body, Boolean(b.slot)])).toEqual([
      ["story", "She fixed the wrong thing.", [], true],
      ["story", "Then she named the drift.", [], false],
      ["story", "It held.", [], false],
    ]);
    for (const b of beats) expect(b.notes).toContain("Story: Chasing the symptom");
    expect(beats.some((b) => b.headline.includes("Chasing the symptom"))).toBe(false);
    expect(bySection(deckSlides(ctx(base()), kit), "case_study")).toEqual([]);
  });
  it("the Offer Stack is the linked stack as a build with its currency, then the price; unlinked, nothing", () => {
    const d = deckSlides(ctx(base()), kit);
    const [item, anchor] = bySection(d, "offer_stack_cta");
    expect(item).toMatchObject({ kind: "offer", headline: "Diagnostic", body: ["90 minutes, 1:1"] });
    // The one item carries no value, so no total renders anywhere and the price stands alone, huge, under "Get started today";
    // the offer's own name is the eyebrow, never the headline (first-deck §5)
    expect(anchor).toMatchObject({ kind: "offer", headline: "Get started today", eyebrow: "The 90-Minute Diagnostic", body: [], figure: { value: "NZD $1,997", size: "price", struck: null, small: [] } });
    expect(bySection(deckSlides(ctx(base(), [], false), kit), "offer_stack_cta")).toEqual([]);
  });
  it("the build re-shows the running total after each item and the price against it; any item without a value and no total renders at all", () => {
    const o = { name: "The 90-Day Reset", price: 1997, currency: "NZD", container: "group", guarantee: "Free until you lose 10.", paymentPlan: "3 x $700", scarcity: null, urgency: "Doors close Friday.", ctaFooter: null, forYouIf: null, notForYouIf: null, objections: [], components: [
      { name: "The program", type: "core", oneLiner: "12 weeks", perceivedValue: 3000, beliefBreak: "vehicle" },
      { name: "Template library", type: "bonus", description: "You pick.", perceivedValue: 497, beliefBreak: "internal" },
      { name: "Free until you lose 10", type: "guarantee", perceivedValue: 0, beliefBreak: "none" },
    ] };
    // A core item adds its row to the table, the running total under it; a bonus is its own slide, its value large; then every
    // item in one table with the total struck through to the price; then the price itself, and the guarantee with its seal.
    expect(offerBuild(o)).toEqual([
      { headline: "The program", body: ["12 weeks"], stack: { rows: [{ name: "The program", value: "NZD $3,000" }], newest: 0, runningTotal: "NZD $3,000", total: null, price: null } },
      { headline: "Template library", eyebrow: "Bonus", body: ["You pick."], figure: { value: "NZD $497 value", size: "value", struck: null, small: ["Total value so far: NZD $3,497"] } },
      { headline: "Everything you get", body: [], stack: { rows: [{ name: "The program", value: "NZD $3,000" }, { name: "Template library", value: "NZD $497" }], newest: null, runningTotal: null, total: "NZD $3,497", price: "NZD $1,997" } },
      { headline: "Get started today", eyebrow: "The 90-Day Reset", body: [], price: true, figure: { value: "NZD $1,997", size: "price", struck: "Total value NZD $3,497", small: ["You save NZD $1,500", "Payment plan: 3 x $700"] } },
      { headline: "Free until you lose 10.", body: [], seal: true },
      { headline: "Doors close Friday.", body: [] },
    ]);
    // A bonus's line is the problem it solves when the offer has one, else its own line.
    expect(offerBuild({ ...o, components: [o.components[0], { ...o.components[1], problemItSolves: "No more blank pages." }] })[1].body).toEqual(["No more blank pages."]);
    // A second core item: the table grows, the first row still there, the new row the newest.
    const two = offerBuild({ ...o, components: [o.components[0], { name: "Weekly calls", type: "core", oneLiner: "Live", perceivedValue: 1000, beliefBreak: "vehicle" }] });
    expect(two[1].stack).toEqual({ rows: [{ name: "The program", value: "NZD $3,000" }, { name: "Weekly calls", value: "NZD $1,000" }], newest: 1, runningTotal: "NZD $4,000", total: null, price: null });
    // The anchor off: the running totals still build, the price stands on its own, the summary draws no total, and nothing else changes
    const noAnchor = offerBuild(o, false);
    expect(noAnchor.map((x) => x.figure?.small ?? [])).toEqual([[], ["Total value so far: NZD $3,497"], [], ["Payment plan: 3 x $700"], [], []]);
    expect(noAnchor[3].figure).toMatchObject({ value: "NZD $1,997", struck: null });
    expect(noAnchor[2].stack).toMatchObject({ total: null, price: null });
    expect(JSON.stringify(noAnchor)).not.toMatch(/Total value NZD|save/);
    const kitOff = deckSlides(ctx(base()), { ...kit, showPriceAnchor: false });
    expect(bySection(kitOff, "offer_stack_cta").map((s) => s.headline)).toEqual(["Diagnostic", "Get started today"]);
    // An item without a value: no total anywhere, each valued item still shows its own value.
    const zero = offerBuild({ ...o, components: [o.components[0], { ...o.components[1], perceivedValue: 0 }, o.components[2]] });
    expect(zero.map((x) => x.figure ?? null)).toEqual([null, null, null, { value: "NZD $1,997", size: "price", struck: null, small: ["Payment plan: 3 x $700"] }, null, null]);
    expect(zero.map((x) => x.stack?.rows ?? null)).toEqual([[{ name: "The program", value: "NZD $3,000" }], null, [{ name: "The program", value: "NZD $3,000" }, { name: "Template library", value: null }], null, null, null]);
    expect(zero.map((x) => [x.stack?.runningTotal ?? null, x.stack?.total ?? null])).toEqual(Array(6).fill([null, null]));
    expect(JSON.stringify(zero)).not.toMatch(/Total value|save/);
  });
  it("a divider opens each belief act with the shift from the record, on the kit's inverse pair; a recap closes it with each section's first line", () => {
    const d = deckSlides(ctx(base({ problem_frame: { keyPoints: "Name the enemy\nSecond" }, mechanism_reveal: { keyPoints: "Draw the hub" } }), [{ type: "vehicle", fromBelief: "Diets are all the same.", toBelief: "It was the plan." }]), kit);
    const divider = d.slides.find((s) => s.kind === "divider")!;
    // §9: the act's label never reaches a face; the divider says the shift itself, the recap repeats the act's lines under it.
    expect(divider).toMatchObject({ n: 2, act: "vehicle", headline: "It was the plan.", body: ["From: Diets are all the same."], inverse: true, sectionKey: null });
    expect(divider.notes).toContain("Section: Act 1 · Vehicle");
    const recap = d.slides.find((s) => s.kind === "recap")!;
    expect(recap).toMatchObject({ act: "vehicle", headline: "It was the plan.", body: ["Name the enemy", "Draw the hub"], inverse: false });
    // Only the act with a belief row gets a divider (§9): there is no shift to announce without one.
    expect(d.slides.filter((s) => s.kind === "divider").map((s) => s.act)).toEqual(["vehicle"]);
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
    // 1 cover · 2 Hook · 3 Problem Frame · 4 Proof Block · 5 Act 1 recap · 6 item · 7 price (no belief rows here, so no dividers, §9)
    expect(d.refused).toEqual(["Slide 2 (Hook): [X]% sits in a sentence that carries a number: a claim with a hole in it.", "Slide 4 (Proof Block): [CLIENT NAME] sits on a proof slide, which is a claim by its nature."]);
    // The recap repeats the act's lines, so the slot is on two slides and counted twice, but named once, at its source
    expect(d.warnings).toEqual(["Slide 3 (Problem Frame): [SALES PAGE URL] is a gap to fill."]);
    expect(d.slides[4].kind).toBe("recap");
    expect(d.slides[4].placeholders.map((p) => p.text)).toEqual(["[SALES PAGE URL]", "[CLIENT NAME]"]);
    expect(d.placeholderCount).toBe(5);
    expect(outlineText("t", d)).toContain("Deck outline · 7 slides · 5 unfilled on slides");
  });
  it("the deck refuses only on what it renders; the run sheet names the rest as off-slide", () => {
    // Every key point is on a slide now, so the only slot the deck does not show is one in a script
    const c = ctx(base({ hook: { keyPoints: "Open the loop", script: "Send them to [SALES PAGE URL]." }, problem_frame: { keyPoints: "Costs [$N] a month" } }));
    const d = deckSlides(c, kit);
    expect(d.refused).toEqual(["Slide 3 (Problem Frame): [$N] sits in a sentence that carries a number: a claim with a hole in it."]);
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
    // One line and no body is a statement (§4): 60pt, centred; the colours and face are the kit's as before.
    expect(hook.boxes.find((b) => b.role === "headline")).toMatchObject({ text: "Open the loop", size: 60, color: "6E6256", fill: null, face: "Red Hat Display", bold: true });
    // The second key point is its own slide; its headline is the unfilled slot, drawn on the kit's placeholder colour
    expect(plan[2].boxes.find((b) => b.role === "headline")).toMatchObject({ text: "Send them to [SALES PAGE URL]", fill: "FFF3A3", face: "Red Hat Display", placeholder: true });
    const reveal = renderPlan(deckSlides(ctx(base({ problem_frame: { keyPoints: "Name the enemy\nShow the cost", buildStyle: "reveal" } })), kit));
    expect(reveal.flatMap((p) => (p.layout === "content" ? p.boxes : [])).find((b) => b.role === "body")).toMatchObject({ text: "Show the cost", size: BODY_SIZE });
    const proof = plan.find((p) => d.slides[p.n - 1].kind === "proof")!;
    expect(proof.boxes.find((b) => b.role === "headline")).toMatchObject({ face: "Libre Baskerville", italic: true, bold: false });
    expect(proof.boxes.find((b) => b.role === "attribution")).toMatchObject({ text: "— Kate A.", color: "4B5563" });
  });
  it("a kit whose pair cannot read refuses the render with the pair named; no kit renders neutral and says so; no placeholder colour falls back to one colour, named", () => {
    const bad = deckSlides(ctx(base()), { ...kit, ink: "9CA3AF" });
    expect(bad.refused).toEqual(["Brand kit: ink on ground is 2.4:1; it needs 4.5:1 to read on a slide.", "Brand kit: ink on placeholder is 2.25:1; it needs 4.5:1, or the unfilled slot cannot be read."]);
    const none = deckSlides(ctx(base()), null);
    expect(none.kit).toBe(STARTER_KIT);
    expect(none.kitApplied).toBe(false);
    expect(none.warnings).toContain("No brand kit of your own yet: the deck uses the house starter kit. Replace it with your colours, faces and logo on Settings.");
    // The house starter kit reads on every pair it uses: nothing refused, and ink well past 4.5:1 on its ground.
    expect(deckSlides(ctx(base()), STARTER_KIT).refused).toEqual([]);
    expect(none.refused).toEqual([]);
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
    // Problem Frame and the recap: two slides over the act's minutes (no belief row here, so no divider, §9)
    expect(vehicle.slides).toBe(2);
    expect(vehicle.thin).toBe(vehicle.rate !== null && vehicle.rate < PACE_BAND[0]);
    const closing = p.acts.find((a) => a.key === "closing")!;
    expect(closing.minutes).toBe(c.acts.find((a) => a.key === "closing")!.durationMin - qa);
    expect(paceLine(p)).toMatch(/^\d+ slides · ~\d+ min without Q&A · [\d.]+ slides? a minute\. A first draft lands between 1\.2 and 1\.5; the finished reference deck ran at 1\.7 \(a live 90-minute deck, Q&A not counted\)\.( Thin: .+, each over its own minutes without Q&A\.)? Offer segment is 2 of \d+ slides\.$/);
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
    expect(bare.slides.slice(1, 3).map((s) => s.kind)).toEqual(["section", "offer"]);
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
    const price = offerSlides.find((s) => s.figure?.size === "price")!;
    expect(price.inverse).toBe(true);
    expect(price.eyebrow).toBe(offer.offer.name);
    expect(offerSlides.filter((s) => s !== price).every((s) => !s.inverse)).toBe(true);
  });

  it("picture slots are suggested by rule from the slide's words (§3), each naming what to show, never on the price slide, never three in a row", () => {
    const d = deckSlides(ctx(base({ problem_frame: { keyPoints: "602 comments on my post in 48 hours\nMost leaders never name the drift." } }), [{ type: "vehicle", fromBelief: "a", toBelief: "b", proofId: "p1", storyAssetId: "s1" }]), kit);
    const slots = suggestedSlots(d);
    const kinds = new Set(slots.map((x) => x.slot.kind));
    expect(kinds.has("photo")).toBe(true); // cover and story
    expect(kinds.has("testimonial")).toBe(true); // the proof slide
    // A key point with a figure asks for a screenshot with it circled; a line that names nothing to show asks for nothing.
    const figure = d.slides.find((s) => s.headline.startsWith("602 comments"))!;
    expect(figure.slot).toEqual({ key: `${figure.sectionKey}:kp0:screenshot_callout`, kind: "screenshot_callout", what: "A screenshot with “602 comments on my post” circled." });
    expect(d.slides.find((s) => s.headline === "Most leaders never name the drift.")!.slot).toBeNull();
    // The cover carries a photo slot naming what to shoot; the price slide carries none.
    expect(d.slides.find((s) => s.kind === "cover")!.slot).toEqual({ key: "cover:photo", kind: "photo", what: "A photo of you: on stage, or on a call." });
    expect(d.slides.filter((s) => s.kind === "offer").every((s) => s.slot === null)).toBe(true);
    // Every instruction names its subject, from a fixed lead and the slide's own words, never generated.
    for (const x of slots) expect(x.slot.what).toMatch(/^(A photo of|A screenshot with|Your own diagram of|Two photos side by side|A wall of your real|The client's photo)/);
    // Never three picture slots in a row.
    let run = 0;
    for (const s of d.slides) {
      run = s.slot ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(2);
    }
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

  it("an empty slot is a red placeholder in the picture's frame (§2): what to add, in the fixed red, never the accent; filled, the same frame carries the picture", () => {
    const d = deckSlides(openCtx({ credibility_origin: undefined }), kit);
    const empty = renderPlan(d);
    const cover = empty[0];
    expect(cover.imageFrame).toBeNull();
    expect(cover.placeholderSlot).toEqual({ frame: slotFrame("cover"), text: "Add a photo of you: on stage, or on a call.", color: PLACEHOLDER_RED });
    expect(PLACEHOLDER_RED).not.toBe(kit.accent);
    // A slide with no suggested slot carries no placeholder.
    expect(empty.filter((p) => !d.slides[p.n - 1].slot).every((p) => p.placeholderSlot === null)).toBe(true);
    const filled = renderPlan(d, new Set([1]))[0];
    expect(filled.placeholderSlot).toBeNull();
    expect(filled.imageFrame).toEqual(slotFrame("cover"));
    expect(placeholderLine({ key: "k", kind: "screenshot_callout", what: "A screenshot with “602 comments on my post” circled." })).toBe("Add a screenshot with “602 comments on my post” circled.");
    expect(placeholderLine({ key: "k", kind: "testimonial", what: SLOT_WHAT.testimonial })).toBe("Add the client's photo beside their approved quote.");
    expect(placeholderLine({ key: "k", kind: "diagram", what: "Your own diagram of the system this slide names." })).toBe("Add your own diagram of the system this slide names.");
  });

  it("§4: a one-line slide is a statement, large and centred; text beside a picture shrinks to fit, and a body that cannot fit sends the picture to its own slide", () => {
    const d = deckSlides(openCtx(), kit);
    const plans = renderPlan(d);
    const statement = plans.find((p) => p.n === d.slides.find((s) => s.kind === "opening" && !s.body.length)!.n)!;
    expect(statement.layout).toBe("statement");
    expect(statement.boxes.find((b) => b.role === "headline")!.size).toBeGreaterThanOrEqual(44);
    const outcomes = plans.find((p) => p.n === d.slides.find((s) => s.headline === "By the end you'll have")!.n)!;
    // The outcomes are cards (deck layouts 3): one per outcome on the surface, every card's text at one size.
    expect(outcomes.layout).toBe("cards");
    const cardSizes = new Set(outcomes.boxes.filter((b) => b.role === "card").map((b) => b.size));
    expect(cardSizes.size).toBe(1);
    expect([...cardSizes][0]).toBeLessThanOrEqual(BODY_SIZE);
    expect(outcomes.panels?.length).toBe(outcomes.boxes.filter((b) => b.role === "card").length);
    // A case-study slide with a long body beside a picture: the body shrinks, then the picture takes the next slide.
    const longBody = Array(7).fill("A long bullet about the thing we did that week and what it changed for the team").join("\n");
    const c = ctx(base({ problem_frame: { keyPoints: `Six things happened\n${longBody}`, buildStyle: "reveal" } }), [{ type: "vehicle", fromBelief: "a", toBelief: "b", proofId: "p1", storyAssetId: "s1" }]);
    const dd = deckSlides(c, kit);
    const reveal = dd.slides.filter((s) => s.sectionKey === "problem_frame");
    const last = reveal[reveal.length - 1];
    const planned = renderPlan(dd, new Set([last.n]));
    const forLast = planned.filter((p) => p.n === last.n);
    expect(forLast).toHaveLength(2);
    expect(forLast[0].imageFrame).toBeNull();
    expect(forLast[0].pictureOnly).toBe(false);
    expect(forLast[1]).toMatchObject({ pictureOnly: true, imageFrame: PICTURE_ONLY_FRAME, boxes: [] });
    expect(forLast[0].boxes.filter((b) => b.role === "body").every((b) => b.size <= BODY_SIZE)).toBe(true);
    // The same slide with a short body keeps the picture beside the text.
    const short = renderPlan(dd, new Set([reveal[0].n])).filter((p) => p.n === reveal[0].n);
    expect(short).toHaveLength(1);
    expect(short[0].imageFrame).not.toBeNull();
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

describe("§6.4: the boxes' geometry lives in the plan", () => {
  const box = (role: "cover-title" | "cover-presenter" | "eyebrow" | "headline" | "body" | "footer") => ({ slide: 1, role, text: "x", size: 20, color: "111111", fill: null, face: "Arial", bold: false, italic: false, bullet: false, placeholder: false });
  it("a bare cover centres its title; beside a picture the title sits in the left column", () => {
    const bare = slideGeometry({ boxes: [box("cover-title"), box("cover-presenter")], layout: "cover", imageFrame: null, placeholderSlot: null, pictureOnly: false });
    expect(bare.boxes["cover-title"]).toEqual({ x: 0.5, y: 1.35, w: 9, h: 1.6, align: "center", valign: "middle" });
    // Air between the title and the presenter (first-deck §4: they touched), then the date line under the name.
    const t = bare.boxes["cover-title"]!, p = bare.boxes["cover-presenter"]!, dt = bare.boxes["cover-date"]!;
    expect(p.y - (t.y + t.h)).toBeGreaterThanOrEqual(0.35);
    expect(dt.y).toBeGreaterThanOrEqual(p.y + p.h - 1e-9);
    expect(bare.rules).toEqual({ x: 0.5, w: 9 });
    const beside = slideGeometry({ boxes: [box("cover-title")], layout: "cover", imageFrame: { x: 5.2, y: 0.9, w: 4.3, h: 3.85 }, placeholderSlot: null, pictureOnly: false });
    expect(beside.boxes["cover-title"]).toEqual({ x: TEXT_LEFT_ZONE.x, y: 1.4, w: TEXT_LEFT_ZONE.w, h: 1.8, align: "left", valign: "middle" });
    expect(beside.rules.w).toBe(TEXT_LEFT_ZONE.w);
  });
  it("a content slide: eyebrow, headline at the top, the body in its own box, the footer centred; a statement sits centred and tall; an empty slot narrows the text like a picture", () => {
    const content = slideGeometry({ boxes: [box("eyebrow"), box("headline"), box("body"), box("footer")], layout: "content", imageFrame: null, placeholderSlot: null, pictureOnly: false });
    expect(content.boxes.headline).toEqual({ x: 0.5, y: 0.8, w: 9, h: 1.5, align: "left", valign: "top" });
    expect(content.body).toEqual({ x: 0.7, y: 2.4, w: 8.6, h: 2.4, align: "left", valign: "top" });
    expect(content.boxes.footer).toEqual({ x: 0.5, y: 5.0, w: 9, h: 0.3, align: "center", valign: "top" });
    const statement = slideGeometry({ boxes: [box("headline")], layout: "statement", imageFrame: null, placeholderSlot: null, pictureOnly: false });
    expect(statement.boxes.headline).toEqual({ x: 0.5, y: 1.0, w: 9, h: 3.4, align: "left", valign: "middle" });
    expect(statement.body).toBeNull();
    const narrow = slideGeometry({ boxes: [box("headline"), box("body")], layout: "content", imageFrame: null, placeholderSlot: { frame: { x: 5.35, y: 1.05, w: 4.15, h: 3.5 }, text: "Add a photo", color: "D92D20" }, pictureOnly: false });
    expect(narrow.boxes.headline?.w).toBe(TEXT_LEFT_ZONE.w);
    expect(narrow.body?.x).toBe(TEXT_LEFT_ZONE.x + 0.2);
    expect(slideGeometry({ boxes: [], layout: "content", imageFrame: { x: 1.5, y: 0.6, w: 7, h: 4.4 }, placeholderSlot: null, pictureOnly: true }).boxes).toEqual({});
  });
});


describe("first-deck §3: the cover's logo", () => {
  const cover = { coverBackground: "1F2A37", ground: "F7F5F0" };
  it("is at least 2.5 in wide and clear of the title", () => {
    expect(COVER_LOGO_BOX.w).toBeGreaterThanOrEqual(2.5);
    const title = slideGeometry({ boxes: [{ slide: 1, role: "cover-title", text: "", size: 40, color: "", fill: null, face: "", bold: true, italic: false, bullet: false, placeholder: false }], layout: "cover", imageFrame: null, placeholderSlot: null, pictureOnly: false }).boxes["cover-title"]!;
    expect(COVER_LOGO_BOX.y + COVER_LOGO_BOX.h).toBeLessThanOrEqual(title.y);
  });
  it("takes the kit's dark logo on a dark cover, and the one logo on a light one", () => {
    expect(coverLogoPlan({ ...cover, hasLogo: true, hasDark: true, logoColor: "3B1F3A" })).toEqual({ use: "dark", badge: null });
    expect(coverLogoPlan({ coverBackground: "F7F5F0", ground: "F7F5F0", hasLogo: true, hasDark: true, logoColor: "3B1F3A" })).toEqual({ use: "logo", badge: null });
    expect(coverLogoPlan({ ...cover, hasLogo: false, hasDark: true, logoColor: null })).toEqual({ use: "dark", badge: null });
  });
  it("puts a dark wordmark on a ground badge when it would not read at 3:1, and leaves a light one bare", () => {
    expect(coverLogoPlan({ ...cover, hasLogo: true, hasDark: false, logoColor: "3B1F3A" })).toEqual({ use: "logo", badge: "F7F5F0" });
    expect(coverLogoPlan({ ...cover, hasLogo: true, hasDark: false, logoColor: "FFFFFF" })).toEqual({ use: "logo", badge: null });
    // A logo the measure could not read stands bare rather than guessed at.
    expect(coverLogoPlan({ ...cover, hasLogo: true, hasDark: false, logoColor: null })).toEqual({ use: "logo", badge: null });
  });
  it("says none when there is no logo at all, so the cover shows the red placeholder", () => {
    expect(coverLogoPlan({ ...cover, hasLogo: false, hasDark: false, logoColor: null })).toEqual({ use: "none", badge: null });
  });
  it("draws the badge round the placed logo with a margin, inside the slide", () => {
    const b = logoBadgeFrame({ x: 0.5, y: 0.3, w: 2.6, h: 0.5 });
    for (const [k, v] of Object.entries({ x: 0.4, y: 0.2, w: 2.8, h: 0.7 })) expect(b[k as keyof typeof b]).toBeCloseTo(v);
    const edge = logoBadgeFrame({ x: 0.08, y: 0.08, w: 1, h: 0.5 });
    expect(edge.x).toBeGreaterThanOrEqual(0.05);
    expect(edge.x + edge.w).toBeCloseTo(1.18);
  });
});

describe("first-deck §4 and §5: readable sizes, the CTA once, the price and the close", () => {
  const withFooter = { ...offer, offer: { ...offer.offer, ctaFooter: "DM me the word PLAN" } };
  const closeCtx = (webinar: Record<string, unknown> = {}) => resolveSections({ webinar: { title: "t", ctaType: "Book a call", ...webinar }, presenter: "L", sections: base({ hook: { keyPoints: "Open" }, q_a_close: { keyPoints: "Ask anything" } }), beliefs: [], proofs, assets, essenceStories: [], citable, offer: withFooter });
  it("placeholder text and the body read on a projector: 20pt and 24pt, with the old floor", () => {
    expect(PLACEHOLDER_TEXT_SIZE).toBe(20);
    expect(BODY_FIT_SIZES[0]).toBe(24);
    expect(BODY_FIT_SIZES.at(-1)).toBe(14);
  });
  it("the cover's date line is the webinar's date and time as typed, and absent without one", () => {
    expect(eventLine("2026-10-12T18:00")).toBe("Monday 12 October 2026 · 6:00 PM");
    expect(eventLine("2026-10-12T09:05")).toBe("Monday 12 October 2026 · 9:05 AM");
    expect(eventLine("2026-10-12")).toBe("Monday 12 October 2026");
    expect(eventLine(null)).toBeNull();
    expect(eventLine("2026-02-31T10:00")).toBeNull();
    const cover = renderPlan(deckSlides(closeCtx({ scheduledAt: "2026-10-12T18:00" }), kit))[0];
    expect(cover.boxes.find((b) => b.role === "cover-date")?.text).toBe("Monday 12 October 2026 · 6:00 PM");
    expect(renderPlan(deckSlides(closeCtx(), kit))[0].boxes.some((b) => b.role === "cover-date")).toBe(false);
  });
  it("the deck ends on the call to action and a Q&A slide that keeps it on screen, from the record", () => {
    const d = deckSlides(closeCtx(), kit);
    const [cta, qa] = d.slides.slice(-2);
    expect(cta).toMatchObject({ kind: "close", headline: "Book a call", body: ["DM me the word PLAN"], inverse: true, footer: null });
    expect(qa).toMatchObject({ kind: "close", headline: "Your questions", footer: "DM me the word PLAN" });
    // With no CTA line on the offer, the Q&A slide keeps the Foundation's call to action on screen instead.
    const bare = deckSlides(resolveSections({ webinar: { title: "t", ctaType: "Apply" }, presenter: "L", sections: base(), beliefs: [], proofs, assets, essenceStories: [], citable, offer }), kit);
    expect(bare.slides.at(-1)).toMatchObject({ headline: "Your questions", footer: "Apply" });
    expect(bare.slides.at(-2)).toMatchObject({ headline: "Apply", body: [] });
  });
  it("the CTA sits on the offer and Q&A slides only; with the CTA bar on, the bar replaces the footer's line, never both", () => {
    const d = deckSlides(closeCtx(), kit);
    const withCta = d.slides.filter((s) => s.footer === "DM me the word PLAN").map((s) => s.kind === "close" ? "close" : s.sectionKey);
    expect(new Set(withCta)).toEqual(new Set(["offer_stack_cta", "q_a_close", "close"]));
    const barred = deckSlides(closeCtx({ ctaBar: true }), kit);
    for (const p of renderPlan(barred)) {
      const footer = p.boxes.find((b) => b.role === "footer");
      expect(Boolean(footer && footer.text === "DM me the word PLAN" && p.ctaBar)).toBe(false);
    }
    expect(renderPlan(barred).filter((p) => p.ctaBar === "DM me the word PLAN").length).toBe(withCta.length);
    expect(renderPlan(d).every((p) => !p.ctaBar)).toBe(true);
  });
  it("the price slide: \"Get started today\", the price huge, the total struck through, the saving small; a stack item shows its own value", () => {
    const priced = { offer: { ...offer.offer, ctaFooter: null }, components: [{ name: "The program", type: "core", oneLiner: "12 weeks", perceivedValue: 2000, beliefBreak: "vehicle" }, { name: "Templates", type: "bonus", oneLiner: "You pick.", perceivedValue: 744, beliefBreak: "internal" }] };
    const d = deckSlides(resolveSections({ webinar: { title: "t" }, presenter: "L", sections: base(), beliefs: [], proofs, assets, essenceStories: [], citable, offer: priced }), kit);
    const plans = renderPlan(d);
    const price = plans.find((p) => p.boxes.some((b) => b.role === "figure" && b.text === "NZD $1,997"))!;
    expect(price.layout).toBe("figure");
    expect(price.boxes.find((b) => b.role === "headline")?.text).toBe("Get started today");
    expect(price.boxes.find((b) => b.role === "struck")).toMatchObject({ text: "Total value NZD $2,744", strike: true });
    expect(price.boxes.find((b) => b.role === "figure")!.size).toBeGreaterThanOrEqual(80);
    expect(price.boxes.find((b) => b.role === "small")?.text).toBe("You save NZD $747");
    expect(price.boxes.some((b) => b.text.includes("The 90-Minute Diagnostic"))).toBe(false);
    const item = plans.find((p) => p.boxes.some((b) => b.role === "figure" && b.text === "NZD $744 value"))!;
    expect(item.boxes.find((b) => b.role === "small")?.text).toBe("Total value so far: NZD $2,744");
    expect(outlineText("t", d)).toContain("Total value NZD $2,744 (struck through)");
  });
});

describe("deck layouts 16: the two round-1 defects", () => {
  it("a key point that repeats an opening line or an origin beat is said once, and named", () => {
    expect(echoes("Drop an emoji in the chat if you're here!", "drop an emoji in the chat if you're here")).toBe(true);
    expect(echoes("I was working 70-hour weeks in a job I hated", "By 2019 I was working 70-hour weeks in a job I hated.")).toBe(true);
    expect(echoes("Say hi", "Say hi in the chat")).toBe(false);
    const c = resolveSections({
      webinar: { title: "t", chatPrompt: "Drop an emoji in the chat if you're here!", originStory: { wall: "By 2019 I was working 70-hour weeks in a job I hated." } },
      presenter: "L",
      sections: base({ hook: { keyPoints: "Drop an emoji in the chat if you're here!\nMost people quit in week three." }, credibility_origin: { keyPoints: "I was working 70-hour weeks in a job I hated\nThen I found the method." } }),
      beliefs: [], proofs, assets, essenceStories: [], citable, offer,
    });
    const d = deckSlides(c, kit);
    const faces = d.slides.map((sl) => sl.headline);
    expect(faces.filter((h) => /Drop an emoji/.test(h))).toHaveLength(1);
    expect(faces.filter((h) => /70-hour weeks/.test(h))).toHaveLength(1);
    expect(faces).toContain("Most people quit in week three.");
    expect(d.echoes.map((e) => e.sameAs)).toEqual(["the chat prompt", expect.stringMatching(/^the origin story's .* beat$/)]);
  });
  it("without an origin section, a key point that tells the story stays: it is the only telling", () => {
    const c = resolveSections({ webinar: { title: "t", originStory: { wall: "By 2019 I was working 70-hour weeks in a job I hated." } }, presenter: "L", sections: base({ hook: { keyPoints: "By 2019 I was working 70-hour weeks in a job I hated." }, credibility_origin: { status: "omitted" } }), beliefs: [], proofs, assets, essenceStories: [], citable, offer });
    expect(deckSlides(c, kit).echoes).toEqual([]);
  });
  it("a quote that starts mid-sentence takes the person's first name; one with a capital stands as stored", () => {
    expect(quoteWithSubject("ran a five-day challenge and booked 9 calls", "Terri M.")).toBe("Terri ran a five-day challenge and booked 9 calls");
    expect(quoteWithSubject("…ran a five-day challenge", "— Terri")).toBe("Terri ran a five-day challenge");
    expect(quoteWithSubject("I ran a five-day challenge", "Terri")).toBe("I ran a five-day challenge");
    expect(quoteWithSubject("ran it", "")).toBe("ran it");
  });
});

describe("deck layouts 1, 3 and 11, in the plan", () => {
  const planOf = (keyPoints: string, extra: Record<string, unknown> = {}) => {
    const c = resolveSections({ webinar: { title: "t", ...extra }, presenter: "L", sections: base({ problem_frame: { keyPoints } }), beliefs: [], proofs, assets, essenceStories: [], citable, offer });
    const d = deckSlides(c, kit);
    return { d, plans: renderPlan(d) };
  };
  it("a key point with one figure is a big number: the figure huge, its label under it", () => {
    const { d, plans } = planOf("602 comments on my post in 48 hours");
    const sl = d.slides.find((s) => s.headline.startsWith("602 comments"))!;
    const p = plans.find((x) => x.n === sl.n)!;
    expect(p.layout).toBe("bignum");
    expect(p.boxes.find((b) => b.role === "figure")).toMatchObject({ text: "602" });
    expect(p.boxes.find((b) => b.role === "figure")!.size).toBeGreaterThanOrEqual(72);
    expect(p.boxes.find((b) => b.role === "small")?.text).toBe("comments on my post in 48 hours");
  });
  it("two figures make a row at one size, each in its own column, inside the slide", () => {
    const { d, plans } = planOf("1,838 sent, 98.2% opened");
    const p = plans.find((x) => x.n === d.slides.find((s) => s.headline.startsWith("1,838"))!.n)!;
    const figs = p.boxes.filter((b) => b.role === "figure");
    expect(figs.map((b) => [b.text, b.col])).toEqual([["1,838", 0], ["98.2%", 1]]);
    expect(new Set(figs.map((b) => b.size)).size).toBe(1);
    const g = slideGeometry(p);
    for (const b of p.boxes) {
      const at = boxAt(g, b);
      if (at) expect(at.x + at.w).toBeLessThanOrEqual(10);
    }
  });
  it("a belief divider with its From line is From → To: the old belief small, a short accent rule, the new belief large", () => {
    const c = ctx(base(), [{ type: "vehicle", fromBelief: "I need more followers", toBelief: "I need more conversations", proofId: null, storyAssetId: null }]);
    const d = deckSlides(c, kit);
    const div = d.slides.find((s) => s.kind === "divider")!;
    const p = renderPlan(d).find((x) => x.n === div.n)!;
    expect(p.layout).toBe("shift");
    expect(p.boxes.find((b) => b.role === "small")?.text).toBe("I need more followers");
    expect(p.boxes.find((b) => b.role === "headline")?.text).toBe("I need more conversations");
    expect(slideGeometry(p).rules.w).toBeLessThan(3);
  });
});

describe("deck layouts 5: the offer, argued visually", () => {
  const stacked = (components: { name: string; type: string; oneLiner?: string; perceivedValue: number; beliefBreak: string }[], guarantee: string | null = "Your money back in 30 days if you did the work and it didn't help.") => {
    const d = deckSlides(resolveSections({ webinar: { title: "t" }, presenter: "L", sections: base(), beliefs: [], proofs, assets, essenceStories: [], citable, offer: { offer: { ...offer.offer, guarantee }, components } }), kit);
    return { d, plans: renderPlan(d) };
  };
  const three = [
    { name: "The program", type: "core", oneLiner: "12 weeks, one step a week", perceivedValue: 2000, beliefBreak: "vehicle" },
    { name: "Weekly calls", type: "core", oneLiner: "Live, every Tuesday", perceivedValue: 1000, beliefBreak: "vehicle" },
    { name: "Templates", type: "bonus", oneLiner: "You pick.", perceivedValue: 744, beliefBreak: "internal" },
  ];
  const inside = (p: ReturnType<typeof renderPlan>[number]) => {
    const g = slideGeometry(p);
    for (const b of p.boxes) {
      const at = boxAt(g, b);
      expect(at, `${b.role} has a place`).not.toBeNull();
      expect(at!.x).toBeGreaterThanOrEqual(0);
      expect(at!.x + at!.w).toBeLessThanOrEqual(10);
      expect(at!.y + at!.h).toBeLessThanOrEqual(5.625);
    }
  };
  it("the build: each core item adds its row, the earlier rows muted, the new row large in ink, the running total under the table", () => {
    const { d, plans } = stacked(three);
    const builds = plans.filter((p) => p.layout === "stack" && !p.boxes.some((b) => b.role === "headline"));
    expect(builds).toHaveLength(2);
    const second = builds[1];
    expect(second.boxes.filter((b) => b.role === "row-name").map((b) => [b.text, b.col, b.color])).toEqual([["The program", 0, "4B5563"], ["Weekly calls", 1, "6E6256"]]);
    const [first, last] = second.boxes.filter((b) => b.role === "row-name");
    expect(last.size).toBeGreaterThan(first.size);
    expect(last.bold).toBe(true);
    expect(second.boxes.filter((b) => b.role === "row-value").map((b) => b.text)).toEqual(["NZD $2,000", "NZD $1,000"]);
    expect(second.boxes.find((b) => b.role === "body")?.text).toBe("Live, every Tuesday");
    expect(second.boxes.find((b) => b.role === "source")?.text).toBe("Total value so far: NZD $3,000");
    // The value column is set right, the row's check sits left of its name; every box inside the slide.
    const g = slideGeometry(second);
    expect(boxAt(g, { role: "row-value", col: 1 })!.align).toBe("right");
    expect(boxAt(g, { role: "row-check", col: 1 })!.x).toBeLessThan(boxAt(g, { role: "row-name", col: 1 })!.x);
    for (const p of builds) inside(p);
    // The accent draws the rule only, never a letter.
    for (const b of second.boxes) expect(b.color).not.toBe("DD2727");
    expect(outlineText("t", d)).toContain("✓ Weekly calls · NZD $1,000");
  });
  it("the bonus is its own slide, its value large; the summary lists every item and strikes the total through to the price", () => {
    const { plans } = stacked(three);
    const bonus = plans.find((p) => p.boxes.some((b) => b.role === "figure" && b.text === "NZD $744 value"))!;
    expect(bonus.layout).toBe("figure");
    expect(bonus.boxes.find((b) => b.role === "headline")?.text).toBe("Templates");
    const summary = plans.find((p) => p.layout === "stack" && p.boxes.some((b) => b.role === "headline"))!;
    expect(summary.boxes.find((b) => b.role === "headline")?.text).toBe("Everything you get");
    expect(summary.boxes.filter((b) => b.role === "row-name").map((b) => b.text)).toEqual(["The program", "Weekly calls", "Templates"]);
    expect(new Set(summary.boxes.filter((b) => b.role === "row-name").map((b) => `${b.size}:${b.color}`)).size).toBe(1);
    expect(summary.boxes.find((b) => b.role === "struck")).toMatchObject({ text: "Total value NZD $3,744", strike: true, color: "4B5563" });
    expect(summary.boxes.find((b) => b.role === "figure")).toMatchObject({ text: "→ NZD $1,997", bold: true, color: "6E6256" });
    inside(summary);
    // Eight items still fit: the rows share the table's height.
    const many = stacked(Array.from({ length: 8 }, (_, i) => ({ name: `Module ${i + 1}: the long name of a module`, type: "core", perceivedValue: 100, beliefBreak: "vehicle" })));
    const big = many.plans.find((p) => p.layout === "stack" && p.boxes.some((b) => b.role === "headline"))!;
    inside(big);
    const rows = big.boxes.filter((b) => b.role === "row-name").map((b) => boxAt(slideGeometry(big), b)!);
    for (let i = 1; i < rows.length; i++) expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].h - 1e-9);
    expect(rows.at(-1)!.y + rows.at(-1)!.h).toBeLessThanOrEqual(slideGeometry(big).boxes.struck!.y);
  });
  it("the guarantee has its own slide: the words large beside a seal drawn in the accent", () => {
    const { plans } = stacked(three);
    const g = plans.find((p) => p.layout === "guarantee")!;
    expect(g.boxes.find((b) => b.role === "headline")).toMatchObject({ text: "Your money back in 30 days if you did the work and it didn't help.", color: "6E6256" });
    expect(g.boxes.find((b) => b.role === "headline")!.size).toBeGreaterThanOrEqual(28);
    expect(g.panels?.map((p) => [p.color, p.ring])).toEqual([["DD2727", 6], ["DD2727", 1.5]]);
    const at = boxAt(slideGeometry(g), { role: "headline" })!;
    for (const p of g.panels!) expect(p.frame.x + p.frame.w).toBeLessThan(at.x);
    inside(g);
    // No guarantee on the offer: no seal anywhere.
    expect(stacked(three, null).plans.some((p) => p.layout === "guarantee")).toBe(false);
  });
});
