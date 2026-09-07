import { describe, expect, it } from "vitest";
import { checklist, publishBlockers, readyToPost, scaffold, type Check } from "../ladder";

const c = (key: string, ok: boolean, level: "fail" | "warn"): Check => ({ key, label: key, ok, level, note: ok ? "" : "fix it" });

describe("outward fields are checked", () => {
  it("catches a banned phrase in the hook and a placeholder in the carousel", () => {
    const base = scaffold({ format: "method_resource", topic: "Test", audience: "warm", keyword: "NONE" }, null, []);
    const l = { ...base, keyword: "NONE", realNumbers: null, format: "method_resource" as const, rungs: base.rungs };
    const keys = (x: typeof l) => publishBlockers(checklist(x, null, [])).map((b) => b.key);
    expect(keys({ ...l, carousel: ["SLIDE 1 — fine", "[HEADLINE]"] })).toContain("placeholders");
    expect(keys({ ...l, hook: "the secret sauce is here" })).toContain("banned");
  });
});

describe("publish gate", () => {
  it("blocks on failures only; warnings are advice", () => {
    const checks = [c("placeholders", false, "fail"), c("length", false, "warn"), c("question", true, "fail")];
    expect(publishBlockers(checks).map((b) => b.key)).toEqual(["placeholders"]);
    expect(readyToPost(checks)).toBe(false);
    expect(publishBlockers([c("length", false, "warn")])).toEqual([]);
    expect(readyToPost([c("length", false, "warn")])).toBe(true);
  });
});
