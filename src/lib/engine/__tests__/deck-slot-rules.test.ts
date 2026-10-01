import { describe, expect, it } from "vitest";
import { COVER_WHAT, MAX_SLOT_RUN, STORY_WHAT, figurePhrase, originWhat, slotForLine, spreadSlots } from "../deck-slot-rules";

describe("which picture a slide asks for, read off its words (deck visuals §3)", () => {
  it("a figure the coach can show asks for a screenshot with it circled, the figure quoted from the line", () => {
    expect(slotForLine("602 comments on my post in 48 hours")).toEqual({ kind: "screenshot_callout", what: "A screenshot with “602 comments on my post” circled." });
    expect(slotForLine("We sent 1,838 emails and 98.2% opened.")!.what).toMatch(/^A screenshot with “We sent 1,838 emails[^”]*” circled\.$/);
    expect(slotForLine("From $50,000 to $114,400 in a quarter")!.kind).toBe("screenshot_callout");
    expect(figurePhrase("400 leads in one hour from one post")).toBe("400 leads in one hour");
  });
  it("a mechanism asks for the coach's own diagram; before and after for two photos; comments or DMs in the plural for a wall", () => {
    expect(slotForLine("The three-step system behind every launch")).toEqual({ kind: "diagram", what: "Your own diagram of the system this slide names." });
    expect(slotForLine("Her inbox before and after the swap")).toEqual({ kind: "photo_pair", what: "Two photos side by side: before and after, as this slide says." });
    expect(slotForLine("The DMs that came in that week")).toEqual({ kind: "proof_wall", what: "A wall of your real dms, the ones this slide is about." });
  });
  it("a line that names nothing to show asks for nothing: slots are suggested by the words, never by default", () => {
    expect(slotForLine("Most leaders never name the drift.")).toBeNull();
    expect(slotForLine("")).toBeNull();
    expect(COVER_WHAT).toBe("A photo of you: on stage, or on a call.");
    expect(originWhat("The wall")).toBe("A photo of you from this beat: the wall.");
    expect(STORY_WHAT).toBe("A photo of the person this story is about.");
  });
  it("spreads the slots: never more than two in a row; the cover and a testimonial are never dropped", () => {
    const slot = (kind: "photo" | "testimonial") => ({ key: "k", kind, what: "w" });
    const run = [
      { kind: "cover", slot: slot("photo") },
      { kind: "section", slot: slot("photo") },
      { kind: "section", slot: slot("photo") },
      { kind: "section", slot: slot("photo") },
      { kind: "section", slot: slot("photo") },
      { kind: "section", slot: null },
      { kind: "proof", slot: slot("testimonial") },
      { kind: "section", slot: slot("photo") },
      { kind: "section", slot: slot("photo") },
      { kind: "section", slot: slot("photo") },
    ];
    const kept = spreadSlots(run).map((s) => Boolean(s.slot));
    expect(kept).toEqual([true, true, false, true, true, false, true, true, false, true]);
    expect(MAX_SLOT_RUN).toBe(2);
    // A run never exceeds two consecutive slots.
    let longest = 0, cur = 0;
    for (const k of kept) { cur = k ? cur + 1 : 0; longest = Math.max(longest, cur); }
    expect(longest).toBe(2);
  });
});
