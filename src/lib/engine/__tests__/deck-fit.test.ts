import { describe, expect, it } from "vitest";
import { cropToSrcRect, encodePlan, fitModeFor, inches, placeImage, ratio, ratiosAgree } from "../deck-fit";

const FRAME = { x: 5.35, y: 1.05, w: 4.15, h: 3.5 }; // a content slide's picture frame, ratio 1.19

describe("which fit a picture gets (deck visuals §1)", () => {
  it("covers a photo; contains a screenshot, proof, logo or diagram", () => {
    expect(fitModeFor("photo")).toBe("cover");
    for (const k of ["screenshot", "proof", "logo", "diagram"] as const) expect(fitModeFor(k)).toBe("contain");
  });
});

describe("placing a picture in its frame", () => {
  it("covers: fills the frame and crops the excess equally from both sides, so the shown part keeps the frame's ratio", () => {
    const p = placeImage(FRAME, { w: 2830, h: 1000 }, "cover"); // a wide chart, 2.83:1
    expect(p.mode).toBe("cover");
    expect(p.box).toEqual(FRAME);
    expect(p.pads).toBe(false);
    // The height fills the frame; the width is cropped left and right.
    expect(p.crop!.t).toBe(0);
    expect(p.crop!.b).toBe(0);
    expect(p.crop!.l).toBeGreaterThan(0.2);
    expect(p.crop!.l).toBe(p.crop!.r);
    const shown = { w: 2830 * (1 - p.crop!.l - p.crop!.r), h: 1000 };
    expect(ratiosAgree(ratio(shown), ratio(FRAME))).toBe(true);
  });
  it("covers a portrait photo by cropping top and bottom", () => {
    const p = placeImage(FRAME, { w: 830, h: 1000 }, "cover");
    expect(p.crop!.l).toBe(0);
    expect(p.crop!.t).toBeGreaterThan(0);
    const shown = { w: 830, h: 1000 * (1 - p.crop!.t - p.crop!.b) };
    expect(ratiosAgree(ratio(shown), ratio(FRAME))).toBe(true);
  });
  it("contains: keeps the whole picture at its own ratio, centred, the rest of the frame bare", () => {
    const p = placeImage(FRAME, { w: 2420, h: 1000 }, "contain"); // a flow builder screenshot, 2.42:1
    expect(p.mode).toBe("contain");
    expect(p.crop).toBeNull();
    expect(p.pads).toBe(true);
    expect(p.box.w).toBeCloseTo(FRAME.w, 3);
    expect(ratiosAgree(ratio(p.box), 2.42)).toBe(true);
    expect(p.box.x).toBeCloseTo(FRAME.x, 3);
    expect(p.box.y).toBeCloseTo(FRAME.y + (FRAME.h - p.box.h) / 2, 3);
  });
  it("never draws a picture larger than its native size at 96 dpi: a small logo sits at its own size, and a small photo is contained rather than blown up", () => {
    const logoBox = { x: 9.0, y: 5.35, w: 0.9, h: 0.24 };
    const small = placeImage(logoBox, { w: 48, h: 12 }, "contain"); // half an inch wide
    expect(small.box.w).toBeCloseTo(inches(48), 3);
    expect(small.box.h).toBeCloseTo(inches(12), 3);
    expect(small.pads).toBe(true);
    const tiny = placeImage(FRAME, { w: 200, h: 150 }, "cover");
    expect(tiny.mode).toBe("contain");
    expect(tiny.box.w).toBeCloseTo(inches(200), 3);
    expect(tiny.crop).toBeNull();
  });
  it("writes the crop as the file's srcRect, in thousandths of a percent", () => {
    expect(cropToSrcRect({ l: 0.25, r: 0.25, t: 0, b: 0 })).toEqual({ l: 25000, r: 25000, t: 0, b: 0 });
  });
});

describe("the encode plan", () => {
  it("downscales to twice the frame's 96 dpi pixels, a photo as JPEG at 85, anything else as PNG", () => {
    const photo = encodePlan(FRAME, "cover", "photo");
    expect(photo).toEqual({ width: 797, height: 672, fit: "outside", format: "jpeg", quality: 85 });
    const shot = encodePlan(FRAME, "contain", "screenshot");
    expect(shot.fit).toBe("inside");
    expect(shot.format).toBe("png");
    expect(encodePlan({ x: 9, y: 5.35, w: 0.9, h: 0.24 }, "contain", "logo").width).toBe(173);
  });
});
