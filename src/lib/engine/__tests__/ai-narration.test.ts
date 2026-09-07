import { describe, expect, it } from "vitest";
import { FEATURES } from "../ai-usage";
import { NARRATION, NARRATION_STEP_MS, narrationLine } from "../ai-narration";

describe("AI narration", () => {
  it("has three to five plain, present-tense lines for every client-facing feature", () => {
    for (const key of Object.keys(FEATURES).filter((k) => k !== "key_check")) {
      const lines = NARRATION[key];
      expect(lines, key).toBeDefined();
      expect(lines.length, key).toBeGreaterThanOrEqual(2);
      expect(lines.length, key).toBeLessThanOrEqual(5);
      for (const l of lines) {
        expect(l, key).not.toMatch(/…|\.\.\.|%|\d+ ?percent/);
        expect(l, key).toMatch(/\.$/);
      }
    }
  });
  it("advances one line per step and holds the last line; reduced motion stays on the first", () => {
    expect(narrationLine("ladder", 0)).toBe("Reading your brief.");
    expect(narrationLine("ladder", NARRATION_STEP_MS)).toBe("Checking your proof and real numbers.");
    expect(narrationLine("ladder", NARRATION_STEP_MS * 40)).toBe("Checking every claim against what you gave it.");
    expect(narrationLine("ladder", NARRATION_STEP_MS * 40, true)).toBe("Reading your brief.");
    expect(narrationLine("key_check", 0)).toBeNull();
  });
});
