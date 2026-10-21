import { describe, expect, it } from "vitest";
import { BLOCKED_WORDS, hasBlockedWord, WIN_REFUSED } from "../word-filter";
import { readWin } from "../colosseum";

describe("the word filter on wins (H-745)", () => {
  it("catches a listed word, any case, as a whole word, with punctuation around it", () => {
    expect(hasBlockedWord("what a fucking week")).toBe(true);
    expect(hasBlockedWord("FUCK yes, three calls")).toBe(true);
    expect(hasBlockedWord("You're a retard.")).toBe(true);
    expect(hasBlockedWord("(porn)")).toBe(true);
    for (const w of BLOCKED_WORDS) expect(hasBlockedWord(`a ${w} b`), w).toBe(true);
  });
  it("passes a normal win, and never flags a listed word inside an innocent one", () => {
    expect(hasBlockedWord("Three calls booked from one post")).toBe(false);
    for (const t of ["Taught a class on pricing", "Scunthorpe workshop sold out", "Booked a therapist partner", "Cocktail night for clients", "Added spice to my offer", "Hired a grape grower", "Signed Dickens & Co", "Shitake farm signed up", "Rapeseed oil supplier", "Fagin's bakery", "Retargeting ads paid off", "Skunk works sprint done"]) {
      expect(hasBlockedWord(t), t).toBe(false);
    }
  });
  it("a win with one is refused where it's read, in plain words, and the list is modest", () => {
    expect(readWin("business", "Closed a fucking big deal")).toEqual({ ok: false, error: WIN_REFUSED });
    expect(WIN_REFUSED).toBe("That win can't be posted as written. Please reword it.");
    expect(readWin("community", "Helped a new member with their first post")).toEqual({ ok: true, kind: "community", text: "Helped a new member with their first post" });
    expect(BLOCKED_WORDS.length).toBeLessThan(100);
    expect(new Set(BLOCKED_WORDS).size).toBe(BLOCKED_WORDS.length);
  });
});
