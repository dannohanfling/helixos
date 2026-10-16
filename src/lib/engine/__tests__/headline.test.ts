import { describe, expect, it } from "vitest";
import { HEADLINE_WORDS, PLAQUE_CHARS, headlineOf, headlineSize, plaqueTextOf } from "../headline";

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

describe("the card under the scene (H-433): the whole recommendation and the first step, at a sentence end", () => {
  const rec = "Put this week into DMs to the people already on your list, nothing else. Then, once ten have answered, write the one-line offer and book the three calls.";
  it("shows the whole recommendation and the first step when they fit", () => {
    expect(plaqueTextOf(rec, "Send ten DMs before Friday")).toBe(`${rec} Next: Send ten DMs before Friday.`);
    expect(plaqueTextOf(rec)).toBe(rec);
    expect(plaqueTextOf("No full stop at the end", "Do it.")).toBe("No full stop at the end. Next: Do it.");
  });
  it("cuts at a sentence end under the cap, never mid-word, and keeps a long single sentence on a word with an ellipsis", () => {
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${i + 1} of the recommendation says one more useful thing about the plan.`).join(" ");
    const cut = plaqueTextOf(long, "A step.");
    expect(cut.length).toBeLessThanOrEqual(PLAQUE_CHARS);
    expect(cut.endsWith(".")).toBe(true);
    expect(long.startsWith(cut)).toBe(true);
    const one = Array.from({ length: 90 }, (_, i) => `word${i + 1}`).join(" ");
    const cutOne = plaqueTextOf(one);
    expect(cutOne.length).toBeLessThanOrEqual(PLAQUE_CHARS);
    expect(cutOne.endsWith("…")).toBe(true);
    expect(one.startsWith(cutOne.slice(0, -1))).toBe(true);
    expect(plaqueTextOf("")).toBe("");
  });
});
