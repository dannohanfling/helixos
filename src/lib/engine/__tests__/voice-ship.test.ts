import { describe, expect, it } from "vitest";
import { channelSet, checksLine, dateWindow, findImages, fingerprint, firstLines, numbered } from "../voice-ship";

const ladder = { headline: "THREE CALLS / FROM ONE POST (gold: ONE POST)", copy: "Line one\nLine two\nLine three", rungs: [{ body: "a" }, { body: "b" }], igCaption: "Caption", graphicImageId: "img1" };

describe("Voice to Ship", () => {
  it("fingerprints what a Ship would post, and any change voids it", () => {
    const f = fingerprint(ladder);
    expect(fingerprint({ ...ladder })).toBe(f);
    expect(fingerprint({ ...ladder, rungs: [{ body: "a" }, { body: "b!" }] })).not.toBe(f);
    expect(fingerprint({ ...ladder, graphicImageId: "img2" })).not.toBe(f);
    expect(fingerprint({ ...ladder, igCaption: "Other" })).not.toBe(f);
  });

  it("names one channel set however it is asked", () => {
    expect(channelSet(["instagram", "page"])).toEqual(["page", "instagram"]);
    expect(channelSet(["instagram", "instagram", "threads"])).toEqual(["instagram"]);
  });

  it("reads date words in the member's own today (a Thursday)", () => {
    expect(dateWindow("the one from last week", "2026-10-08")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(dateWindow("this week", "2026-10-08")).toEqual({ from: "2026-10-05", to: "2026-10-08" });
    expect(dateWindow("yesterday", "2026-10-01")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(dateWindow("last month", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(dateWindow("the gym one", "2026-10-08")).toBeNull();
  });

  it("finds the member's images by words and by date, best first, never a logo", () => {
    const imgs = [
      { id: "a", kind: "photo", caption: "Me at the gym, morning", createdAt: "2026-10-01 09:00:00" },
      { id: "b", kind: "photo", caption: "Gym floor wide shot", createdAt: "2026-09-20 09:00:00" },
      { id: "c", kind: "photo", caption: "Coffee with a client", createdAt: "2026-10-06T10:00:00Z" },
      { id: "d", kind: "logo", caption: "gym logo", createdAt: "2026-10-07 10:00:00" },
    ];
    expect(findImages(imgs, "use my gym photo", "2026-10-08").map((i) => i.id)).toEqual(["a", "b"]);
    expect(findImages(imgs, "the gym one from last week", "2026-10-08").map((i) => i.id)).toEqual(["a"]);
    expect(findImages(imgs, "this week", "2026-10-08").map((i) => i.id)).toEqual(["c"]);
    expect(findImages(imgs, "a sailboat", "2026-10-08")).toEqual([]);
  });

  it("speaks the checks, the first lines and numbered choices", () => {
    expect(checksLine([{ key: "a", label: "Ends in a question", ok: true, level: "fail", note: "" }])).toBe("checks passed");
    expect(checksLine([{ key: "a", label: "Ends in a question", ok: false, level: "fail", note: "Add one." }, { key: "b", label: "Rung length", ok: false, level: "warn", note: "" }])).toBe("1 check to fix: Ends in a question (Add one.)");
    expect(firstLines("Line one\n\nLine two\nLine three")).toBe("Line one / Line two");
    expect(numbered(["first", "second"])).toBe("1. first\n2. second");
  });
});
