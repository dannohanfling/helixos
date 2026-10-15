import { describe, expect, it } from "vitest";
import { MAX_TURN_MS, MIN_TURN_MS, turnMs } from "../board-view";

/** H-245: a speaker's turn is 10 to 15 seconds by the quote's length. */
describe("a speaker's turn", () => {
  it("a short line sits 10 s, a long one gets the full 15, the middle scales at about 200 words a minute plus 2 s", () => {
    expect(turnMs("Do it.")).toBe(MIN_TURN_MS);
    expect(turnMs(Array(12).fill("word").join(" "))).toBe(MIN_TURN_MS);
    // 30 words: 9 s to read, 2 s to settle = 11 s.
    expect(turnMs(Array(30).fill("word").join(" "))).toBe(11_000);
    expect(turnMs(Array(40).fill("word").join(" "))).toBe(14_000);
    expect(turnMs(Array(60).fill("word").join(" "))).toBe(MAX_TURN_MS);
    expect(turnMs("")).toBe(MIN_TURN_MS);
    expect(turnMs(null)).toBe(MIN_TURN_MS);
  });
});
