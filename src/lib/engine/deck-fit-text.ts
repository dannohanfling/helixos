/**
 * Whether text fits its box (deck visuals §4): an estimate from characters, not a render, the same one on the server and in a
 * test. An average glyph is half an em wide, a line is 1.2 em tall; a box takes floor(width / glyph) characters a line and
 * floor(height / line) lines. Words wrap whole, so a long word costs a line of its own.
 */
export const GLYPH_EM = 0.5;
export const LINE_EM = 1.2;
const PT_PER_IN = 72;

/**
 * How much wider a face sets than the average the estimate assumes (deck re-test §5, 7 Oct: the starter kit's Montserrat
 * overflowed 7 slides where Red Hat Display overflowed 2). A face not listed sets at the average. Matched on the family name,
 * case aside.
 */
const FACE_WIDTH: [RegExp, number][] = [
  [/montserrat/i, 1.14],
  [/poppins/i, 1.1],
  [/raleway/i, 1.08],
  [/red hat display/i, 1.04],
  [/inter\b/i, 1.03],
  [/georgia|playfair/i, 1.02],
  [/arial|helvetica|roboto|open sans|lato/i, 1.0],
  [/arial narrow|oswald|bebas/i, 0.85],
];
export const faceWidth = (face: string | null | undefined): number => FACE_WIDTH.find(([re]) => re.test(face ?? ""))?.[1] ?? 1.0;

/** How many lines `text` takes in a box `widthIn` wide at `sizePt` in `face`, words wrapping whole. */
export function linesFor(text: string, widthIn: number, sizePt: number, face?: string | null): number {
  const perLine = Math.max(1, Math.floor((widthIn * PT_PER_IN) / (sizePt * GLYPH_EM * faceWidth(face))));
  let lines = 0;
  for (const para of text.split("\n")) {
    let used = 0;
    let started = false;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = word.length;
      if (!started) {
        lines++;
        started = true;
        used = Math.min(w, perLine);
        if (w > perLine) lines += Math.ceil(w / perLine) - 1;
        continue;
      }
      if (used + 1 + w <= perLine) used += 1 + w;
      else {
        lines++;
        used = Math.min(w, perLine);
        if (w > perLine) lines += Math.ceil(w / perLine) - 1;
      }
    }
    if (!started) lines++;
  }
  return lines;
}

/** Whether `lines` of `sizePt` fit a box `heightIn` tall. */
export const linesFit = (lines: number, sizePt: number, heightIn: number): boolean => lines * sizePt * LINE_EM <= heightIn * PT_PER_IN + 0.01;

/** The largest size in `sizes` (descending) at which `text` fits the box in `face`, or null when even the smallest overflows. */
export function fitSize(text: string, box: { w: number; h: number }, sizes: number[], face?: string | null): number | null {
  for (const size of sizes) if (linesFit(linesFor(text, box.w, size, face), size, box.h)) return size;
  return null;
}
