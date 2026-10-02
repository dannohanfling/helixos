/**
 * A meal from a photo (rev 237 phase 14, B8): the member presses the button, their own model names the foods and guesses the
 * portions and macros, and nothing is logged until they check the lines and press Log. This module is pure: the task the model
 * gets, the reading of its answer, the lines carried through the confirm form, and the entry items they become.
 */
import { parseAmount } from "@/lib/engine/amount";
import type { BodyEntryItem } from "@/db/schema";

export const PHOTO_TASK = `You read one meal photo and answer with JSON only, no prose: {"lines":[{"name":"Grilled chicken breast","qty":6,"unit":"oz","cal":280,"p":52,"f":6,"c":0}],"note":"one short caveat"}.
Each line is one food on the plate with its whole portion: name (plain, no brand guesses), qty and unit (oz, g, cup, tbsp, slice, each, piece), and the calories, protein, fat and carbs in grams for that whole portion. Up to 12 lines. If it isn't a meal, answer {"lines":[],"note":"why"}. Guess plainly; the member checks every number before anything is saved.`;
export const PHOTO_USER = "What is on this plate, and how much of each? Answer with the JSON shape only.";

export type PhotoLine = { name: string; qty: number; unit: string; cal: number; p: number; f: number; c: number };
export const PHOTO_MAX_LINES = 12;
const UNITS = ["oz", "g", "cup", "tbsp", "tsp", "slice", "each", "piece", "ml", "fl oz", "scoop", "serving"];

const num = (v: unknown, max = 100000): number | null => {
  // A typed quantity reads the way people write it (rev 444): "1,5", "8 oz" (its unit is the line's own).
  const read = typeof v === "string" ? parseAmount(v) : null;
  const n = typeof v === "number" ? v : read && !("error" in read) ? read.value : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
};
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The model's answer as lines: JSON (code fences stripped), each line checked, bad ones dropped, at most twelve. */
export function parsePhotoLines(text: string): { lines: PhotoLine[]; note: string | null } {
  const raw = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { lines: [], note: null };
  let data: { lines?: unknown; note?: unknown };
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as { lines?: unknown; note?: unknown };
  } catch {
    return { lines: [], note: null };
  }
  const lines = (Array.isArray(data.lines) ? data.lines : [])
    .map((l): PhotoLine | null => {
      const x = (l ?? {}) as Record<string, unknown>;
      const name = clean(x.name, 80);
      const qty = num(x.qty, 1000);
      const unitRaw = clean(x.unit, 20).toLowerCase();
      const unit = UNITS.includes(unitRaw) ? unitRaw : unitRaw || "serving";
      const cal = num(x.cal), p = num(x.p), f = num(x.f), c = num(x.c);
      if (!name || !qty || qty <= 0 || cal == null || p == null || f == null || c == null) return null;
      return { name, qty, unit, cal, p, f, c };
    })
    .filter((l): l is PhotoLine => !!l)
    .slice(0, PHOTO_MAX_LINES);
  return { lines, note: clean(data.note, 200) || null };
}

/** An entry item per line: the model's whole-portion macros become per-unit figures, so an edited quantity scales them. */
export function photoItems(lines: PhotoLine[]): BodyEntryItem[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return lines.map((l) => ({ foodId: null, name: l.name, unit: l.unit, qty: l.qty, cal: r2(l.cal / l.qty), p: r2(l.p / l.qty), f: r2(l.f / l.qty), c: r2(l.c / l.qty), capTag: null }));
}

/**
 * The lines back from the confirm form: `line_<n>_use` ticks a line in; `line_<n>_qty` is the member's quantity, scaled against
 * the model's portion (`qty0` with its macros), so 8 oz of a 6 oz guess is 8/6 of its numbers. Edited names and units are kept.
 */
export function readPhotoLines(get: (key: string) => string): PhotoLine[] {
  const out: PhotoLine[] = [];
  for (let n = 0; n < PHOTO_MAX_LINES; n++) {
    if (get(`line_${n}_use`) !== "1") continue;
    const name = clean(get(`line_${n}_name`), 80);
    const qty = num(get(`line_${n}_qty`), 1000);
    const qty0 = num(get(`line_${n}_qty0`), 1000) || qty;
    const unit = clean(get(`line_${n}_unit`), 20) || "serving";
    const cal = num(get(`line_${n}_cal`)), p = num(get(`line_${n}_p`)), f = num(get(`line_${n}_f`)), c = num(get(`line_${n}_c`));
    if (!name || !qty || qty <= 0 || !qty0 || cal == null || p == null || f == null || c == null) continue;
    const k = qty / qty0;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    out.push({ name, qty, unit, cal: r1(cal * k), p: r1(p * k), f: r1(f * k), c: r1(c * k) });
  }
  return out;
}
