import { describe, expect, it } from "vitest";
import { SECTION_TEMPLATES, applyOverride, derivedGrades } from "../webinar";
import { QA_SECTION_KEY, placeholdersIn, resolveSections, runSheetText, unreviewedSections } from "../webinar-context";
import { UNREVIEWED_LABEL, unreviewedCountLine } from "../provenance";

const sections = SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, order: t.order, name: t.name, status: "drafted", keyPoints: t.order === 1 ? "• Open the loop\n• Promise [X]% fewer no-shows" : null, script: t.order === 1 ? "Hi. If you've ever lost 10 pounds and gained it back, this is for you." : null, transitionIn: t.order === 3 ? "Let's name the enemy." : null, transitionOut: null, deliveryNote: t.order === 1 ? "Wait for the chat to fill." : null, assetId: t.order === 3 ? "a1" : null, durationMin: t.durationMin }));
const proofs = [{ id: "p1", who: "Kate A.", name: "Kate A.: identity", longVersion: "I now see identity as the foundation.", status: "approved" }, { id: "p2", who: "Gary C.", name: "Gary", longVersion: "tools", status: "draft" }];
const assets = [
  { id: "a1", type: "analogy", name: "Leaky bucket", body: "A bucket with holes." },
  { id: "s1", type: "story", name: "Chasing the symptom", body: "She fixed the wrong thing.", useWhen: "When they blame the tool", extra: { moral: "Name the drift." } },
  { id: "o1", type: "objection", name: "I've tried this before", body: "None of them worked.", reframe: "The right teacher.\nSecond line.", proof: null },
];
const citable = [{ id: "e1", source: "own" as const, claim: "Impostor phenomenon is common among high achievers.", authors: "Bravata et al.", year: 2019, title: "Prevalence of Impostor Syndrome", doi: "10.1/x" }, { id: "sh1", source: "shared" as const, claim: "Shared claim.", authors: "Someone", year: 2020, title: "A shared study", url: "https://doi.org/10.2/y" }];
const beliefs = [
  { type: "vehicle", fromBelief: "from", toBelief: "to", proofId: "p1", storyAssetId: "s1", evidenceId: "e1" },
  { type: "internal", fromBelief: "from", toBelief: "to", proofId: "p2", proof: "Priya N.: 2 to 9 calls", proofWho: "Priya N.", proofChangedAt: "2026-09-01T00:00:00.000Z", proofPermissionAt: "2026-09-02T00:00:00.000Z", storyAssetId: "essence:0", evidenceId: "shared:sh1" },
  { type: "external", fromBelief: "from", toBelief: "to", storyAssetId: "gone", evidenceId: "missing" },
];
const offer = { offer: { name: "The 90-Minute Diagnostic", price: 1997, currency: "NZD", container: "1:1 coaching", guarantee: null, objectionAssetIds: ["o1", "nope"] }, components: [{ name: "Diagnostic", type: "core", oneLiner: "90 minutes, 1:1", perceivedValue: 0, beliefBreak: "vehicle" }] };
const ctx = () => resolveSections({ webinar: { title: "Your Edge, Uncovered" }, presenter: "Lindsey Brittain", sections, beliefs, proofs, assets, essenceStories: [{ name: "The Glue", summary: "She held it together.", when_to_use: "Act 2" }], citable, offer });

describe("the resolver: everything wired to each section, in running order, with the clock", () => {
  it("runs a cumulative clock and groups sections into acts", () => {
    const c = ctx();
    expect(c.totalMin).toBe(76);
    expect(c.sections[0]).toMatchObject({ order: 1, start: "0:00", end: "0:03", startMin: 0, endMin: 3 });
    expect(c.sections[2].start).toBe("0:07");
    expect(c.acts.map((a) => [a.key, a.startMin, a.endMin])).toEqual([["opening", 0, 7], ["vehicle", 7, 29], ["internal", 29, 44], ["external", 44, 58], ["closing", 58, 76]]);
    expect(c.acts[1].label).toBe("Act 1 · Vehicle");
    expect(c.presenter).toBe("Lindsey Brittain");
  });
  it("resolves the proof, story and citation wired to an act, as the bank stores them; a draft proof, a removed story or a deleted study is null", () => {
    const c = ctx();
    const act1 = c.sections.find((s) => s.act === "vehicle")!;
    expect(act1.proof).toEqual({ id: "p1", who: "Kate A.", quote: "I now see identity as the foundation.", source: "bank", texts: ["I now see identity as the foundation."] });
    expect(act1.story).toMatchObject({ name: "Chasing the symptom", moral: "Name the drift.", source: "bank" });
    expect(act1.evidence).toEqual({ id: "e1", claim: "Impostor phenomenon is common among high achievers.", citation: "Bravata et al. (2019). Prevalence of Impostor Syndrome. https://doi.org/10.1/x" });
    const act2 = c.sections.find((s) => s.act === "internal")!;
    // The picked proof is a draft, so the typed one with its tick stands in; the story is the Essence's own; the study is the shared shelf's
    expect(act2.proof).toEqual({ id: "typed", who: "Priya N.", quote: "Priya N.: 2 to 9 calls", source: "typed", texts: ["Priya N.: 2 to 9 calls"] });
    expect(act2.story).toMatchObject({ name: "The Glue", source: "essence" });
    expect(act2.evidence?.claim).toBe("Shared claim.");
    const act3 = c.sections.find((s) => s.act === "external")!;
    expect(act3.proof).toBeNull();
    expect(act3.story).toBeNull();
    expect(act3.evidence).toBeNull();
  });
  it("puts the offer on the closing frame only and the objections it answers under Q&A only; a missing objection id is skipped", () => {
    const c = ctx();
    expect(c.sections.filter((s) => s.offer).map((s) => s.act)).toEqual(["closing", "closing", "closing"]);
    const qa = c.sections.find((s) => s.sectionKey === QA_SECTION_KEY)!;
    expect(qa.objections.map((o) => o.name)).toEqual(["I've tried this before"]);
    expect(c.sections.find((s) => s.act === "vehicle")!.objections).toEqual([]);
  });
  it("reports placeholders per section and never fills them; carries the delivery note and the section's own asset", () => {
    const c = ctx();
    expect(placeholdersIn("[X]% of leads and [SALES PAGE URL] twice [SALES PAGE URL]")).toEqual(["[X]%", "[SALES PAGE URL]"]);
    expect(c.placeholders).toEqual([{ section: "Hook", tokens: ["[X]%"] }]);
    expect(c.sections[0].deliveryNote).toBe("Wait for the chat to fill.");
    expect(c.sections[2].asset).toEqual({ type: "analogy", name: "Leaky bucket", body: "A bucket with holes." });
    expect(c.sections[2].transitionIn).toBe("Let's name the enemy.");
  });
  it("the plain-text run sheet carries the clock, the wiring and the unfilled slots, and says which proof is approved", () => {
    const text = runSheetText(ctx());
    expect(text).toContain("ACT 1 · VEHICLE  22 min · 0:07 → 0:29");
    expect(text).toContain("1 · HOOK  3 min · 0:00");
    expect(text).toContain('PROOF     Kate A.: "I now see identity as the foundation." [approved]');
    expect(text).toContain("[typed, permission ticked]");
    expect(text).toContain("DELIVERY  Wait for the chat to fill.");
    expect(text).toContain("UNFILLED  [X]%");
    expect(text).toContain("OBJECTIONS\n    · I've tried this before — The right teacher.");
    expect(text).toContain("OFFER     The 90-Minute Diagnostic · NZD $1,997 · Diagnostic");
  });
});

describe("the run sheet marks a script nobody has read, and counts them at the top", () => {
  it("an unreviewed section is marked, the count names it in running order, and a reviewed one is not", () => {
    const marked = sections.map((s) => ({ ...s, script: s.script ?? "A draft.", origin: s.order === 2 ? "ai_unreviewed" : s.order === 5 ? "ai_unreviewed" : s.order === 3 ? "edited" : "coach" }));
    const c = resolveSections({ webinar: { title: "T" }, presenter: "P", sections: marked, beliefs, proofs, assets, essenceStories: [], citable, offer });
    const all = c.acts.flatMap((a) => a.sections);
    expect(all.filter((s) => s.unreviewed).map((s) => s.order)).toEqual([2, 5]);
    expect(unreviewedSections(c)).toEqual([marked[1].name, marked[4].name]);
    const text = runSheetText(c);
    expect(text.split("\n")[2]).toBe(`2 AI drafts, not reviewed: ${marked[1].name}, ${marked[4].name}`);
    expect(unreviewedCountLine([marked[1].name])).toBe(`1 AI draft, not reviewed: ${marked[1].name}`);
    expect(text.match(/\[AI draft, not reviewed\]/g)).toHaveLength(2);
    // Nothing marked: no count line, no marker.
    const clean = runSheetText(ctx());
    expect(clean).not.toContain(UNREVIEWED_LABEL);
  });
});

describe("the three derived grades: a count is a grade, with its working; lowered with a reason, never raised", () => {
  it("maps presence per act and the offer's state onto the 1 to 5 scale", () => {
    const g = derivedGrades({ proofs: 3, stories: 1, offer: { linked: true, components: 2, mapped: 1, price: 1997 } });
    expect(g).toEqual([
      { key: "proof", value: 5, working: "3 of 3 acts have a proof." },
      { key: "stories", value: 2, working: "1 of 3 acts have a story." },
      { key: "offer", value: 3, working: "Offer linked; 1 of 2 components not tied to a belief break." },
    ]);
    expect(derivedGrades({ proofs: 0, stories: 2, offer: { linked: false, components: 0, mapped: 0, price: 0 } }).map((x) => x.value)).toEqual([1, 3, 1]);
    expect(derivedGrades({ proofs: 0, stories: 0, offer: { linked: true, components: 2, mapped: 2, price: 0 } })[2]).toEqual({ key: "offer", value: 3, working: "Offer linked and mapped; no price set." });
    expect(derivedGrades({ proofs: 0, stories: 0, offer: { linked: true, components: 2, mapped: 2, price: 5 } })[2].value).toBe(5);
  });
  it("an override lowers with a reason; without one, or upward, the record's grade stands", () => {
    const g = { key: "proof" as const, value: 5, working: "" };
    expect(applyOverride(g, { value: 3, reason: "Two of them are thin." })).toBe(3);
    expect(applyOverride(g, { value: 3, reason: "  " })).toBe(5);
    expect(applyOverride({ ...g, value: 2 }, { value: 5, reason: "I like them." })).toBe(2);
    expect(applyOverride(g, undefined)).toBe(5);
  });
});
