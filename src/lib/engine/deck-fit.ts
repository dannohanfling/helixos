/**
 * How a picture sits in its frame on a slide (deck visuals brief, 1 Oct, §1). Pure: inches and pixels in, inches out.
 *
 * Two fits, chosen by what the picture is: a photo COVERS its frame (scaled to fill it, the excess cropped equally from both
 * sides, so a face is never squeezed); a screenshot, proof image, logo or diagram is CONTAINED (kept whole at its own ratio,
 * centred inside the frame on the surface colour), because the number in a screenshot is the evidence and must never be cropped.
 * Nothing is ever stretched, and nothing is drawn larger than its native size at 96 dpi: a small image sits in the frame at its
 * own size rather than blown up. The encode plan says how the bytes are downscaled before they go in the file: twice the frame's
 * pixel size at 96 dpi (a half-slide frame is about 800 px), JPEG for a photo, PNG for everything else.
 */
import type { DeckImageKind } from "@/db/schema";

export const DECK_DPI = 96;
/** The embedded picture carries this many times the frame's 96 dpi pixels: sharp on a projector, small on disk. */
export const ENCODE_SCALE = 2;
export const JPEG_QUALITY = 85;

export type FitMode = "cover" | "contain";
export type Box = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };
/** A crop as fractions of the native image, each side (0 = none). */
export type Crop = { l: number; r: number; t: number; b: number };

/** Photos cover; everything the deck treats as evidence or a mark is contained. */
export const fitModeFor = (kind: DeckImageKind | "proof" | "diagram"): FitMode => (kind === "photo" ? "cover" : "contain");

/** A pixel size as inches at the deck's dpi. */
export const inches = (px: number): number => px / DECK_DPI;

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

export type Placement = { mode: FitMode; box: Box; crop: Crop | null; /** True when the picture leaves part of the frame bare (contain, or a small image). */ pads: boolean };

/**
 * Where the picture goes. `native` is the image's pixel size. A cover fit fills the frame and crops the overflow equally both
 * sides; an image too small to fill the frame without upscaling is contained at its own size instead. A contain fit scales the
 * image down (never up) until it fits, then centres it.
 */
export function placeImage(frame: Box, native: Size, mode: FitMode): Placement {
  if (!(native.w > 0) || !(native.h > 0)) return { mode: "contain", box: frame, crop: null, pads: false };
  const nw = inches(native.w);
  const nh = inches(native.h);
  if (mode === "cover") {
    const scale = Math.max(frame.w / nw, frame.h / nh);
    if (scale <= 1) {
      // The shown part of the image, in image inches, centred.
      const shownW = frame.w / scale;
      const shownH = frame.h / scale;
      const l = round((nw - shownW) / 2 / nw);
      const t = round((nh - shownH) / 2 / nh);
      return { mode: "cover", box: { ...frame }, crop: { l, r: l, t, b: t }, pads: false };
    }
    // Filling the frame would upscale past native: keep the picture whole at its own size.
  }
  const scale = Math.min(frame.w / nw, frame.h / nh, 1);
  const w = round(nw * scale);
  const h = round(nh * scale);
  return { mode: "contain", box: { x: round(frame.x + (frame.w - w) / 2), y: round(frame.y + (frame.h - h) / 2), w, h }, crop: null, pads: w < frame.w - 1e-3 || h < frame.h - 1e-3 };
}

/** The crop as the file's srcRect percentages (thousandths of a percent, the OOXML unit), as pptxgenjs writes them. */
export const cropToSrcRect = (c: Crop): { l: number; r: number; t: number; b: number } => ({ l: Math.round(1e5 * c.l), r: Math.round(1e5 * c.r), t: Math.round(1e5 * c.t), b: Math.round(1e5 * c.b) });

export type EncodePlan = { /** The pixel box the image is resized to fit, at twice the frame's 96 dpi size. */ width: number; height: number; /** "outside" keeps enough to cover the frame; "inside" keeps the whole picture inside the box. Never enlarged. */ fit: "outside" | "inside"; format: "jpeg" | "png"; quality: number };

/** How the bytes are downscaled and re-encoded before they go in the file. A photo becomes a JPEG; a screenshot, proof, logo or diagram stays a PNG (lines and text stay crisp, transparency kept). */
export function encodePlan(frame: Box, mode: FitMode, kind: DeckImageKind | "proof" | "diagram"): EncodePlan {
  return {
    width: Math.round(frame.w * DECK_DPI * ENCODE_SCALE),
    height: Math.round(frame.h * DECK_DPI * ENCODE_SCALE),
    fit: mode === "cover" ? "outside" : "inside",
    format: kind === "photo" ? "jpeg" : "png",
    quality: JPEG_QUALITY,
  };
}

/** The ratio of a box, for the checks: a placed picture's box against its (cropped) native ratio must agree within 1%. */
export const ratio = (s: Size): number => s.w / s.h;
export const ratiosAgree = (a: number, b: number, tolerance = 0.01): boolean => Math.abs(a - b) / b <= tolerance;
