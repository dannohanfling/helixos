import { describe, expect, it } from "vitest";
import { GRAPHIC, antonWidth, backgroundPrompt, canGenerateBackground, fitHeadline, goldGradient, graphicCaption, headlineChoices, layoutHeadline, paintLine, photoChoices, pickPhoto, type PhotoCandidate } from "../graphic";

/** Make the graphic (rev 513, 514, 524): the template's fit, the gold phrase, the caption, the photo match and the words. */
const img = (over: Partial<PhotoCandidate> & Pick<PhotoCandidate, "id">): PhotoCandidate => ({ kind: "photo", caption: null, width: 1200, height: 1600, createdAt: "2026-10-01T00:00:00.000Z", source: "upload", ...over });

describe("Make the graphic", () => {
  it("fits the headline: two short lines take the largest size, long ones step down by two until both fit, never under the smallest", () => {
    expect(antonWidth("A", 100)).toBeGreaterThan(40);
    expect(antonWidth("AAAA", 100)).toBeCloseTo(antonWidth("A", 100) * 4, 3);
    expect(fitHeadline(["IF I LOST IT ALL", "HERE IS DAY ONE"])).toBe(GRAPHIC.headlineMaxPx);
    const long = fitHeadline(["IF I LOST EVERY CLIENT AND EVERY DOLLAR TOMORROW", "THIS IS EXACTLY WHAT I WOULD DO ON DAY ONE"]);
    expect(long).toBeLessThan(GRAPHIC.headlineMaxPx);
    expect(long % 2).toBe(0);
    expect(antonWidth("IF I LOST EVERY CLIENT AND EVERY DOLLAR TOMORROW", long)).toBeLessThanOrEqual(GRAPHIC.headlineMaxWidth);
    expect(antonWidth("IF I LOST EVERY CLIENT AND EVERY DOLLAR TOMORROW", long + 2)).toBeGreaterThan(GRAPHIC.headlineMaxWidth);
    expect(fitHeadline(["A".repeat(200)])).toBe(GRAPHIC.headlineMinPx);
  });
  it("paints the one gold phrase inside its line, in capitals; a one-line headline splits at its middle", () => {
    expect(paintLine("If I lost it all tomorrow", "tomorrow")).toEqual([{ text: "IF I LOST IT ALL ", gold: false }, { text: "TOMORROW", gold: true }]);
    expect(paintLine("Here is day one", "tomorrow")).toEqual([{ text: "HERE IS DAY ONE", gold: false }]);
    const l = layoutHeadline("If I lost it all tomorrow / Here is day one (gold: day one)");
    expect(l.lines.map((segs) => segs.map((s) => s.text).join(""))).toEqual(["IF I LOST IT ALL TOMORROW", "HERE IS DAY ONE"]);
    expect(l.lines[1].find((s) => s.gold)?.text).toBe("DAY ONE");
    expect(layoutHeadline("Five mistakes I made building my first group").lines.map((segs) => segs[0].text)).toEqual(["FIVE MISTAKES I MADE", "BUILDING MY FIRST GROUP"]);
    expect(graphicCaption("If I lost it all tomorrow / Here is day one (gold: day one)")).toBe("If I lost it all tomorrow Here is day one");
    expect(goldGradient(null, null)).toContain("#dda338");
    expect(goldGradient("AABBCC", "#112233")).toBe("linear-gradient(90deg, #AABBCC, #112233)");
    expect(goldGradient("nope", "#112233")).toContain("#c5801f");
  });
  it("picks the photo whose caption shares the headline's words, photos before other kinds, never a proof or a screenshot, AI backgrounds last among equals", () => {
    const images = [
      img({ id: "old", caption: "Me on stage at the summit", createdAt: "2026-09-01T00:00:00.000Z" }),
      img({ id: "new", caption: "Desk at night", createdAt: "2026-10-05T00:00:00.000Z" }),
      img({ id: "proof", kind: "proof", caption: "Stage results screenshot" }),
      img({ id: "shot", kind: "screenshot", caption: "On stage" }),
      img({ id: "ai", caption: "AI background: stage lights", source: "ai", createdAt: "2026-10-06T00:00:00.000Z" }),
      img({ id: "render", kind: "graphic", source: "render", caption: "Stage headline" }),
    ];
    expect(pickPhoto("What the stage taught me / about selling", images)?.id).toBe("old");
    expect(pickPhoto("Nothing matches these words", images)?.id).toBe("new");
    expect(pickPhoto("x", [img({ id: "p1", kind: "proof" })])).toBeNull();
    expect(photoChoices("What the stage taught me", images).map((i) => i.id)).toEqual(["old", "new", "ai"]);
    expect(pickPhoto("stage", [img({ id: "ai2", caption: "stage", source: "ai" }), img({ id: "real", caption: "stage" })])?.id).toBe("real");
  });
  it("the words: the background prompt names the scene and forbids people and text; only an OpenAI key can make one; headline choices are each once", () => {
    const p = backgroundPrompt("If I lost it all / tomorrow (gold: tomorrow)", "rebuild");
    expect(p).toContain("If I lost it all tomorrow");
    expect(p).toMatch(/No people, no faces/);
    expect(backgroundPrompt("", "rebuild")).toContain("rebuild");
    expect(canGenerateBackground("openai")).toBe(true);
    expect(canGenerateBackground("anthropic")).toBe(false);
    expect(canGenerateBackground(null)).toBe(false);
    expect(headlineChoices(" A / B ", ["A / B", "C", "", "C"])).toEqual(["A / B", "C"]);
  });
});
