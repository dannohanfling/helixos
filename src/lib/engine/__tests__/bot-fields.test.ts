import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BOT_WRITTEN_FIELDS, productSections, NOTHING_CURRENT_LABEL, STAGE1_NOTHING_CURRENT, isNothingCurrent, nothingToPushLine, PRODUCT_FIELD, PRODUCT_FIELD_OLD, planPayload, stage1Plan, HOUSE_CONSTRAINT_LINES, MAX_BOT_FIELDS_PER_CALL, QUALIFYING_DEFAULTS, READ_BACK_LIMIT, botFieldsRequest, houseConstraints, morePages, parseBotFields, readBackMismatches, stage1Problems, STAGE1_FIELDS, STAGE2_FIELDS, TEMPLATE_BOT_FIELDS, assertStorable, samePayload, stage1Payload, houseDefaultFields } from "../bot-fields";

// An offer on the bot (one-on-one needs no link) and a draft with no bot role, which never reaches the bot.
const live = { name: "90-Day Reset", promise: "Drop 15 lbs in 90 days", container: "Group program", price: 1500, currency: "USD", length: "90 days", status: "live", botRole: "one_on_one" as const };
const draft = { name: "Holiday Survival Sprint", promise: "Get through the holidays", container: "Workshop", price: 297, currency: "USD", length: null, status: "draft" };

describe("the Stage 1 push is a named subset of the template's fields, never the ones the bot writes", () => {
  it("names only template fields, none the client or the agent writes, and Stage 2 stays out", () => {
    for (const f of STAGE1_FIELDS) expect(TEMPLATE_BOT_FIELDS).toContain(f);
    for (const f of STAGE1_FIELDS) expect(BOT_WRITTEN_FIELDS).not.toContain(f);
    for (const f of STAGE2_FIELDS) expect(STAGE1_FIELDS).not.toContain(f);
    expect(BOT_WRITTEN_FIELDS).toContain("calendar_id");
  });
  it("composes every Stage 1 field from the record: the membership's business name else the workspace's, the zone, the offers on the bot in sections, the house constraints, the questions with defaults", () => {
    const input = { businessName: "Torres Nutrition Coaching", workspaceName: "Evolve Omega Academy", timezone: "America/New_York", offers: [live, draft] };
    const p = stage1Payload(input);
    expect(Object.keys(p).sort()).toEqual([...STAGE1_FIELDS].sort());
    expect(p.business_name_cbf).toBe("Torres Nutrition Coaching");
    expect(p.business_time_zone_cbf).toBe("America/New_York");
    expect(p[PRODUCT_FIELD]).toBe(productSections(input).map((x) => x.text).join("\n\n"));
    expect(p[PRODUCT_FIELD]).toContain("90-Day Reset: USD $1,500.");
    expect(p[PRODUCT_FIELD]).toContain("ONE-ON-ONE (90-Day Reset)");
    expect(p[PRODUCT_FIELD]).not.toContain("Holiday Survival Sprint");
    expect(p.ai_constraints_cbf).toBe(houseConstraints("Torres Nutrition Coaching"));
    expect(HOUSE_CONSTRAINT_LINES).toHaveLength(6);
    expect(p.ai_constraints_cbf).toContain("Never claim to be Torres Nutrition Coaching.");
    expect(p.ai_constraints_cbf).not.toContain("{business_name_cbf}");
    expect(HOUSE_CONSTRAINT_LINES[5]).toBe("If someone asks whether you are a person, say you are an assistant and whose assistant you are. Never claim to be {business_name_cbf}.");
    expect(p.ai_constraints_cbf.split("\n")[5]).toBe("If someone asks whether you are a person, say you are an assistant and whose assistant you are. Never claim to be Torres Nutrition Coaching.");
    expect([p.qualifying_question_1, p.qualifying_question_2, p.qualifying_question_3]).toEqual(QUALIFYING_DEFAULTS);
    expect(stage1Payload({ businessName: "  ", workspaceName: "Evolve Omega Academy", timezone: "UTC", offers: [] }).business_name_cbf).toBe("Evolve Omega Academy");
  });
  it("a source the client has not filled composes empty (the plan leaves it out); a written question replaces only its own default", () => {
    const input = { businessName: null, workspaceName: "", timezone: "UTC", offers: [live], coach: { questions: [null, "Who else decides?", ""] } };
    const p = stage1Payload(input);
    expect(p.business_name_cbf).toBe("");
    // No name, no push: the gap is named rather than a sentence about "the business" shipped
    expect(stage1Problems(input)).toEqual(["No business name on the record: set it on the member's profile or the workspace."]);
    expect(stage1Problems({ ...input, businessName: "T" })).toEqual([]);
    expect(p.qualifying_question_2).toBe("Who else decides?");
    expect(p.qualifying_question_1).toBe(QUALIFYING_DEFAULTS[0]);
    expect(p.qualifying_question_3).toBe(QUALIFYING_DEFAULTS[2]);
    expect(stage1Payload({ businessName: null, workspaceName: "", timezone: "UTC", offers: [draft] })[PRODUCT_FIELD]).toBe("");
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

describe("Stage 1 as the coach sees it before a push: per field, by the name the bot has, only what the agent reads", () => {
  const payload = stage1Payload({ businessName: "Torres Nutrition Coaching", workspaceName: "W", timezone: "America/New_York", offers: [live] });
  // The chip a prompt stores is the field's variable id (22 Sep): the plan must find it by id, the same way the FAQ does.
  const ns = (name: string) => `f52594v${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)}`;
  const chip = (name: string) => `<span data-var-id="${ns(name)}" class="mention">${name}</span>`;
  const agent = (reads: string[]) => ({ ns: "a1", name: "Booking Agent", prompts: [{ section: "Main", text: reads.map(chip).join(" ") }] });
  const bot = (vals: Record<string, string>) => Object.entries(vals).map(([name, value]) => ({ name, value, ns: ns(name) }));
  const byField = (rows: ReturnType<typeof stage1Plan>) => Object.fromEntries(rows.map((r) => [r.field, r]));

  it("a question the member left blank never goes over the bot's own question; the house default goes only where the field is empty or HelixOS's (rev 83)", () => {
    const input = { businessName: "T", workspaceName: "W", timezone: "UTC", offers: [live], coach: { questions: [null, "Who else decides?", ""] } };
    const defaults = houseDefaultFields(input);
    expect(defaults).toEqual(["ai_constraints_cbf", "qualifying_question_1", "qualifying_question_3"]);
    const p = stage1Payload(input);
    const qs = ["qualifying_question_1", "qualifying_question_2", "qualifying_question_3"];
    const rows = byField(stage1Plan(p, bot({ qualifying_question_1: "Danno's own first question", qualifying_question_2: "His second", qualifying_question_3: "" }), [agent(qs)], {}, defaults));
    expect(rows.qualifying_question_1).toMatchObject({ status: "empty", line: "Your bot has its own question here. Type yours under Settings to manage it from HelixOS." });
    // Written in HelixOS: it goes, over whatever the bot holds.
    expect(rows.qualifying_question_2.status).toBe("change");
    // The bot's field is empty: the house default goes.
    expect(rows.qualifying_question_3).toMatchObject({ status: "change", next: QUALIFYING_DEFAULTS[2] });
    expect(planPayload(Object.values(rows))).not.toHaveProperty("qualifying_question_1");
    // What HelixOS last sent there, or its own "none" sentence, is HelixOS's to replace.
    const ours = byField(stage1Plan(p, bot({ qualifying_question_1: "An older default HelixOS sent", qualifying_question_3: STAGE1_NOTHING_CURRENT.qualifying_question_3 }), [agent(qs)], { qualifying_question_1: "An older default HelixOS sent" }, defaults));
    expect(ours.qualifying_question_1.status).toBe("change");
    expect(ours.qualifying_question_3.status).toBe("change");
    // With no member questions at all and the bot's own three on it: nothing to push for the questions.
    const none = { ...input, coach: {} };
    const all = byField(stage1Plan(stage1Payload(none), bot({ qualifying_question_1: "a", qualifying_question_2: "b", qualifying_question_3: "c" }), [agent(qs)], {}, houseDefaultFields(none)));
    expect(qs.map((q) => all[q].status)).toEqual(["empty", "empty", "empty"]);
  });
  it("with no house rules written, the six house lines never go over the bot's own rules; they go only where the field is empty or HelixOS's (rev 87)", () => {
    const input = { businessName: "T", workspaceName: "W", timezone: "UTC", offers: [live], coach: { questions: ["a", "b", "c"] } };
    expect(houseDefaultFields(input)).toEqual(["ai_constraints_cbf"]);
    const p = stage1Payload(input);
    const reads = [agent(["ai_constraints_cbf"])];
    const own = byField(stage1Plan(p, bot({ ai_constraints_cbf: "Be kind." }), reads, {}, houseDefaultFields(input)));
    expect(own.ai_constraints_cbf).toMatchObject({ status: "empty", line: "Your bot has its own house rules here. Write yours in Essence to manage them from HelixOS." });
    expect(byField(stage1Plan(p, bot({ ai_constraints_cbf: "" }), reads, {}, houseDefaultFields(input))).ai_constraints_cbf).toMatchObject({ status: "change", next: houseConstraints("T") });
    expect(byField(stage1Plan(p, bot({ ai_constraints_cbf: "What HelixOS sent" }), reads, { ai_constraints_cbf: "What HelixOS sent" }, houseDefaultFields(input))).ai_constraints_cbf.status).toBe("change");
    // Rules of their own, even one: they go over whatever the bot holds.
    const written = { ...input, coach: { ...input.coach, houseRules: ["", "Be brief."] } };
    expect(houseDefaultFields(written)).toEqual([]);
    expect(byField(stage1Plan(stage1Payload(written), bot({ ai_constraints_cbf: "Be kind." }), reads, {}, houseDefaultFields(written))).ai_constraints_cbf).toMatchObject({ status: "change", next: "1. Be brief." });
  });
  it("the offers field is written under its current name, and under the older one only when the bot has no field by the current one", () => {
    expect(PRODUCT_FIELD).toBe("ai_product_&_service_information_cbf");
    expect(PRODUCT_FIELD_OLD).toBe("ai_product_&_service_cbf");
    const old = byField(stage1Plan(payload, bot({ [PRODUCT_FIELD_OLD]: "hand-written" }), [agent([PRODUCT_FIELD_OLD])]))[PRODUCT_FIELD];
    expect(old).toMatchObject({ name: PRODUCT_FIELD_OLD, fallback: true, status: "change", current: "hand-written" });
    expect(old.line).toBe(`Written to ${PRODUCT_FIELD_OLD}, this bot's older name for ${PRODUCT_FIELD}.`);
    const both = byField(stage1Plan(payload, bot({ [PRODUCT_FIELD_OLD]: "a", [PRODUCT_FIELD]: "b" }), [agent([PRODUCT_FIELD, PRODUCT_FIELD_OLD])]))[PRODUCT_FIELD];
    expect(both).toMatchObject({ name: PRODUCT_FIELD, fallback: false, current: "b" });
    // With both names on the bot, the one an agent actually reads wins.
    const oldRead = byField(stage1Plan(payload, bot({ [PRODUCT_FIELD_OLD]: "a", [PRODUCT_FIELD]: "b" }), [agent([PRODUCT_FIELD_OLD])]))[PRODUCT_FIELD];
    expect(oldRead).toMatchObject({ name: PRODUCT_FIELD_OLD, fallback: true, current: "a" });
    const none = byField(stage1Plan(payload, bot({}), [agent([PRODUCT_FIELD])]))[PRODUCT_FIELD];
    expect(none).toMatchObject({ name: null, status: "missing" });
    expect(none.line).toBe(`Your bot has no ${PRODUCT_FIELD} field (nor the older ${PRODUCT_FIELD_OLD}), so nothing is sent to it.`);
  });
  it("a field the agent does not read gets the plain line, no values, and is not sent; the check is by chip id, never the bare name", () => {
    const held = bot({ business_name_cbf: "Old name", qualifying_question_3: "Hand-written on 21 Sep" });
    const rows = byField(stage1Plan(payload, held, [agent(["business_name_cbf"])]));
    expect(rows.qualifying_question_3).toMatchObject({ status: "unread", current: null, next: "" });
    expect(rows.qualifying_question_3.line).toBe("No agent on this bot reads qualifying_question_3 yet, so nothing is sent to it.");
    expect(rows.business_name_cbf.status).toBe("change");
    // The name written in prose is not a read.
    const prose = { ns: "a1", name: "A", prompts: [{ section: "Main", text: "mention business_name_cbf in passing" }] };
    expect(byField(stage1Plan(payload, held, [prose])).business_name_cbf.status).toBe("unread");
    expect(Object.keys(planPayload(stage1Plan(payload, held, [agent(["business_name_cbf"])])))).toEqual(["business_name_cbf"]);
  });
  it("an empty value is never sent: the field is left out and the bot keeps what it holds", () => {
    const empty = stage1Payload({ businessName: "T", workspaceName: "W", timezone: "UTC", offers: [draft] });
    expect(empty[PRODUCT_FIELD]).toBe("");
    const rows = stage1Plan(empty, bot({ [PRODUCT_FIELD]: "What the coach wrote by hand" }), [agent([PRODUCT_FIELD])]);
    const row = byField(rows)[PRODUCT_FIELD];
    expect(row).toMatchObject({ status: "empty", current: "What the coach wrote by hand" });
    expect(row.line).toBe("HelixOS has nothing for this yet, and your bot holds text HelixOS did not send, so nothing is sent; your bot keeps what it holds.");
    expect(planPayload(rows)).not.toHaveProperty(PRODUCT_FIELD);
    for (const v of Object.values(planPayload(stage1Plan({ ...payload, qualifying_question_1: "   " }, bot({ qualifying_question_1: "x" }), [agent(["qualifying_question_1"])])))) expect(v.trim()).not.toBe("");
  });
  it("only what changes is sent: a field the bot already holds is shown as unchanged and left alone", () => {
    const held = bot({ business_name_cbf: "Torres Nutrition Coaching", business_time_zone_cbf: "UTC" });
    const rows = byField(stage1Plan(payload, held, [agent(["business_name_cbf", "business_time_zone_cbf"])]));
    expect(rows.business_name_cbf).toMatchObject({ status: "same", line: "Your bot already holds this." });
    expect(rows.business_time_zone_cbf).toMatchObject({ status: "change", current: "UTC", next: "America/New_York" });
    expect(planPayload(Object.values(rows))).toEqual({ business_time_zone_cbf: "America/New_York" });
  });
  it("bot fields belong to the whole bot: a field is read when any agent reads it, and the row names who", () => {
    const faqAgent = { ns: "a0", name: "Community FAQ Agent", prompts: [{ section: "Main", text: chip("ai_faq_cbf") }] };
    const setter = { ...agent(["business_name_cbf", "qualifying_question_1"]), ns: "a2", name: "Appointment Setter" };
    const held = bot({ business_name_cbf: "Old", qualifying_question_1: "x", qualifying_question_3: "y", ai_faq_cbf: "faq" });
    // Danno's bot, 23 Sep: the FAQ agent alone reads none of the Stage 1 fields.
    expect(stage1Plan(payload, held, [faqAgent]).filter((r) => r.name).map((r) => r.status)).toEqual(["unread", "unread", "unread"]);
    const rows = byField(stage1Plan(payload, held, [faqAgent, setter]));
    expect(rows.business_name_cbf).toMatchObject({ status: "change", readBy: ["Appointment Setter"] });
    expect(rows.qualifying_question_3).toMatchObject({ status: "unread", readBy: [] });
    const both = byField(stage1Plan(payload, held, [{ ...setter, name: "Booking Agent", ns: "a3" }, setter]));
    expect(both.business_name_cbf.readBy).toEqual(["Booking Agent", "Appointment Setter"]);
  });
  it("the closing line counts what happened, never one blanket sentence", () => {
    const row = (status: string) => ({ status }) as unknown as ReturnType<typeof stage1Plan>[number];
    expect(nothingToPushLine(Array(7).fill(row("unread")))).toBe("Nothing to push: no agent on this bot reads these fields yet.");
    expect(nothingToPushLine(Array(7).fill(row("same")))).toBe("Nothing to push: the bot already holds everything HelixOS would send.");
    expect(nothingToPushLine([...Array(4).fill(row("same")), ...Array(3).fill(row("unread"))])).toBe("Nothing to push: 4 unchanged, 3 not read by any agent.");
    expect(nothingToPushLine([row("same"), row("empty"), row("missing")])).toBe("Nothing to push: 1 unchanged, 1 with nothing in HelixOS, 1 not on the bot.");
  });
  it("a field HelixOS wrote and now has nothing for is told there is none; text anyone else wrote is left out", () => {
    const empty = stage1Payload({ businessName: "T", workspaceName: "W", timezone: "UTC", offers: [draft] });
    const ours = "90-Day Reset · Drop 15 lbs in 90 days · Group program · USD $1,500 · 90 days";
    const retired = byField(stage1Plan(empty, bot({ [PRODUCT_FIELD]: ours }), [agent([PRODUCT_FIELD])], { [PRODUCT_FIELD]: ours }))[PRODUCT_FIELD];
    expect(retired).toMatchObject({ status: "change", nothing: true, current: ours, next: STAGE1_NOTHING_CURRENT[PRODUCT_FIELD] });
    expect(retired.line).toBe("HelixOS wrote this and now has nothing for it, so your bot is told: no current offer.");
    expect(planPayload([retired])).toEqual({ [PRODUCT_FIELD]: "There is no offer open right now. Do not describe or price any product; offer a call with the coach instead." });
    // Under the older name the same rule holds, by the name the bot has.
    expect(byField(stage1Plan(empty, bot({ [PRODUCT_FIELD_OLD]: ours }), [agent([PRODUCT_FIELD_OLD])], { [PRODUCT_FIELD_OLD]: ours }))[PRODUCT_FIELD]).toMatchObject({ status: "change", nothing: true, name: PRODUCT_FIELD_OLD });
    // Hand-edited since: left out, as before.
    expect(byField(stage1Plan(empty, bot({ [PRODUCT_FIELD]: "edited by hand" }), [agent([PRODUCT_FIELD])], { [PRODUCT_FIELD]: ours }))[PRODUCT_FIELD].status).toBe("empty");
    // Already saying there is none: unchanged, and it is HelixOS's own empty.
    const said = byField(stage1Plan(empty, bot({ [PRODUCT_FIELD]: STAGE1_NOTHING_CURRENT[PRODUCT_FIELD] }), [agent([PRODUCT_FIELD])], {}))[PRODUCT_FIELD];
    expect(said).toMatchObject({ status: "same", nothing: true });
    expect(isNothingCurrent(PRODUCT_FIELD, ` ${STAGE1_NOTHING_CURRENT[PRODUCT_FIELD]} `)).toBe(true);
    // The next real value goes straight over it.
    expect(byField(stage1Plan(payload, bot({ [PRODUCT_FIELD]: STAGE1_NOTHING_CURRENT[PRODUCT_FIELD] }), [agent([PRODUCT_FIELD])]))[PRODUCT_FIELD]).toMatchObject({ status: "change", nothing: false });
    // One sentence and one label per field, never empty.
    for (const f of STAGE1_FIELDS) {
      expect(STAGE1_NOTHING_CURRENT[f].trim().length, f).toBeGreaterThan(0);
      expect(NOTHING_CURRENT_LABEL[f].trim().length, f).toBeGreaterThan(0);
    }
  });
  it("nothing pushes on its own: the only caller of the Stage 1 push is a press on the \"Your bot\" page", () => {
    const dir = join(process.cwd(), "src/lib/actions");
    const callers = readdirSync(dir).filter((f) => readFileSync(join(dir, f), "utf8").includes("pushBotFields("));
    expect(callers).toEqual(["your-bot.ts"]);
    expect(readFileSync(join(process.cwd(), "src/lib/community-loyalty.ts"), "utf8")).not.toMatch(/repushForMember|repushWorkspace/);
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
    expect(parseBotFields({ data: [row] })).toEqual([{ name: "business_name_cbf", value: "Torres", varType: "text", ns: "f1" }]);
    // var_ns is kept: it is what a prompt's chip stores in place of the name. A row without one still parses, with no id.
    expect(parseBotFields({ data: [{ ...row, var_ns: undefined }] })).toEqual([{ name: "business_name_cbf", value: "Torres", varType: "text", ns: "" }]);
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
