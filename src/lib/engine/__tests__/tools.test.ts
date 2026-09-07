import { describe, expect, it } from "vitest";
import { FEATURES } from "../ai-usage";
import { TOOLS, toolName, toolStatus, type ToolFacts } from "../tools";

const all: ToolFacts = { ai_key: true, ladder_facts: true, proof: true, brand_voice: true, webinar: true, content: true, groups: true, principles: true };

describe("tools front door", () => {
  it("has a card for every client-facing AI feature, each needing the member's own key", () => {
    const keys = Object.keys(FEATURES).filter((k) => k !== "key_check");
    expect(TOOLS.map((t) => t.feature).sort()).toEqual(keys.sort());
    for (const t of TOOLS) {
      expect(t.needs.some((n) => n.key === "ai_key" && n.required), t.feature).toBe(true);
      expect(t.makes.length, t.feature).toBeGreaterThan(0);
    }
  });
  it("is ready only when every required input is present; optional ones are listed, not blocking", () => {
    const ladder = TOOLS.find((t) => t.feature === "ladder")!;
    expect(toolStatus(ladder, all).ready).toBe(true);
    const noKey = toolStatus(ladder, { ...all, ai_key: false });
    expect(noKey.ready).toBe(false);
    expect(noKey.missing[0].key).toBe("ai_key");
    const noProof = toolStatus(ladder, { ...all, proof: false, brand_voice: false });
    expect(noProof.ready).toBe(true);
    expect(noProof.optional.map((n) => n.key)).toEqual(["proof", "brand_voice"]);
  });
  it("falls back to the feature's working label until Danno names it", () => {
    expect(toolName("ladder", {})).toEqual({ name: "Comment ladders", promise: "", named: false });
    expect(toolName("ladder", { ladder: { name: "Rung Builder", promise: "Give it a topic." } })).toEqual({ name: "Rung Builder", promise: "Give it a topic.", named: true });
  });
});
