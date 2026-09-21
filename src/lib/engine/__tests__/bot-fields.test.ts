import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_WRITTEN_FIELDS, HOUSE_CONSTRAINT_LINES, MAX_BOT_FIELDS_PER_CALL, QUALIFYING_DEFAULTS, READ_BACK_LIMIT, botFieldsRequest, houseConstraints, morePages, parseBotFields, readBackMismatches, stage1Problems, STAGE1_FIELDS, STAGE2_FIELDS, TEMPLATE_BOT_FIELDS, assertStorable, productLine, samePayload, stage1Payload } from "../bot-fields";

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
    expect(p.ai_constraints_cbf).toBe(houseConstraints("Torres Nutrition Coaching"));
    expect(HOUSE_CONSTRAINT_LINES).toHaveLength(6);
    expect(p.ai_constraints_cbf).toContain("Never claim to be Torres Nutrition Coaching.");
    expect(p.ai_constraints_cbf).not.toContain("{business_name_cbf}");
    expect(HOUSE_CONSTRAINT_LINES[5]).toBe("If someone asks whether you are a person, say you are an assistant and whose assistant you are. Never claim to be {business_name_cbf}.");
    expect(p.ai_constraints_cbf.split("\n")[5]).toBe("If someone asks whether you are a person, say you are an assistant and whose assistant you are. Never claim to be Torres Nutrition Coaching.");
    expect([p.qualifying_question_1, p.qualifying_question_2, p.qualifying_question_3]).toEqual(QUALIFYING_DEFAULTS);
    expect(stage1Payload({ businessName: "  ", workspaceName: "Evolve Omega Academy", timezone: "UTC", offers: [] }).business_name_cbf).toBe("Evolve Omega Academy");
  });
  it("a source the client has not filled is sent empty, not skipped; a written question replaces only its own default", () => {
    const p = stage1Payload({ businessName: null, workspaceName: "", timezone: "UTC", offers: [{ ...live, qualifyingQuestion2: "Who else decides?" }] });
    expect(p.business_name_cbf).toBe("");
    // No name, no push: the gap is named rather than a sentence about "the business" shipped
    expect(stage1Problems(p)).toEqual(["No business name on the record: set it on the member's profile or the workspace."]);
    expect(stage1Problems({ ...p, business_name_cbf: "T" })).toEqual([]);
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

/**
 * The request body schema for PUT /flow/set-bot-fields-by-name, as the published UChat API OpenAPI document (1.0.0) states it and
 * code-addendum-uchat-spec.md quotes it: `{ "data": [ { "name": string, "value": string } ] }`, data required, up to 20.
 */
const SPEC_BODY = { type: "object", required: ["data"], properties: { data: { type: "array", maxItems: 20, items: { type: "object", required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" } } } } } } as const;
function conforms(v: unknown, s: { type: string; required?: readonly string[]; properties?: Record<string, unknown>; items?: unknown; maxItems?: number }): boolean {
  if (s.type === "string") return typeof v === "string";
  if (s.type === "array") return Array.isArray(v) && (s.maxItems === undefined || v.length <= s.maxItems) && v.every((x) => conforms(x, s.items as never));
  if (s.type === "object") {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    return (s.required ?? []).every((k) => k in o) && Object.entries(s.properties ?? {}).every(([k, sub]) => !(k in o) || conforms(o[k], sub as never));
  }
  return false;
}

describe("the request to set-bot-fields-by-name is the spec's shape, every value a string, never more than the API takes", () => {
  it("wraps the fields under data, as {name, value} strings, and conforms to the schema quoted from the spec", () => {
    const body = botFieldsRequest(stage1Payload({ businessName: "Torres Nutrition Coaching", workspaceName: "W", timezone: "America/New_York", offers: [live] }));
    expect(conforms(body, SPEC_BODY)).toBe(true);
    expect(Object.keys(body)).toEqual(["data"]);
    expect(body.data.map((d) => d.name)).toEqual([...STAGE1_FIELDS]);
    for (const d of body.data) expect(typeof d.value).toBe("string");
    expect(conforms({ fields: body.data }, SPEC_BODY)).toBe(false);
    expect(conforms({ data: [{ name: "x", value: 1 }] }, SPEC_BODY)).toBe(false);
  });
  it("refuses a non-string value, an empty push, and more fields than one call takes", () => {
    expect(() => botFieldsRequest({ a: 1 as unknown as string })).toThrow(/not a string/);
    expect(() => botFieldsRequest({})).toThrow(/nothing to push/);
    expect(MAX_BOT_FIELDS_PER_CALL).toBe(20);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, "v"]));
    expect(() => botFieldsRequest(many)).toThrow(/21 fields in one call; the API takes 20/);
    expect(botFieldsRequest(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, "v"]))).data).toHaveLength(20);
  });
  it("a 200 is not a match: the read-back names every field whose value differs or is missing", () => {
    const sent = { a: "1", b: "2", c: "3" };
    expect(readBackMismatches(sent, { a: "1", b: "2", c: "3", calendar_id: "cal" })).toEqual([]);
    expect(readBackMismatches(sent, { a: "1", b: "x" })).toEqual(["b", "c"]);
  });
  it("the read-back parses the spec's BotFieldResource and nothing else, and pages until a page comes back short", () => {
    const row = { name: "business_name_cbf", var_type: "text", value: "Torres", var_ns: "f1", description: "", is_template_field: false };
    expect(parseBotFields({ data: [row] })).toEqual([{ name: "business_name_cbf", value: "Torres", varType: "text" }]);
    // The shapes it must not accept: an object map, a bare array, a row missing var_type, a non-string value
    expect(parseBotFields({ data: { business_name_cbf: "Torres" } })).toEqual([]);
    expect(parseBotFields([row])).toEqual([]);
    expect(parseBotFields({ data: [{ name: "a", value: "1" }] })).toEqual([]);
    expect(parseBotFields({ data: [{ name: "a", var_type: "number", value: 1 }] })).toEqual([]);
    expect(READ_BACK_LIMIT).toBe(100);
    expect(morePages(100, 100)).toBe(true);
    expect(morePages(99, 100)).toBe(false);
    expect(morePages(0, 100)).toBe(false);
  });
  it("the client sends that body and reads the fields back before it records a push", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/community-loyalty.ts"), "utf8");
    expect(src).toContain("body: JSON.stringify(botFieldsRequest(payload))");
    expect(src).not.toMatch(/JSON\.stringify\(\{ fields/);
    expect(src.indexOf("/flow/bot-fields?limit=${READ_BACK_LIMIT}&page=${page}")).toBeGreaterThan(src.indexOf("/flow/set-bot-fields-by-name"));
    expect(src).not.toMatch(/object map|heldFields/);
    expect(src.indexOf("readBackMismatches(payload, held)")).toBeLessThan(src.indexOf("clBotFieldsPushedAt: nowIso()"));
  });
});
