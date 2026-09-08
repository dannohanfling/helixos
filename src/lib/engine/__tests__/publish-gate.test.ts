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

describe("block on truth and compliance, warn on craft", () => {
  it("name puns, unverified statistics and unmarked dollars block; lengths and headline shape only warn", () => {
    const base = scaffold({ format: "method_resource", topic: "Test", audience: "warm", keyword: "NONE" }, null, []);
    const rung = (body: string) => ({ n: 1, label: "one", body, postedAt: null });
    const l = { ...base, keyword: "NONE", realNumbers: null, format: "method_resource" as const, copy: "Plan below.\nRead them in order.\nWhat would you try?", rungs: [rung("Fine rung.\nQuotable.")], igCaption: "x".repeat(2300), threadsChain: ["y".repeat(600)], headline: "ONE LINE ONLY", carousel: [], hook: "" };
    const levels = Object.fromEntries(checklist(l, null, []).map((c) => [c.key, c.ok ? "ok" : c.level]));
    expect(levels.ig).toBe("warn");
    expect(levels.threads).toBe("warn");
    expect(levels["headline-lines"]).toBe("warn");
    expect(levels["headline-gold"]).toBe("warn");
    const keys = (x: typeof l) => publishBlockers(checklist(x, null, [])).map((b) => b.key);
    expect(keys({ ...l, rungs: [rung("Book 'em, that's the badge talking.\nQuotable.")] })).toContain("namepun");
    expect(keys({ ...l, rungs: [rung("Studies show 73% of coaches quit.\nQuotable.")] })).toContain("stats");
    expect(keys({ ...l, rungs: [rung("You'd make $4,000 a month.\nQuotable.")] })).toContain("illustrative");
    expect(keys({ ...l, rungs: [rung("You'd make $4,000 a month. (Illustrative. Your numbers will differ.)\nQuotable.")] })).not.toContain("illustrative");
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
