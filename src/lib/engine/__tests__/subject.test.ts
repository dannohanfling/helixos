import { describe, expect, it } from "vitest";
import { brandKitProblems, contrastRatio, fillRuntime, knownReferences, nameMismatch } from "../subject";

describe("the subject: what still resolves, who presents, what the brand allows", () => {
  it("builds every known id in one place: approved proofs only, bank and Essence stories, own and shared studies, offers", () => {
    const known = knownReferences({
      proofs: [{ id: "p1", status: "approved" }, { id: "p2", status: "draft" }],
      stories: [{ id: "s1" }],
      essenceStories: [{ name: "The Glue" }, { name: "", summary: "" }, { summary: "Kept" }],
      citable: [{ id: "e1", source: "own" }, { id: "sh1", source: "shared" }],
      offers: [{ id: "o1" }],
    });
    expect(known).toEqual({ proofIds: ["p1"], storyIds: ["s1", "essence:0", "essence:1"], evidenceIds: ["e1", "shared:sh1"], offerIds: ["o1"] });
  });
  it("catches a script that introduces someone other than the presenter, and lets the presenter's own name and ordinary 'I'm' pass", () => {
    expect(nameMismatch("I'm Danno Hanfling, and I've spent fifteen years helping people.", "Lindsey Brittain")).toEqual({ found: "Danno Hanfling", presenter: "Lindsey Brittain" });
    expect(nameMismatch("I'm Lindsey Brittain, and I work with leaders.", "Lindsey Brittain")).toBeNull();
    expect(nameMismatch("I'm Lindsey, and I work with leaders.", "Lindsey Brittain")).toBeNull();
    expect(nameMismatch("I'm Not here to sell you. I'm Going to show you.", "Lindsey Brittain")).toBeNull();
    expect(nameMismatch("My name is Kate Amos.", "Lindsey Brittain")?.found).toBe("Kate Amos");
    expect(nameMismatch(null, "Lindsey Brittain")).toBeNull();
    expect(nameMismatch("I'm Danno.", "")).toBeNull();
  });
  it("fills the numbers the record knows into coaching copy that carries a slot for them", () => {
    expect(fillRuntime("Earn the next {runtime} minutes. You have about {openingMinutes} minutes.", { runtime: 76, openingMinutes: 7 })).toBe("Earn the next 76 minutes. You have about 7 minutes.");
  });
  it("contrast is WCAG's ratio, and a kit is refused with the pair named when ink cannot read on ground", () => {
    expect(contrastRatio("FFFFFF", "000000")).toBe(21);
    expect(contrastRatio("#FAF8F5", "6E6256")).toBeGreaterThan(4.5);
    const turas = { name: "Turas — True North", ground: "FAF8F5", ink: "6E6256", accent: "DD2727", muted: "4B5563", surface: "ECE9E5", inverseGround: "6E6256", inverseInk: "FAF8F5", displayFont: "Red Hat Display", bodyFont: "Helvetica Now Display", quoteFont: "Libre Baskerville", fontFallback: "Arial", bannedColors: ["000000"] };
    expect(brandKitProblems(turas)).toEqual([]);
    // Ash grey on cream: the pair a human caught on a render, refused here before anyone looks
    expect(brandKitProblems({ ...turas, ink: "9CA3AF" })).toEqual(["ink on ground is 2.4:1; it needs 4.5:1 to read on a slide."]);
    expect(brandKitProblems({ ...turas, ink: "000000" })).toEqual(["ink is 000000, which this brand bans."]);
    expect(brandKitProblems({ ...turas, ground: "cream", fontFallback: "" })).toEqual(["ground needs a six-digit hex colour, like 6E6256.", "Name the fallback face: it is what the file names when a brand face is missing on the reader's machine."]);
    expect(brandKitProblems({ ...turas, inverseInk: "6E6256" })).toEqual(["inverseInk on inverseGround is 1:1; it needs 4.5:1."]);
  });
});
