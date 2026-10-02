/**
 * Whether text fits its box (deck visuals §4): an estimate from characters, not a render, the same one on the server and in a
 * test. An average glyph is half an em wide, a line is 1.2 em tall; a box takes floor(width / glyph) characters a line and
 * floor(height / line) lines. Words wrap whole, so a long word costs a line of its own.
 */
export const GLYPH_EM = 0.5;
export const LINE_EM = 1.2;
const PT_PER_IN = 72;

/** How many lines `text` takes in a box `widthIn` wide at `sizePt`, words wrapping whole. */
export function linesFor(text: string, widthIn: number, sizePt: number): number {
  const perLine = Math.max(1, Math.floor((widthIn * PT_PER_IN) / (sizePt * GLYPH_EM)));
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

/** The largest size in `sizes` (descending) at which `text` fits the box, or null when even the smallest overflows. */
export function fitSize(text: string, box: { w: number; h: number }, sizes: number[]): number | null {
  for (const size of sizes) if (linesFit(linesFor(text, box.w, size), size, box.h)) return size;
  return null;
}
