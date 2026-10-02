import { describe, expect, it } from "vitest";
import { brandKitProblems, brandKitWarnings, contrastRatio, fillRuntime, fixContrast, kitProposals, knownReferences, nameMismatch } from "../subject";

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
    // The first name alone, and the way a script actually opens: "Danno here,"
    expect(nameMismatch("I'm Danno. Let's get into it.", "Lindsey Brittain")?.found).toBe("Danno");
    expect(nameMismatch("Danno here, and welcome.", "Lindsey Brittain")?.found).toBe("Danno");
    expect(nameMismatch("Welcome everyone. Danno Hanfling here.", "Lindsey Brittain")?.found).toBe("Danno Hanfling");
    expect(nameMismatch("Lindsey here, and welcome.", "Lindsey Brittain")).toBeNull();
    expect(nameMismatch("Right here, right now. Welcome.", "Lindsey Brittain")).toBeNull();
    expect(nameMismatch("Today we start here.", "Lindsey Brittain")).toBeNull();
    expect(nameMismatch(null, "Lindsey Brittain")).toBeNull();
    expect(nameMismatch("I'm Danno.", "")).toBeNull();
  });
  it("a permitted name opens a script with no warning and is never reported as the presenter", () => {
    expect(nameMismatch("Turas here. I'm Turas and this is for you.", "Lindsey Brittain", ["Turas"])).toBeNull();
    expect(nameMismatch("I'm Turas and this is for you.", "Lindsey Brittain")).toEqual({ found: "Turas", presenter: "Lindsey Brittain" });
    expect(nameMismatch("I'm Danno Hanfling.", "Lindsey Brittain", ["Turas"])).toEqual({ found: "Danno Hanfling", presenter: "Lindsey Brittain" });
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
    // Muted is text too, so it is refused; the accent pairs warn with the ratio and are never refused; a banned colour in an inverse role is caught
    expect(brandKitProblems({ ...turas, muted: "D6D3CE" })).toEqual(["muted on ground is 1.41:1; it needs 4.5:1 to read on a slide."]);
    expect(brandKitProblems({ ...turas, inverseGround: "000000" })).toEqual(["inverseGround is 000000, which this brand bans."]);
    // Heartfire Red reads on Clarity White; on Grounded Taupe it is the 1.24:1 eyebrow a human once caught on a render
    expect(brandKitWarnings(turas)).toEqual(["accent on inverseGround is 1.24:1: not for text on a full-bleed slide."]);
    expect(brandKitWarnings({ ground: "FAF8F5", accent: "F2A4A4", inverseGround: null })).toEqual(["accent on ground is 1.87:1: too light for small text, so the deck uses it for rules and buttons only, never for words."]);
    expect(brandKitWarnings({ ground: "FFFFFF", accent: "000000", inverseGround: null })).toEqual([]);
  });
});

describe("§6.1: the contrast check proposes a fix", () => {
  it("moves a text colour toward black on a light ground until it reads, and gives a reading colour back as it is", () => {
    const fixed = fixContrast("9CA3AF", "FAF8F5")!;
    expect(contrastRatio(fixed, "FAF8F5")).toBeGreaterThanOrEqual(4.5);
    expect(fixed < "9CA3AF").toBe(true); // darker
    expect(fixContrast("6E6256", "FAF8F5")).toBe("6E6256");
    expect(fixContrast("not", "FAF8F5")).toBeNull();
  });

  it("moves toward white on a dark ground", () => {
    const fixed = fixContrast("555555", "111111")!;
    expect(contrastRatio(fixed, "111111")).toBeGreaterThanOrEqual(4.5);
    expect(parseInt(fixed.slice(0, 2), 16)).toBeGreaterThan(0x55);
  });

  it("names the pair, the ratio and the colour to try, with the field it goes in; an accent is explained, never refused", () => {
    const out = kitProposals({ ground: "FAF8F5", ink: "9CA3AF", accent: "F2A4A4", muted: "4B5563", inverseGround: null, inverseInk: null });
    expect(out[0].field).toBe("ink");
    expect(out[0].text).toMatch(/^ink on ground is 2\.4:1 and needs 4\.5:1 to read on a slide\. Try [0-9A-F]{6} for ink\.$/);
    expect(out[0].value).toBe(fixContrast("9CA3AF", "FAF8F5"));
    expect(out[1].field).toBeUndefined();
    expect(out[1].text).toMatch(/^Your accent is too light for small text \(.*:1 on your ground\); the deck uses it for rules and buttons only, never for words\.$/);
    expect(kitProposals({ ground: "FAF8F5", ink: "6E6256", accent: "DD2727", muted: "4B5563", inverseGround: "6E6256", inverseInk: "FAF8F5" })).toEqual([
      { text: "On full-bleed slides your accent is 1.24:1 against inverseGround: rules only there, never words." },
    ]);
    expect(kitProposals({ ground: "FFFFFF", ink: "111111", accent: "000000", muted: "444444", inverseGround: "", inverseInk: "" })).toEqual([]);
  });
});

