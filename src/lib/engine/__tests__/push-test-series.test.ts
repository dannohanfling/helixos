import { describe, expect, it } from "vitest";
import { PUSH_PATH, PUSH_TYPES, TEST_GAP_MINUTES, TEST_KEY_PREFIX, testSeries } from "@/lib/engine/push";

describe("a coach's test series (H-1967)", () => {
  const start = new Date("2026-10-24T18:00:00Z");
  const s = testSeries(start);

  it("is one push of each type, in Settings order, 3 minutes apart, starting now", () => {
    expect(TEST_GAP_MINUTES).toBe(3);
    expect(s.map((x) => x.type)).toEqual(PUSH_TYPES.map((t) => t.type));
    expect(s[0].dueAt.toISOString()).toBe(start.toISOString());
    expect(s[s.length - 1].dueAt.getTime() - start.getTime()).toBe((PUSH_TYPES.length - 1) * 3 * 60000);
  });

  it("carries the real words and the real page, titled as a test", () => {
    for (const x of s) {
      expect(x.title).toBe("Test: HelixOS");
      expect(x.path).toBe(PUSH_PATH[x.type]);
      expect(x.body.length).toBeGreaterThan(10);
      expect(x.body).not.toMatch(/undefined|—/);
    }
    expect(s.find((x) => x.type === "streak")?.body).toBe("Your 12-day streak is waiting on you.");
  });

  it("is keyed apart from real sends, so it never touches a member's daily cap", () => {
    expect(TEST_KEY_PREFIX).toBe("test:");
  });
});
