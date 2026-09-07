import { describe, expect, it } from "vitest";
import { publishBlockers, readyToPost, type Check } from "../ladder";

const c = (key: string, ok: boolean, level: "fail" | "warn"): Check => ({ key, label: key, ok, level, note: ok ? "" : "fix it" });

describe("publish gate", () => {
  it("blocks on failures only; warnings are advice", () => {
    const checks = [c("placeholders", false, "fail"), c("length", false, "warn"), c("question", true, "fail")];
    expect(publishBlockers(checks).map((b) => b.key)).toEqual(["placeholders"]);
    expect(readyToPost(checks)).toBe(false);
    expect(publishBlockers([c("length", false, "warn")])).toEqual([]);
    expect(readyToPost([c("length", false, "warn")])).toBe(true);
  });
});
