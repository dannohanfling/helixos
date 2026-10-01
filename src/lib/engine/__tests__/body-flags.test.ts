import { describe, expect, it } from "vitest";
import { DAY_FLAGS, FLAG_ICON, FLAG_LABEL, flagText, isDayFlag } from "@/lib/engine/body-flags";

describe("day flags (rev 237 phase 15)", () => {
  it("knows travel and illness, each with a word and a mark, and nothing else", () => {
    expect(DAY_FLAGS).toEqual(["travel", "illness"]);
    expect(isDayFlag("travel") && isDayFlag("illness")).toBe(true);
    expect(isDayFlag("injury")).toBe(false);
    expect(flagText("travel")).toBe(`${FLAG_ICON.travel} ${FLAG_LABEL.travel}`);
    expect(flagText("illness")).toBe("🤒 Ill");
    expect(flagText(null)).toBe("");
    expect(flagText("other")).toBe("");
  });
});
