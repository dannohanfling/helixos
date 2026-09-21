import { describe, expect, it } from "vitest";
import { BOT_WRITTEN_FIELDS, HOUSE_CONSTRAINTS, QUALIFYING_DEFAULTS, STAGE1_FIELDS, STAGE2_FIELDS, TEMPLATE_BOT_FIELDS, assertStorable, productLine, samePayload, stage1Payload } from "../bot-fields";

const live = { name: "90-Day Reset", promise: "Drop 15 lbs in 90 days", container: "Group program", price: 1500, currency: "USD", length: "90 days", status: "live" };
const draft = { name: "Holiday Survival Sprint", promise: "Get through the holidays", container: "Workshop", price: 297, currency: "USD", length: null, status: "draft" };

describe("the Stage 1 push is a named subset of the template's fields, never the ones the bot writes", () => {
  it("names only template fields, none the client or the agent writes, and Stage 2 stays out", () => {
    for (const f of STAGE1_FIELDS) expect(TEMPLATE_BOT_FIELDS).toContain(f);
    for (const f of STAGE1_FIELDS) expect(BOT_WRITTEN_FIELDS).not.toContain(f);
    for (const f of STAGE2_FIELDS) expect(STAGE1_FIELDS).not.toContain(f);
    expect(BOT_WRITTEN_FIELDS).toContain("calendar_id");
  });
  it("composes every Stage 1 field from the record: the membership's business name else the workspace's, the zone, live offers as fact lines, the house constraints, the questions with defaults", () => {
    const p = stage1Payload({ businessName: "Torres Nutrition Coaching", workspaceName: "Evolve Omega Academy", timezone: "America/New_York", offers: [live, draft] });
    expect(Object.keys(p).sort()).toEqual([...STAGE1_FIELDS].sort());
    expect(p.business_name_cbf).toBe("Torres Nutrition Coaching");
    expect(p.business_time_zone_cbf).toBe("America/New_York");
    expect(p["ai_product_&_service_cbf"]).toBe("90-Day Reset · Drop 15 lbs in 90 days · Group program · USD $1,500 · 90 days");
    expect(p.ai_constraints_cbf).toBe(HOUSE_CONSTRAINTS);
    expect([p.qualifying_question_1, p.qualifying_question_2, p.qualifying_question_3]).toEqual(QUALIFYING_DEFAULTS);
    expect(stage1Payload({ businessName: "  ", workspaceName: "Evolve Omega Academy", timezone: "UTC", offers: [] }).business_name_cbf).toBe("Evolve Omega Academy");
  });
  it("a source the client has not filled is sent empty, not skipped; a written question replaces only its own default", () => {
    const p = stage1Payload({ businessName: null, workspaceName: "", timezone: "UTC", offers: [{ ...live, qualifyingQuestion2: "Who else decides?" }] });
    expect(p.business_name_cbf).toBe("");
    expect(p.qualifying_question_2).toBe("Who else decides?");
    expect(p.qualifying_question_1).toBe(QUALIFYING_DEFAULTS[0]);
    expect(stage1Payload({ businessName: null, workspaceName: "", timezone: "UTC", offers: [draft] })["ai_product_&_service_cbf"]).toBe("");
    expect(productLine({ ...live, promise: null, length: null })).toBe("90-Day Reset · Group program · USD $1,500");
  });
  it("nothing changed means nothing sent; a value carrying a credential refuses", () => {
    const p = stage1Payload({ businessName: "T", workspaceName: "W", timezone: "UTC", offers: [live] });
    expect(samePayload({ ...p }, p)).toBe(true);
    expect(samePayload({ ...p, business_name_cbf: "Other" }, p)).toBe(false);
    expect(samePayload(null, p)).toBe(false);
    expect(samePayload({}, p)).toBe(false);
    expect(() => assertStorable(p, ["uchat-token-x"])).not.toThrow();
    expect(() => assertStorable({ ...p, business_name_cbf: "see uchat-token-x" }, ["uchat-token-x"])).toThrow(/credential/);
    expect(() => assertStorable({ ...p, ai_constraints_cbf: "http://x/api/iwh/abc" }, [])).toThrow(/credential/);
    expect(() => assertStorable(p, [""])).not.toThrow();
  });
});
