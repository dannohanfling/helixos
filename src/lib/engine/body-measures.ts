/**
 * Metric or US (Danno, rev 424): one member setting, first taken from their time zone, that decides which units HumanOS shows and
 * takes. Nothing stored changes when it does: weight is always kept in lb (body-scale), a set keeps the unit it was typed in, a food
 * is per its own unit, and an amount habit keeps its own unit; this module only converts for showing and back for entry.
 */
export const MEASURES = ["metric", "us"] as const;
export type Measures = (typeof MEASURES)[number];
export const isMeasures = (v: unknown): v is Measures => v === "metric" || v === "us";
export const MEASURES_LABEL: Record<Measures, string> = { metric: "Metric (kg, g, ml, km)", us: "US (lb, oz, fl oz, mi)" };

/** The US time zones (the IANA ones for the fifty states and their aliases), plus Liberia and Myanmar: the places that weigh in pounds. */
const US_ZONE = /^(America\/(New_York|Detroit|Kentucky\/.+|Indiana\/.+|Chicago|Menominee|North_Dakota\/.+|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Fort_Wayne|Indianapolis|Knox_IN|Louisville|Shiprock)|US\/.+|Pacific\/Honolulu|Africa\/Monrovia|Asia\/(Yangon|Rangoon)|EST5EDT|CST6CDT|MST7MDT|PST8PDT|Navajo)$/;
export const measuresFromZone = (tz: string | null | undefined): Measures => (tz && US_ZONE.test(tz) ? "us" : "metric");

/** The two older settings that now follow the one: a weight unit and the unit a found food lands in. */
export const unitsFor = (m: Measures): { weightUnit: "lb" | "kg"; foodUnit: "oz" | "g" } => (m === "metric" ? { weightUnit: "kg", foodUnit: "g" } : { weightUnit: "lb", foodUnit: "oz" });
/** A member who already chose kg or g reads as metric; otherwise their time zone decides. */
export const measuresOf = (s: { measures?: string | null; weightUnit: string; foodUnit: string }, tz: string | null | undefined): Measures =>
  isMeasures(s.measures) ? s.measures : s.weightUnit === "kg" || s.foodUnit === "g" ? "metric" : measuresFromZone(tz);

/* ── Amount and count habits: shown and typed in the member's system, stored in the habit's own unit. ── */

/** Millilitres in each volume unit an amount habit uses; a habit's "oz" is a drink's fluid ounce. */
const VOLUME_ML: Record<string, number> = { "fl oz": 29.5735295625, floz: 29.5735295625, oz: 29.5735295625, ml: 1, l: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000, cup: 236.5882365, cups: 236.5882365 };
/** Grams in each mass unit an amount habit uses ("oz" is taken as volume above). */
const MASS_G: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, lb: 453.59237, lbs: 453.59237 };

export type HabitShown = { unit: string | null; factor: number; decimals: number };
/**
 * How an amount habit is shown in this system: the unit, the factor from the stored value to the shown one, and the decimals. A unit
 * that is neither a volume nor a mass (steps, pages, capsules) is shown as stored. The size of the target picks ml or L, g or kg.
 */
export function habitShown(unit: string | null, target: number | null, m: Measures): HabitShown {
  const u = (unit ?? "").trim().toLowerCase();
  const same: HabitShown = { unit, factor: 1, decimals: 1 };
  if (VOLUME_ML[u] != null) {
    const ml = VOLUME_ML[u];
    if (m === "metric") return (target ?? 0) * ml >= 1000 ? { unit: "L", factor: ml / 1000, decimals: 1 } : { unit: "ml", factor: ml, decimals: 0 };
    return ["oz", "fl oz", "floz", "cup", "cups"].includes(u) ? same : { unit: "fl oz", factor: ml / VOLUME_ML["fl oz"], decimals: 1 };
  }
  if (MASS_G[u] != null) {
    const g = MASS_G[u];
    if (m === "metric") return ["g", "gram", "grams", "kg"].includes(u) ? same : (target ?? 0) * g >= 1000 ? { unit: "kg", factor: g / 1000, decimals: 1 } : { unit: "g", factor: g, decimals: 0 };
    // Grams stay grams in the US too (creatine is 5 g in any country); only a kilogram habit turns to pounds.
    return u === "kg" ? { unit: "lb", factor: g / MASS_G.lb, decimals: 1 } : same;
  }
  return same;
}
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
/** A stored habit value as shown. */
export const shownValue = (stored: number, s: HabitShown): number => round(stored * s.factor, s.decimals);
/** A value typed in the shown unit, back to the habit's own for storing (to 2 decimals). */
export const storedFromShown = (typed: number, s: HabitShown): number => round(typed / s.factor, 2);

/* ── Distance and the measures a tool may be given ── */

/** Metres → "4.2 km" or "2.6 mi"; nothing under 50 m. */
export function fmtDistanceIn(m: number | null | undefined, measures: Measures): string {
  if (m == null || m < 50) return "";
  return measures === "us" ? `${(Math.round((m / 1609.344) * 10) / 10).toFixed(1)} mi` : `${(Math.round(m / 100) / 10).toFixed(1)} km`;
}
/** A weight unit a tool was given ("kg", "kgs", "kilos", "lb", "lbs", "pounds"), or null to use the member's own. */
export function weightUnitWord(word: unknown): "kg" | "lb" | null {
  const w = String(word ?? "").trim().toLowerCase();
  if (/^(kg|kgs|kilo|kilos|kilogram|kilograms)$/.test(w)) return "kg";
  if (/^(lb|lbs|pound|pounds)$/.test(w)) return "lb";
  return null;
}
