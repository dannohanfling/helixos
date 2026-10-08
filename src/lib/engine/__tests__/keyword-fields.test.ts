import { describe, expect, it } from "vitest";
import type { LadderKeyword } from "@/db/schema";
import { KEYWORD_AGENT_FIELD, KEYWORDS_FIELD, MAX_ACTIVE_KEYWORDS, defaultTag, keywordFieldsPayload, keywordPlan, parseRouterKeywords, routerKeyword } from "../keyword-fields";

/** The keyword router's two bot fields (Ship a ladder commit 2): what each keyword becomes, the cap, the plan against the bot. */
const product = { name: "The 90-Day Reset", pitch: "Three meals, one rule, a daily check-in.", priceLine: "$497 for 90 days.", trialLine: "Free 7 days." };
const magnets = [{ id: "m1", title: "The 7-day starter plan", promise: "Three meals you already know", url: "https://app.example/g/starter-plan" }, { id: "m2", title: "Unpublished", promise: "", url: null }];

describe("the keyword router's fields", () => {
  it("a keyword becomes what the router reads: the product's pitch and price, the magnet's title and link, or the conversation's line; none without a target", () => {
    expect(routerKeyword({ keyword: "reset", use: "default", target: { kind: "product" } }, product, magnets)).toEqual({ keyword: "RESET", kind: "both", tag: "helix:RESET", fetch: { kind: "product", title: "The 90-Day Reset" }, reply: "Three meals, one rule, a daily check-in. $497 for 90 days. Free 7 days." });
    expect(routerKeyword({ keyword: "PLAN", use: "", target: { kind: "magnet", magnetId: "m1" }, kind: "comment", tag: "wants-plan" }, product, magnets)).toEqual({ keyword: "PLAN", kind: "comment", tag: "wants-plan", fetch: { kind: "magnet", title: "The 7-day starter plan", url: "https://app.example/g/starter-plan" }, reply: "The 7-day starter plan: Three meals you already know https://app.example/g/starter-plan" });
    expect(routerKeyword({ keyword: "TALK", use: "", target: { kind: "magnet", magnetId: "m2" }, kind: "dm" }, product, magnets)?.fetch).toEqual({ kind: "magnet", title: "Unpublished" });
    expect(routerKeyword({ keyword: "ROOM", use: "", target: { kind: "conversation", line: "A conversation about the Academy and the community." }, kind: "dm" }, product, magnets)).toEqual({ keyword: "ROOM", kind: "dm", tag: "helix:ROOM", fetch: { kind: "conversation", line: "A conversation about the Academy and the community." }, reply: "A conversation about the Academy and the community." });
    expect(routerKeyword({ keyword: "NOPE", use: "" }, product, magnets)).toBeNull();
    expect(routerKeyword({ keyword: "GONE", use: "", target: { kind: "magnet", magnetId: "missing" } }, product, magnets)).toBeNull();
    expect(routerKeyword({ keyword: "EMPTY", use: "", target: { kind: "conversation", line: " " } }, product, magnets)).toBeNull();
    expect(defaultTag("plan")).toBe("helix:PLAN");
  });
  it("the payload: active keywords once each, capped, as JSON, with the agent; a push holds nothing but strings", () => {
    const many: LadderKeyword[] = Array.from({ length: 25 }, (_, i) => ({ keyword: `K${i}`, use: "", target: { kind: "product" } }));
    const p = keywordFieldsPayload([{ keyword: "RESET", use: "", target: { kind: "product" } }, { keyword: "reset", use: "", target: { kind: "conversation", line: "twice" } }, { keyword: "NOPE", use: "" }, ...many], product, magnets, "f123agent");
    const list = parseRouterKeywords(p[KEYWORDS_FIELD]);
    expect(list.length).toBe(MAX_ACTIVE_KEYWORDS);
    expect(list[0].keyword).toBe("RESET");
    expect(list[0].fetch.kind).toBe("product");
    expect(list.some((k) => k.keyword === "NOPE")).toBe(false);
    expect(p[KEYWORD_AGENT_FIELD]).toBe("f123agent");
    expect(keywordFieldsPayload([], product, magnets, null)).toEqual({ [KEYWORDS_FIELD]: "[]", [KEYWORD_AGENT_FIELD]: "" });
    expect(parseRouterKeywords("not json")).toEqual([]);
  });
  it("the plan: a field the bot lacks is missing (the template has no router), one it holds is same, one that differs is change", () => {
    const payload = keywordFieldsPayload([{ keyword: "RESET", use: "", target: { kind: "product" } }], product, magnets, "a1");
    expect(keywordPlan(payload, []).map((r) => r.status)).toEqual(["missing", "missing"]);
    const held = [{ name: KEYWORDS_FIELD, value: payload[KEYWORDS_FIELD] }, { name: KEYWORD_AGENT_FIELD, value: "old" }];
    expect(keywordPlan(payload, held).map((r) => [r.name, r.status])).toEqual([[KEYWORDS_FIELD, "same"], [KEYWORD_AGENT_FIELD, "change"]]);
  });
});
