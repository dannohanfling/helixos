import { describe, expect, it } from "vitest";
import { V1_TABLES, V2_TABLES } from "../../../../scripts/fixtures/airtable-client";
import { buildPlan, fieldKey, offerName, planSummary, revenueTargets, sameOffer, tableKey, type ImportSource } from "../airtable-import";

const source = (withFallback = true): ImportSource => ({
  v2: Object.fromEntries(V2_TABLES.map((t) => [tableKey(t.name), { name: t.name.replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim(), records: t.records }])),
  v1: withFallback ? Object.fromEntries(V1_TABLES.map((t) => [tableKey(t.name), { name: t.name, records: t.records }])) : {},
});
const rules = { createdSince: "2026-06-10" };

describe("reading a HelixOS-template base (27 Sep)", () => {
  it("field and table names without their emoji and double spaces", () => {
    expect(fieldKey("🗝️ V1 Record ID")).toBe("v1 record id");
    expect(tableKey("🌎  Vision")).toBe("vision");
    expect(fieldKey("✍️  Content")).toBe("content");
    expect(tableKey("#️⃣ KPIs")).toBe("kpis");
  });
  it("offer names: the current generation has an emoji and a code, the older one a bare code; both share a name", () => {
    expect(offerName("🗺️ B1 — True North Business Blueprint")).toEqual({ current: true, code: "B1", name: "True North Business Blueprint" });
    expect(offerName("02 True North Alignment Blueprint")).toEqual({ current: false, code: "02", name: "True North Alignment Blueprint" });
    expect(offerName("🔓 True North Reconnect™ — Universal Doorway")).toEqual({ current: true, code: null, name: "True North Reconnect™ — Universal Doorway" });
    expect(sameOffer("True North Reconnect™ — Universal Doorway")).toBe(sameOffer("True North Reconnect"));
    expect(sameOffer("True North Collective™ (Business)")).toBe(sameOffer("True North Collective"));
  });
  it("revenue targets from a note: each year's line, the range kept", () => {
    expect(revenueTargets("Y1: NZD 412,000 to 462,000\nY2 NZD 2,252,500 – 2,274,500\nnothing here")).toEqual([
      { year: 1, low: 412000, high: 462000, line: "Y1: NZD 412,000 to 462,000" },
      { year: 2, low: 2252500, high: 2274500, line: "Y2 NZD 2,252,500 – 2,274,500" },
    ]);
  });
});

describe("the dry run of a synthetic client base", () => {
  const plan = buildPlan(source(), rules, new Set());
  const line = (label: string) => plan.lines.find((l) => l.label === label || l.label.endsWith(` ${label}`));
  it("skips the template's, the test rows and anything older than the cut-off, each with its reason", () => {
    const skipped = plan.lines.filter((l) => l.action === "skip").map((l) => `${l.label}: ${l.note}`);
    expect(skipped).toEqual(["ZZ_TEST_DELETE_ME: a test row", "Integrity: created 2026-04-14, before 2026-06-10", "Template Framework: the template's own (Universal)", "[EXAMPLE] Awareness: a template example"]);
  });
  it("current offers go in with their copy, NZD prices and pathway; the older ones archived and linked to their replacement; a lead-magnet offer becomes a lead magnet merged by name", () => {
    const t00 = plan.offers.find((o) => o.tierCode === "T00")!;
    expect(t00).toMatchObject({ name: "Team Diagnostic", status: "live", price: 6000, pathway: "Teams", arcStage: "See, Reset", currentSituation: "Everyone is busy and nothing moves.", coreComponents: "Interviews\nReport\nDebrief", objWrongTime: "There is never a quiet quarter." });
    expect(plan.offers.find((o) => o.tierCode === "F1")!.status).toBe("draft");
    const old = plan.offers.find((o) => o.tierCode === "01")!;
    expect(old).toMatchObject({ status: "retired", price: 5500, replacedBy: t00.sourceRef });
    expect(line("Team Diagnostic")!.note).toBeTruthy();
    expect(plan.lines.find((l) => l.area === "archived offers" && l.label === "01 Team Diagnostic")!.note).toBe("archived, replaced by T00 Team Diagnostic (price 5,500 → 6,000; the current one stands)");
    expect(plan.magnets).toEqual([{ sourceRef: expect.any(String), title: "Calm Week Checklist", mergedWith: expect.any(String), link: "https://example.com/calm-week", status: "Live" }]);
  });
  it("pathways in ladder order from the current offers, each with its founder story from Vision", () => {
    expect(plan.pathways.map((p) => [p.name, p.tierPrefix, p.founderStory ? "story" : "no story"])).toEqual([
      ["Open Door", null, "no story"],
      ["Teams", "T", "story"],
      ["Founders", "F", "story"],
    ]);
    expect(plan.pathways.find((p) => p.name === "Founders")!.tagline).toBe("Build without breaking.");
  });
  it("Vision into Essence, word for word: values and principles as lists, the brand lines, mission and vision; beliefs into the bank; founder stories; revenue goals", () => {
    expect(plan.essence.brand).toMatchObject({ values: ["Courage: We say the hard thing kindly."], principles: ["Steadiness"], slogan: "Lead lighter.", tagline: "Calm is a skill.", purpose: "To make leadership feel lighter.", content_pillars: ["Calm first", "Clear roles"], strategic_partners: ["Guild of Coaches"], tone_and_values: "Warm, plain, never loud." });
    expect(plan.essence.mission_and_vision).toEqual({ mission_statement: "Calm leaders for busy teams.", vision_statement: "Every team led from the inside out." });
    expect(plan.assets.filter((a) => a.type === "belief").map((a) => [a.name, a.tag])).toEqual([["Growth is chosen daily", "Internal"]]);
    expect(plan.assets.filter((a) => a.type === "story").map((a) => a.name)).toEqual(["Founder story: Teams", "Founder story (master)", "Founder story: Founders"]);
    expect(plan.goals.map((g) => [g.title, g.target, g.unit])).toEqual([["Year 1 revenue: Y1: NZD 100,000 to 120,000", 100000, "NZD"], ["Year 2 revenue: Y2: NZD 250,000", 250000, "NZD"]]);
  });
  it("the journey: stages in order, the review row's full text from the fallback base, a link to an old offer pointed at its replacement; the name-only rows kept word for word together", () => {
    const journey = plan.assets.filter((a) => a.type === "journey_stage");
    expect(journey.map((a) => a.name)).toEqual(["Notice", "Reset", "Team description (review)", "Pieces to re-join (review)"]);
    const t00 = plan.offers.find((o) => o.tierCode === "T00")!;
    expect(journey[0].extra.offer_refs).toBe(t00.sourceRef);
    expect(journey[2]).toMatchObject({ body: "Teams notice the drag long before they name it, and they name it long before they act.", tag: "review" });
    expect(journey[3].body).toBe("- and a calmer week.\n- clarity");
    expect(plan.unfilled).toEqual([]);
  });
  it("with no fallback base, the review row keeps this base's text and the dry run says what it couldn't fill", () => {
    const bare = buildPlan(source(false), rules, new Set());
    expect(bare.assets.find((a) => a.name === "Team description (review)")!.body).toBe("MIGRATION NOTE: v1 record name held this full text");
    expect(bare.unfilled).toEqual(['Buyer Readiness "Team description (review)": its full text is in the fallback base; kept as this base has it, with its migration note']);
  });
  it("tasks: status, urgency and category mapped, the assignee as text, the Airtable links kept for later", () => {
    expect(plan.tasks.map((t) => [t.title, t.status, t.urgency, t.category, t.assignee])).toEqual([
      ["Book three discovery calls", "today", "top3", "sales", "Sam"],
      ["Write the team report template", "done", "medium", "system", null],
      ["Plan the retreat", "upcoming", "medium", "admin", null],
    ]);
    expect(plan.tasks[0].refs.goals).toEqual(["recGOAL0000000001"]);
  });
  it("frameworks, groups, and the rest of the Lead Magnet table left for Phase 2", () => {
    expect(plan.assets.find((a) => a.type === "framework")).toMatchObject({ name: "The Calm Loop", summary: "Calm is a sequence, not a mood.", useWhen: "Teaching" });
    expect(plan.groups).toEqual([{ sourceRef: expect.any(String), name: "Calm Leaders Circle", url: "https://example.com/groups/calm", notes: "Type: Facebook · Engagement: High" }]);
    expect(plan.notInPhase1.find((t) => t.table.startsWith("Lead Magnet"))!.rows).toBe(1);
  });
  it("a second run says update for what the client already has", () => {
    const first = buildPlan(source(), rules, new Set());
    const existing = new Set(first.lines.filter((l) => l.action !== "skip").map((l) => `${l.area}:${l.sourceRef}`));
    existing.add("brand:*");
    const again = buildPlan(source(), rules, existing);
    expect(planSummary(again).every((s) => s.create === 0)).toBe(true);
    expect(planSummary(first).find((s) => s.area === "tasks")).toEqual({ area: "tasks", create: 3, update: 0 });
  });
});
