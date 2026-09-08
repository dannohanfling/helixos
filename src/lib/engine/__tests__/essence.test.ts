import { describe, expect, it } from "vitest";
import { ESSENCE_CAP, ESSENCE_PLACEHOLDERS, ESSENCE_SECTIONS, assembleSystem, completion, essenceChars, normalizeEssence, placeholderFor, serializeEssence } from "../essence";

describe("the Essence schema", () => {
  it("has the thirteen production sections plus representative_stories, in order", () => {
    expect(ESSENCE_SECTIONS.map((s) => s.key)).toEqual(["guidelines_to_respond", "identity", "mission_and_vision", "goals_and_objectives", "behavior_and_interaction_style", "knowledge_and_expertise", "cultural_and_philosophical_alignment", "communication_guidelines", "emotional_intelligence", "systems_and_methodology", "brand_and_differentiation", "key_outcomes_for_users", "ethical_standards", "representative_stories"]);
    expect(ESSENCE_SECTIONS.find((s) => s.key === "guidelines_to_respond")?.fields.map((f) => f.key)).toEqual(["response_length", "tone", "style", "user_reference", "prohibited_actions", "role_and_focus"]);
    expect(ESSENCE_CAP).toBe(20000);
  });
  it("keeps only known fields in their declared shapes and drops empties, adding nothing", () => {
    const d = normalizeEssence({ identity: { name: "  Maya ", role: "", core_traits: "direct\n\nwarm\n", made_up: "x" }, nope: { a: 1 }, representative_stories: { stories: [{ name: "Sarah", summary: "", when_to_use: "" }, { name: "", summary: "", when_to_use: "" }] } });
    expect(d).toEqual({ identity: { name: "Maya", core_traits: ["direct", "warm"] }, representative_stories: { stories: [{ name: "Sarah", summary: "", when_to_use: "" }] } });
  });
  it("counts sections filled and knows when it is empty", () => {
    expect(completion({})).toEqual({ filled: 0, total: 14, empty: true });
    expect(completion(normalizeEssence({ identity: { name: "Maya" }, ethical_standards: { transparency: "Always." } })).filled).toBe(2);
  });
  it("serialises compact JSON of what is filled, or null", () => {
    expect(serializeEssence({})).toBeNull();
    const s = serializeEssence(normalizeEssence({ identity: { name: "Maya" } }))!;
    expect(JSON.parse(s)).toEqual({ identity: { name: "Maya" } });
    expect(essenceChars(normalizeEssence({ identity: { name: "Maya" } }))).toBe(s.length);
  });
  it("carries representative_stories in the production shape, a bare array, and reads that shape back", () => {
    const story = { name: "Sarah", summary: "Down 11 by week 6.", when_to_use: "Vehicle belief" };
    const s = serializeEssence(normalizeEssence({ representative_stories: { stories: [story] } }))!;
    expect(JSON.parse(s)).toEqual({ representative_stories: [story] });
    expect(normalizeEssence(JSON.parse(s))).toEqual({ representative_stories: { stories: [story] } });
  });
});

describe("placeholders are illustrations, never values", () => {
  it("has one for every field, in five voices that never enter the Essence", () => {
    for (const s of ESSENCE_SECTIONS) for (const f of s.fields) expect(ESSENCE_PLACEHOLDERS[`${s.key}.${f.key}`], `${s.key}.${f.key}`).toBeTruthy();
    expect(placeholderFor("identity", "core_traits", "list")).toBe("Patient\nAllergic to buzzwords\nI ask before I advise");
    expect(serializeEssence(normalizeEssence({ identity: { name: "", core_traits: "" } }))).toBeNull();
  });
});

describe("one way to build a system message", () => {
  it("presents inspirations as attribution, never as a voice to imitate", () => {
    const { blocks } = assembleSystem('{"cultural_and_philosophical_alignment":{"inspirations":["Miller and Rollnick"]}}', "Write.");
    expect(blocks[0].text).toMatch(/who to credit/);
    expect(blocks[0].text).toMatch(/never a voice to imitate/);
    expect(assembleSystem('{"identity":{"name":"Maya"}}', "Write.").blocks[0].text).not.toMatch(/credit/);
  });
  it("puts the voice first and marks it for caching, then the task", () => {
    const { blocks, text } = assembleSystem('{"identity":{"name":"Maya"}}', "Write the post.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cached).toBe(true);
    expect(blocks[0].text).toContain('{"identity":{"name":"Maya"}}');
    expect(blocks[1]).toEqual({ text: "Write the post.", cached: false });
    expect(text.indexOf("Maya")).toBeLessThan(text.indexOf("Write the post."));
  });
  it("runs the task alone when the Essence is empty, inventing no voice", () => {
    const { blocks, text } = assembleSystem(null, "Write the post.");
    expect(blocks).toEqual([{ text: "Write the post.", cached: false }]);
    expect(text).toBe("Write the post.");
    expect(text).not.toMatch(/voice|tone/i);
  });
});
