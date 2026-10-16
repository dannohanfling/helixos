import { describe, expect, it } from "vitest";
import { HEADLINE_WORDS, headlineOf, headlineSize } from "../headline";

const long = "Every yes is a no to something else, and this month you have said yes to four things that each need a morning. Pick the one that pays the others. What are you saying no to?";

describe("the plaque's one line (H-306)", () => {
  it("keeps the AI's headline when it fits the cap, and ignores one that doesn't", () => {
    expect(headlineOf(long, "Every yes is a no: pick the one that pays the others.")).toBe("Every yes is a no: pick the one that pays the others.");
    const tooLong = Array.from({ length: HEADLINE_WORDS + 1 }, (_, i) => `w${i}`).join(" ");
    expect(headlineOf(long, tooLong)).toBe("Every yes is a no to something else, and this month you have said yes to four things that each need a morning.");
    expect(headlineOf(long, "   ")).toBe("Every yes is a no to something else, and this month you have said yes to four things that each need a morning.");
  });
  it("cuts an old answer at the first sentence end under the cap, never mid-word", () => {
    expect(headlineOf("Fit it to your hours: one thing first, then the next.")).toBe("Fit it to your hours: one thing first, then the next.");
    expect(headlineOf("Start small. Then measure. Then double what worked, and only that.")).toBe("Start small. Then measure. Then double what worked, and only that.");
    const h = headlineOf(long);
    expect(h.split(/\s+/).length).toBeLessThanOrEqual(HEADLINE_WORDS);
    expect(h.endsWith(".")).toBe(true);
    // One long sentence: the first 25 words and an ellipsis, a trailing comma dropped.
    const oneSentence = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five, twenty-six twenty-seven.";
    expect(headlineOf(oneSentence)).toBe("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five…");
    expect(headlineOf("")).toBe("");
  });
  it("sizes the type by the line's length", () => {
    expect(headlineSize("Short.")).toBe("l");
    expect(headlineSize("x".repeat(100))).toBe("m");
    expect(headlineSize("x".repeat(140))).toBe("s");
  });
});
