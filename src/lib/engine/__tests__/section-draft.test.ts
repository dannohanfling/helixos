import { describe, expect, it } from "vitest";
import { SLIDES_MARK, checkSlides, deckSafe, keyPointsText, needsSlides, offerBlock, parseSectionDraft, slideCountFor, slideLines } from "../section-draft";
import { sentencesIn, stripFabricated } from "../blacklist";

describe("the draft writes the slides too (first-deck brief §2)", () => {
  it("reads the script and the deck lines back from one reply", () => {
    const r = parseSectionDraft(`Line one of the script.\nLine two.\n\n${SLIDES_MARK}\n- Sleep is a skill\n• You can learn it\n3. [PROOF PLACEHOLDER]\n`);
    expect(r.script).toBe("Line one of the script.\nLine two.");
    expect(r.slides).toEqual(["Sleep is a skill", "You can learn it", "[PROOF PLACEHOLDER]"]);
    expect(parseSectionDraft("Only a script.")).toEqual({ script: "Only a script.", slides: null });
    expect(parseSectionDraft(`Script.\n${SLIDES_MARK}\n\n`)).toEqual({ script: "Script.", slides: null });
    expect(slideLines("- **Bold line**\n\n- plain")).toEqual(["Bold line", "plain"]);
  });
  it("keeps a figure only when the record or the script has it, drops a line too long, and says each once", () => {
    const known = "Runtime 76 minutes. Price: $1,997. The 30-Day Sleep Reset.";
    const r = checkSlides(["The 30-Day Sleep Reset", "Clients sleep 47% better", "Yours for $1,997", "x".repeat(141), "the 30-day sleep reset", "[PROOF PLACEHOLDER]"], known);
    expect(r.kept).toEqual(["The 30-Day Sleep Reset", "Yours for $1,997", "[PROOF PLACEHOLDER]"]);
    expect(r.dropped.map((d) => d.why)).toEqual(["figure", "long"]);
    expect(keyPointsText(["A", "B"])).toBe("• A\n• B");
  });
  it("keeps only lines the deck can export: no placeholder on a proof or price slide, none inside a number", () => {
    expect(deckSafe(["What changed for them", "[PROOF PLACEHOLDER]"], "Proof Block (Internal)")).toEqual(["What changed for them"]);
    expect(deckSafe(["Yours today for $297", "[OFFER PLACEHOLDER]"], "Offer Stack + CTA")).toEqual(["Yours today for $297"]);
    // A line that is only a placeholder is no slide line either (deck re-test §2): the deck draws the gap, the panel names it.
    expect(deckSafe(["[STORY PLACEHOLDER]", "Clients gained [X]% in a week"], "Hook")).toEqual([]);
    expect(deckSafe(["Her story: [STORY PLACEHOLDER]"], "Hook")).toEqual(["Her story: [STORY PLACEHOLDER]"]);
  });
  it("asks for about one slide per two minutes, two to six", () => {
    expect([1, 4, 5, 8, 30].map(slideCountFor)).toEqual([2, 2, 3, 4, 6]);
  });
  it("offers Make slides only for a scripted section with no key points", () => {
    expect(needsSlides({ script: "Words.", keyPoints: null })).toBe(true);
    expect(needsSlides({ script: "Words.", keyPoints: "• One" })).toBe(false);
    expect(needsSlides({ script: "  ", keyPoints: null })).toBe(false);
    expect(needsSlides({ script: "Words.", keyPoints: null, status: "omitted" })).toBe(false);
  });
  it("gives the closing frame the offer from the record, or a placeholder with none linked", () => {
    expect(offerBlock(null)).toContain("[OFFER PLACEHOLDER]");
    const b = offerBlock({ name: "30-Day Sleep Reset", price: 297, currency: "USD", container: "A 30-day group program", guarantee: "30 days, money back", paymentPlan: null, scarcity: null, urgency: null, ctaFooter: "Join at rootedrest.com", forYouIf: null, notForYouIf: null, objections: [], components: [{ name: "Wind-down audio", type: "bonus", perceivedValue: 97, beliefBreak: "vehicle", oneLiner: "Ten minutes a night" }, { name: "Group calls", type: "core", perceivedValue: 900, beliefBreak: "internal" }] });
    expect(b).toContain("Price: $297");
    expect(b).toContain("- Wind-down audio ($97 value): Ten minutes a night");
    expect(b).toContain("Total value: $997");
    expect(b).toContain("Call to action: Join at rootedrest.com");
  });
});

describe("the sentence split loses nothing (\"2 a.m.\" stayed \"2 a.m.\")", () => {
  it("keeps abbreviations inside their sentence and every character of the line", () => {
    for (const line of ["You stare at the ceiling at 2 a.m. again. Nothing works.", "Try it, e.g. tonight. In the U.S. it's common!", "...and then?", "No full stop at all", "Ends with dots..."]) {
      expect(sentencesIn(line).join("")).toBe(line);
      expect(stripFabricated(line).text).toBe(line.trim());
    }
    expect(sentencesIn("At 2 a.m. again. Nothing works.")).toEqual(["At 2 a.m. ", "again. ", "Nothing works."]);
  });
});
