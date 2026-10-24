import { describe, expect, it } from "vitest";
import { numberRung, numberRungs } from "../rung-number";
import { rungsPlain } from "../ladder";
import { dripPayload, rungsPayload } from "../rung-drip";

describe("rung numbers (H-1944)", () => {
  it("adds the number once, on the same line as the first sentence", () => {
    expect(numberRung("You taught for an hour.\n\nYou gave your best stuff.", 1)).toBe("1. You taught for an hour.\n\nYou gave your best stuff.");
  });
  it("never doubles a number already there, and turns 1/ into 1.", () => {
    expect(numberRung("1. You taught.", 1)).toBe("1. You taught.");
    expect(numberRung("1) You taught.", 1)).toBe("1. You taught.");
    expect(numberRung("1\\. You taught.", 1)).toBe("1. You taught.");
    expect(numberRung("1/ You taught.", 1)).toBe("1. You taught.");
    expect(numberRung("7. Stale number.", 2)).toBe("2. Stale number.");
  });
  it("leaves numbers that are part of the text, and steps inside the rung", () => {
    expect(numberRung("24/7 is not a plan.", 3)).toBe("3. 24/7 is not a plan.");
    expect(numberRung("1.5 million views later.", 1)).toBe("1. 1.5 million views later.");
    expect(numberRung("Do three things.\n1) Write it.\n2) Post it.", 4)).toBe("4. Do three things.\n1) Write it.\n2) Post it.");
  });
  it("follows position after a reorder, an add and a remove", () => {
    expect(numberRungs(["Second.", "First."])).toEqual(["1. Second.", "2. First."]);
    expect(numberRungs(["A.", "B.", "C."])).toEqual(["1. A.", "2. B.", "3. C."]);
    expect(numberRungs(["A.", "C."])).toEqual(["1. A.", "2. C."]);
    expect(rungsPlain([{ n: 5, body: "Moved up." }, { n: 1, body: "1/ Moved down." }])).toBe("1. Moved up.\n---\n2. Moved down.");
  });
  it("Ship's rungs-only hand-off and the older drip both carry 1. on rung 1", () => {
    expect(rungsPayload({ userNs: "u", rungs: ["You taught for an hour.", "1/ Then what."] }).rungs).toEqual(["1. You taught for an hour.", "2. Then what."]);
    const d = dripPayload({ userNs: "u", post: "P", rungs: ["You taught for an hour.", "Then what."], fbIgPublisher: "helixos" });
    expect(d.first_comment).toBe("1. You taught for an hour.");
    expect(d.rungs.startsWith("1. You taught for an hour.")).toBe(true);
  });
});
