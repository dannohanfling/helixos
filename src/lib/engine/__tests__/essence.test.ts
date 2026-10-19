import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isErrorAnswer } from "../done-label";
import { refusalIn } from "@/lib/form-keep";
import { BRAND_CAP, ESSENCE_CAP, ESSENCE_PLACEHOLDERS, ESSENCE_SECTIONS, assembleSystem, brandChars, brandFieldSizes, brandOver, completion, coreChars, essenceChars, essenceForAi, essenceOver, essenceOverAddress, essenceSaveRefusal, normalizeEssence, placeholderFor, sectionSizes, serializeEssence } from "../essence";
import { UK_NZ_LINE, parseSpelling, spellingLine } from "../spelling";

describe("the Essence schema", () => {
  it("has the thirteen production sections plus representative_stories, in order", () => {
    expect(ESSENCE_SECTIONS.map((s) => s.key)).toEqual(["guidelines_to_respond", "identity", "mission_and_vision", "goals_and_objectives", "behavior_and_interaction_style", "knowledge_and_expertise", "cultural_and_philosophical_alignment", "communication_guidelines", "emotional_intelligence", "systems_and_methodology", "brand_and_differentiation", "brand", "key_outcomes_for_users", "ethical_standards", "representative_stories"]);
    expect(ESSENCE_SECTIONS.find((s) => s.key === "guidelines_to_respond")?.fields.map((f) => f.key)).toEqual(["response_length", "tone", "style", "user_reference", "prohibited_actions", "role_and_focus", "house_rules"]);
    expect(ESSENCE_CAP).toBe(20000);
  });
  it("keeps only known fields in their declared shapes and drops empties, adding nothing", () => {
    const d = normalizeEssence({ identity: { name: "  Maya ", role: "", core_traits: "direct\n\nwarm\n", made_up: "x" }, nope: { a: 1 }, representative_stories: { stories: [{ name: "Sarah", summary: "", when_to_use: "" }, { name: "", summary: "", when_to_use: "" }] } });
    expect(d).toEqual({ identity: { name: "Maya", core_traits: ["direct", "warm"] }, representative_stories: { stories: [{ name: "Sarah", summary: "", when_to_use: "" }] } });
  });
  it("counts sections filled and knows when it is empty", () => {
    expect(completion({})).toEqual({ filled: 0, total: 14, empty: true });
    expect(completion(normalizeEssence({ identity: { name: "Maya" }, ethical_standards: { transparency: "Always." } })).filled).toBe(2);
    // Brand is optional: it counts only once it holds something, so adding it lowered no one's progress.
    expect(completion(normalizeEssence({ brand: { tagline: "Lead from the inside out." } }))).toEqual({ filled: 1, total: 15, empty: false });
  });
  it("over the cap: how far over, and each section's size largest first, so it can be trimmed to fit (28 Sep)", () => {
    const under = normalizeEssence({ identity: { name: "Maya" } });
    expect(essenceOver(under)).toBe(0);
    const big = normalizeEssence({ identity: { name: "Maya" }, ethical_standards: { transparency: "x".repeat(ESSENCE_CAP) }, mission_and_vision: { mission_statement: "y".repeat(300) }, brand: { tagline: "Lead lighter." } });
    expect(essenceOver(big)).toBe(coreChars(big) - ESSENCE_CAP);
    const sizes = sectionSizes(big);
    // The core's sections only: Brand has its own budget and its own trim list (H-811).
    expect(sizes.map((x) => x.key)).toEqual(["ethical_standards", "mission_and_vision", "identity"]);
    expect(sizes[0].chars).toBe(essenceChars(normalizeEssence({ ethical_standards: big.ethical_standards })));
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

describe("Brand has its own budget (H-811)", () => {
  const core = { identity: { name: "Maya" }, mission_and_vision: { mission_statement: "Energy back without giving up Saturday." } };
  it("counts the core without Brand, and Brand on its own", () => {
    expect(BRAND_CAP).toBe(20000);
    const d = normalizeEssence({ ...core, brand: { tagline: "Lead lighter.", values: ["Calm", "Clear"] } });
    expect(coreChars(d)).toBe(essenceChars(normalizeEssence(core)));
    expect(brandChars(d)).toBe(essenceChars(normalizeEssence({ brand: d.brand })));
    expect(brandChars(normalizeEssence(core))).toBe(0);
  });
  it("a long Brand never pushes the core out: the core stays under its cap with Brand at 19,000", () => {
    const d = normalizeEssence({ ...core, brand: { notes: "b".repeat(19000) } });
    expect(essenceChars(d)).toBeGreaterThan(ESSENCE_CAP - 2000);
    expect(essenceOver(d)).toBe(0);
    expect(brandOver(d)).toBe(0);
    expect(JSON.parse(essenceForAi(d)!).brand.notes).toHaveLength(19000);
  });
  it("Brand over its budget: the core still goes to the AI, Brand alone is left out, and nothing is cut from the data", () => {
    const d = normalizeEssence({ ...core, brand: { notes: "b".repeat(BRAND_CAP + 10) } });
    expect(brandOver(d)).toBe(brandChars(d) - BRAND_CAP);
    expect(essenceOver(d)).toBe(0);
    const sent = JSON.parse(essenceForAi(d)!);
    expect(sent).toEqual(normalizeEssence(core));
    expect(sent.brand).toBeUndefined();
    expect(JSON.parse(serializeEssence(d)!).brand).toBeUndefined();
    expect((d.brand.notes as string).length).toBe(BRAND_CAP + 10);
    expect(brandFieldSizes(d).map((f) => f.key)).toEqual(["notes"]);
  });
  it("the core over its cap: the whole Essence is left out, as before, whatever Brand holds", () => {
    const d = normalizeEssence({ ...core, ethical_standards: { transparency: "x".repeat(ESSENCE_CAP) }, brand: { tagline: "Lead lighter." } });
    expect(essenceOver(d)).toBeGreaterThan(0);
    expect(essenceForAi(d)).toBeNull();
    expect(essenceForAi({})).toBeNull();
  });
  it("brandFieldSizes lists Brand's filled fields, largest first", () => {
    const d = normalizeEssence({ brand: { tagline: "Short.", notes: "n".repeat(200), values: ["Calm first", "Clear always"] } });
    expect(brandFieldSizes(d).map((f) => f.key)).toEqual(["notes", "values", "tagline"]);
    expect(brandFieldSizes(d)[0]).toMatchObject({ label: "Notes", chars: JSON.stringify({ notes: "n".repeat(200) }).length });
  });
  it("a save is refused only when it grows the core past its cap, or Brand past its own, each named", () => {
    const small = normalizeEssence(core);
    const coreBig = normalizeEssence({ ...core, ethical_standards: { transparency: "x".repeat(ESSENCE_CAP) } });
    expect(essenceSaveRefusal(small, coreBig)).toEqual({ error: "over", chars: coreChars(coreBig) });
    const brandBig = normalizeEssence({ ...core, brand: { notes: "b".repeat(BRAND_CAP) } });
    expect(essenceSaveRefusal(small, brandBig)).toEqual({ error: "brandover", chars: brandChars(brandBig) });
    // A big Brand never refuses a core save, and the reverse.
    const brandFull = normalizeEssence({ ...core, brand: { notes: "b".repeat(19500) } });
    const coreNear = normalizeEssence({ ...core, brand: { notes: "b".repeat(19500) }, ethical_standards: { transparency: "x".repeat(15000) } });
    expect(essenceSaveRefusal(brandFull, coreNear)).toBeNull();
    // Already over: a save that trims (or leaves it the same) always goes through.
    const brandTrimmed = normalizeEssence({ ...core, brand: { notes: "b".repeat(BRAND_CAP - 5) } });
    expect(essenceSaveRefusal(brandBig, brandTrimmed)).toBeNull();
    expect(essenceSaveRefusal(coreBig, coreBig)).toBeNull();
    // The core is checked first when a save grows both.
    const both = normalizeEssence({ ...coreBig, brand: { notes: "b".repeat(BRAND_CAP) } });
    expect(essenceSaveRefusal(small, both)?.error).toBe("over");
  });
});

describe("British and New Zealand spelling (H-811)", () => {
  it("reads only uk_nz as British; anything else is American", () => {
    expect(parseSpelling("uk_nz")).toBe("uk_nz");
    for (const v of ["us", "", null, undefined, "UK", "en-GB"]) expect(parseSpelling(v)).toBe("us");
    expect(spellingLine("us")).toBeNull();
    expect(spellingLine(null)).toBeNull();
    expect(spellingLine("uk_nz")).toBe("Write in British and New Zealand English spelling (colour, organise, programme).");
  });
  it("closes the task block with one line, with or without an Essence, and leaves the cached voice untouched", () => {
    const withVoice = assembleSystem('{"identity":{"name":"Maya"}}', "Write the post.", { spelling: "uk_nz" });
    const plain = assembleSystem('{"identity":{"name":"Maya"}}', "Write the post.");
    expect(withVoice.blocks[0]).toEqual(plain.blocks[0]);
    expect(withVoice.blocks[1]).toEqual({ text: `Write the post.\n\n${UK_NZ_LINE}`, cached: false });
    // essence: false calls (HumanOS, the avatar interview) carry it too.
    expect(assembleSystem(null, "Log the meal.", { spelling: "uk_nz" }).blocks).toEqual([{ text: `Log the meal.\n\n${UK_NZ_LINE}`, cached: false }]);
    expect(assembleSystem(null, "Log the meal.", { spelling: "us" }).text).toBe("Log the meal.");
    expect(withVoice.text.match(/British and New Zealand/g)).toHaveLength(1);
  });
  it("draftFull reads the member's spelling on every call, essence: false ones too, and is the one place a system message is built", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/ai.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function draftFull"), src.indexOf("export async function generateImage"));
    // Read for the member the call is for (v: the session's, or the connector's viewer), not behind the essence switch.
    expect(body).toMatch(/opts\.essence === false \? null : essenceBlockFor\(v\.workspace\.id, v\.user\.id\), spellingFor\(v\.workspace\.id, v\.user\.id\)/);
    expect(body).toMatch(/assembleSystem\(essence, task, \{ spelling \}\)/);
    expect(src.match(/assembleSystem\(/g)).toHaveLength(1);
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

describe("a save refused over the cap (H-802)", () => {
  it("lands on an address that is an error answer, so what was typed is put back and the draft kept", () => {
    const url = new URL(essenceOverAddress("ethical_standards", 20512), "http://localhost");
    expect(url.pathname).toBe("/essence");
    expect(url.searchParams.get("step")).toBe("ethical_standards");
    expect(url.searchParams.get("error")).toBe("over");
    expect(url.searchParams.get("chars")).toBe("20512");
    expect(isErrorAnswer(url.search)).toBe(true);
    // No field named: the page's own red line says it; nothing is drawn beside a field
    expect(refusalIn(url.search)).toEqual({ message: "over", field: null });
  });
  it("is never the old over= address, which read as a save", () => {
    expect(isErrorAnswer("?step=identity&over=20512")).toBe(false);
    expect(essenceOverAddress("identity", 20512)).not.toMatch(/[?&]over=/);
  });
});
