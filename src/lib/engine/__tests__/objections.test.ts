import { describe, expect, it } from "vitest";
import { BELIEF_KEYS } from "@/db/schema";
import { LEGACY_OFFER_OBJECTIONS, OBJECTION_METHOD, handledIn, isSharedObjection, methodReady, reframesOf } from "../objections";
import seed from "@/data/seed/webinar/objections.json";

describe("objections: one record", () => {
  it("every reframe on the record, first and rest, blanks dropped", () => {
    expect(reframesOf({ reframe: "First answer.", reframes: [" Second. ", ""] })).toEqual(["First answer.", "Second."]);
    expect(reframesOf({ reframe: null, reframes: [] })).toEqual([]);
  });
  it("the belief vocabulary is the proof bank's, with 'none' a real answer, and the seed maps only to it", () => {
    expect(BELIEF_KEYS).toEqual(["vehicle", "internal", "external", "none"]);
    for (const o of seed) if (o.belief) expect(BELIEF_KEYS).toContain(o.belief);
    const byName = Object.fromEntries(seed.map((o) => [o.name, o.belief ?? null]));
    expect(byName["I've tried this kind of thing before"]).toBe("vehicle");
    expect(byName["Will this work in my niche?"]).toBe("external");
    expect(byName["Let me think about it"]).toBe("none");
  });
  it("the shared set is the template's; a client's own has an owner", () => {
    expect(isSharedObjection({ workspaceId: null, userId: null })).toBe(true);
    expect(isSharedObjection({ workspaceId: "w", userId: "u" })).toBe(false);
  });
  it("where an objection is already handled is derived, never stored", () => {
    const where = handledIn({ id: "o1" }, [{ assetId: "o1", name: "Q&A + Close", webinarId: "w1" }, { assetId: "o2", name: "Offer Transition", webinarId: "w1" }], [{ id: "f1", name: "90-Day Reset", objectionAssetIds: ["o1"] }], new Map([["w1", "Eat Like a Grown-Up"]]));
    expect(where).toEqual([
      { kind: "webinar", label: "Eat Like a Grown-Up · Q&A + Close", href: "/webinars/w1?step=script" },
      { kind: "offer", label: "90-Day Reset", href: "/offers/f1#objections" },
    ]);
  });
  it("the method is structure until every step has Danno's words, and the reframe step is one of them", () => {
    expect(OBJECTION_METHOD.map((s) => s.key)).toEqual(["hold", "find", "reflect", "reframe", "check", "return"]);
    expect(methodReady()).toBe(false);
    expect(methodReady(OBJECTION_METHOD.map((s) => ({ ...s, title: "t", line: "l" })))).toBe(true);
    expect(LEGACY_OFFER_OBJECTIONS.map((l) => l.field)).toEqual(["objTime", "objMoney", "objPartner", "objTriedBefore", "objDiy"]);
  });
});
