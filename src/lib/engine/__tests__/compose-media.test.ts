import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALT_WARNING, ILLUSTRATIVE_LABEL, ILLUSTRATIVE_MARK, NOT_A_URL_REFUSAL, PRIVATE_MEDIA_NOTE, PRIVATE_URL_REFUSAL, downloadUrlFor, mediaBlock, mediaUrlFor, mediaUrlProblem, mediaWarning, type ComposerMedia } from "../compose-media";

const media = (patch: Partial<ComposerMedia> = {}): ComposerMedia => ({
  id: "att1",
  proofId: "p1",
  proofTitle: "Maya's 90 days",
  kind: "image",
  label: "Maya's 90 days · before-after.jpg",
  url: "/api/proofs/attachments/att1",
  downloadUrl: "/api/proofs/attachments/att1?download=1",
  hasAlt: true,
  showsAResult: false,
  ...patch,
});

describe("a picked file that shows a result carries the ladder's dollar-figure rule", () => {
  it("blocks when the file shows a result and the post does not say illustrative; the block names the checklist label and the marker", () => {
    const b = mediaBlock(media({ showsAResult: true }), "Here is what happened at day 90.");
    expect(b).not.toBeNull();
    expect(b?.split("\n")[0]).toBe(ILLUSTRATIVE_LABEL);
    expect(b).toContain(ILLUSTRATIVE_MARK);
    expect(b).toBe(`${ILLUSTRATIVE_LABEL}\nAn attached file shows a result. Add ${ILLUSTRATIVE_MARK} to the post, in every version that goes out.`);
  });
  it("reads every version that goes out: a channel that cut the marker blocks even when the source carries it", () => {
    expect(mediaBlock(media({ showsAResult: true }), [`Day 90.\n${ILLUSTRATIVE_MARK}`, "Day 90."])).not.toBeNull();
    expect(mediaBlock(media({ showsAResult: true }), [`Day 90.\n${ILLUSTRATIVE_MARK}`, `Day 90. ${ILLUSTRATIVE_MARK}`])).toBeNull();
    expect(mediaBlock(media({ showsAResult: true }), [])).not.toBeNull();
  });
  it("a typed media address must be a public web address and never one of our private routes", () => {
    expect(mediaUrlProblem("")).toBeNull();
    expect(mediaUrlProblem("https://cdn.example.com/photo.jpg")).toBeNull();
    expect(mediaUrlProblem("/api/proofs/attachments/att1?download=1")).toBe(PRIVATE_URL_REFUSAL);
    expect(mediaUrlProblem("https://helixos.app/api/proofs/attachments/att1")).toBe(PRIVATE_URL_REFUSAL);
    expect(mediaUrlProblem("photo.jpg")).toBe(NOT_A_URL_REFUSAL);
  });
  it("does not block when the marker is in the post, in any case", () => {
    expect(mediaBlock(media({ showsAResult: true }), `Day 90.\n${ILLUSTRATIVE_MARK}`)).toBeNull();
    expect(mediaBlock(media({ showsAResult: true }), "These numbers are ILLUSTRATIVE and yours will differ.")).toBeNull();
  });
  it("does not block with no media, or a file that shows no result", () => {
    expect(mediaBlock(null, "Any $4,000 claim here is another check's business.")).toBeNull();
    expect(mediaBlock(media({ showsAResult: false }), "Day 90.")).toBeNull();
  });
  it("a video that shows a result blocks the same way: the rule is about the result, not the format", () => {
    expect(mediaBlock(media({ kind: "video", showsAResult: true }), "Watch this.")).not.toBeNull();
    expect(mediaBlock(media({ kind: "video", showsAResult: true }), `Watch this. ${ILLUSTRATIVE_MARK}`)).toBeNull();
  });
});

describe("alt text warns and never blocks", () => {
  it("warns for an image with no alt text only", () => {
    expect(mediaWarning(media({ hasAlt: false }))).toBe(ALT_WARNING);
    expect(mediaWarning(media({ hasAlt: true }))).toBeNull();
    expect(mediaWarning(media({ kind: "video", hasAlt: false }))).toBeNull();
    expect(mediaWarning(null)).toBeNull();
  });
  it("an image with no alt text and no result warns without blocking", () => {
    const m = media({ hasAlt: false, showsAResult: false });
    expect(mediaWarning(m)).toBe(ALT_WARNING);
    expect(mediaBlock(m, "Day 90.")).toBeNull();
  });
});

describe("the words are verbatim", () => {
  it("the constants say exactly what the brief says", () => {
    expect(ILLUSTRATIVE_LABEL).toBe("Dollar figures are real numbers or marked illustrative");
    expect(ILLUSTRATIVE_MARK).toBe("(Illustrative. Your numbers will differ.)");
    expect(ALT_WARNING).toBe("This image goes out with no alt text. A screen reader will say nothing about it.");
    expect(PRIVATE_MEDIA_NOTE).toBe("GoHighLevel needs a public address for media. This file lives in private storage: download it and add it in the Social Planner. It is not sent from here.");
  });
  it("the label and the marker are the ladder's own, so the two gates cannot drift apart", () => {
    const ladder = readFileSync(join(__dirname, "..", "ladder.ts"), "utf8");
    expect(ladder).toContain(`"illustrative", "${ILLUSTRATIVE_LABEL}"`);
    expect(ladder).toContain(ILLUSTRATIVE_MARK);
  });
});

describe("the read route is the only address a picked file has", () => {
  it("previews through the authenticated route, a HEIC as its rendition, and downloads the original", () => {
    expect(mediaUrlFor({ id: "a1", displayKey: null })).toBe("/api/proofs/attachments/a1");
    expect(mediaUrlFor({ id: "a1", displayKey: "proofs/ws/p/a1-display.jpg" })).toBe("/api/proofs/attachments/a1?display=1");
    expect(downloadUrlFor({ id: "a1" })).toBe("/api/proofs/attachments/a1?download=1");
  });
});
