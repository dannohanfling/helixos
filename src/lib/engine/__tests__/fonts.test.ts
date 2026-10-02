import { describe, expect, it } from "vitest";
import { DECK_FONTS, GOOGLE_FONTS, OTHER_FONT, SAFE_FONTS, isListedFont, otherFontLine } from "../fonts";

describe("§6.1: the faces a kit can pick from", () => {
  it("lists the safe faces first, then the Google faces, no face twice, and knows which are listed", () => {
    expect(DECK_FONTS.slice(0, SAFE_FONTS.length)).toEqual([...SAFE_FONTS]);
    expect(DECK_FONTS.length).toBe(SAFE_FONTS.length + GOOGLE_FONTS.length);
    expect(new Set(DECK_FONTS).size).toBe(DECK_FONTS.length);
    expect(isListedFont("Red Hat Display")).toBe(true);
    expect(isListedFont(" Arial ")).toBe(true);
    expect(isListedFont("Helvetica Now Display")).toBe(false);
    expect(DECK_FONTS.includes(OTHER_FONT)).toBe(false);
  });

  it("says who will not see a licensed face, and what they see instead", () => {
    expect(otherFontLine("Arial")).toBe("People without this font installed will see Arial.");
    expect(otherFontLine("  ")).toBe("People without this font installed will see Arial.");
    expect(otherFontLine("Georgia")).toBe("People without this font installed will see Georgia.");
  });
});
