import { describe, expect, it } from "vitest";
import { fitSize, linesFit, linesFor } from "../deck-fit-text";

describe("whether text fits its box (deck visuals §4)", () => {
  it("counts lines from the box's width and the size, words wrapping whole", () => {
    // 4.5 in at 40pt: 324pt / 20pt = 16 characters a line.
    expect(linesFor("Name the drift", 4.5, 40)).toBe(1);
    expect(linesFor("Vehicle Story — From Tactics to Journeys", 4.5, 40)).toBe(3);
    expect(linesFor("a\nb", 9, 18)).toBe(2);
    expect(linesFor("", 9, 18)).toBe(1);
  });
  it("fits by height: three 40pt lines are 144pt, over a 1.5 in box", () => {
    expect(linesFit(3, 40, 1.5)).toBe(false);
    expect(linesFit(2, 40, 1.5)).toBe(true);
  });
  it("steps the size down until the text fits, and says so when even the floor overflows", () => {
    expect(fitSize("Name the drift", { w: 4.5, h: 1.5 }, [40, 32, 26, 22])).toBe(40);
    expect(fitSize("Vehicle Story — From Tactics to Journeys", { w: 4.5, h: 1.5 }, [40, 32, 26, 22])).toBe(32);
    const long = Array(12).fill("a long bullet about the thing we did that week and what it changed").join("\n");
    expect(fitSize(long, { w: 4.3, h: 2.4 }, [18, 16, 14])).toBeNull();
  });
});
