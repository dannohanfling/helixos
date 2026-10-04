/**
 * Body composition (rev 237 phase 2): the metrics, the RENPHO CSV parser for both header sets rev 231 listed, and the rules
 * behind a day's figure. Pure, so it runs in the browser for the import preview and on the server for the import itself, and
 * is tested without a database.
 *
 * Rules (rev 251): every reading is stored; the day's figure is the reading with the lowest weight, kept whole (its body fat,
 * muscle and water come from that same reading, never mixed). Fat-free mass is derived when a reading lacks it. Masses are
 * stored in lb whatever the file or the member says; display converts.
 */
import { toUnit, type WeightUnit } from "@/lib/engine/body-training";

export type MetricKey = "weight" | "bf" | "ffm" | "smm_pct" | "visceral" | "water" | "bmr" | "met_age" | "fat_mass" | "muscle_pct" | "smm_mass" | "whr" | "muscle_mass" | "bone_mass" | "protein" | "subq_fat" | "bmi";
export type MetricUnit = "mass" | "pct" | "count" | "kcal" | "years" | "ratio";
export type Metric = { key: MetricKey; label: string; short: string; unit: MetricUnit; decimals: number; /** A trend card of its own (the eight of rev 231); the rest ride along in a reading. */ primary: boolean };

export const METRICS: Metric[] = [
  { key: "weight", label: "Weight", short: "Weight", unit: "mass", decimals: 1, primary: true },
  { key: "bf", label: "Body fat", short: "Body fat", unit: "pct", decimals: 1, primary: true },
  { key: "ffm", label: "Fat-free mass", short: "Fat-free", unit: "mass", decimals: 1, primary: true },
  { key: "smm_pct", label: "Skeletal muscle", short: "Skel. muscle", unit: "pct", decimals: 1, primary: true },
  { key: "visceral", label: "Visceral fat", short: "Visceral", unit: "count", decimals: 0, primary: true },
  { key: "water", label: "Body water", short: "Water", unit: "pct", decimals: 1, primary: true },
  { key: "bmr", label: "BMR", short: "BMR", unit: "kcal", decimals: 0, primary: true },
  { key: "met_age", label: "Metabolic age", short: "Met. age", unit: "years", decimals: 0, primary: true },
  { key: "fat_mass", label: "Body fat mass", short: "Fat mass", unit: "mass", decimals: 1, primary: false },
  { key: "muscle_pct", label: "Muscle", short: "Muscle", unit: "pct", decimals: 1, primary: false },
  { key: "smm_mass", label: "Skeletal muscle mass", short: "Skel. muscle mass", unit: "mass", decimals: 1, primary: false },
  { key: "whr", label: "Waist-hip ratio", short: "WHR", unit: "ratio", decimals: 2, primary: false },
  // The rest of a RENPHO reading (rev 476), kept with it and shown when the reading is opened.
  { key: "muscle_mass", label: "Muscle mass", short: "Muscle mass", unit: "mass", decimals: 1, primary: false },
  { key: "bone_mass", label: "Bone mass", short: "Bone", unit: "mass", decimals: 1, primary: false },
  { key: "protein", label: "Protein", short: "Protein", unit: "pct", decimals: 1, primary: false },
  { key: "subq_fat", label: "Subcutaneous fat", short: "Subcut. fat", unit: "pct", decimals: 1, primary: false },
  { key: "bmi", label: "BMI", short: "BMI", unit: "ratio", decimals: 1, primary: false },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, Metric>;
export const METRIC_KEYS = METRICS.map((m) => m.key);
export const isMetricKey = (k: string): k is MetricKey => k in METRIC;

/** One step on the scale (or one manual entry): its date, time when known, and the numbers it carried, masses in lb. */
export type Reading = { date: string; time: string | null; values: Partial<Record<MetricKey, number>> };

const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** A value in the member's unit, for masses; other units pass through. */
export function displayValue(key: MetricKey, value: number, unit: WeightUnit): number {
  return METRIC[key].unit === "mass" ? toUnit(value, "lb", unit) : r(value, METRIC[key].decimals);
}
/** The stored (lb) value of a mass the member typed in their unit. */
export function storedValue(key: MetricKey, typed: number, unit: WeightUnit): number {
  return METRIC[key].unit === "mass" ? toUnit(typed, unit, "lb") : r(typed, METRIC[key].decimals);
}
/** "146.8 lb", "17.9%", "1,620 kcal", "34 y", "7", "0.86". */
export function fmtMetric(key: MetricKey, value: number, unit: WeightUnit): string {
  const m = METRIC[key];
  const v = displayValue(key, value, unit);
  const n = v.toLocaleString("en-US", { minimumFractionDigits: m.unit === "ratio" ? 2 : 0, maximumFractionDigits: m.decimals });
  return m.unit === "mass" ? `${n} ${unit}` : m.unit === "pct" ? `${n}%` : m.unit === "kcal" ? `${n} kcal` : m.unit === "years" ? `${n} y` : n;
}
export const unitLabel = (key: MetricKey, unit: WeightUnit): string => ({ mass: unit, pct: "%", count: "", kcal: "kcal", years: "years", ratio: "" })[METRIC[key].unit];

/** Fat-free mass (and fat mass) from weight and body fat % when a reading lacks them. Never overwrites what the scale said. */
export function withDerived(values: Partial<Record<MetricKey, number>>): Partial<Record<MetricKey, number>> {
  const out = { ...values };
  if (out.weight != null && out.bf != null) {
    if (out.ffm == null) out.ffm = r(out.weight * (1 - out.bf / 100), 1);
    if (out.fat_mass == null) out.fat_mass = r(out.weight * (out.bf / 100), 1);
  }
  return out;
}

/**
 * The day's figure: the reading with the lowest weight, whole. Among equal weights the earliest. A day whose readings carry no
 * weight at all (a manual body-fat note) takes the latest one.
 */
export function dayFigure<T extends Reading>(readings: T[]): T | null {
  const weighed = readings.filter((x) => x.values.weight != null);
  if (weighed.length) return weighed.reduce((best, x) => (x.values.weight! < best.values.weight! || (x.values.weight === best.values.weight && (x.time ?? "") < (best.time ?? "")) ? x : best));
  return readings.length ? readings[readings.length - 1] : null;
}

/* ───────── The RENPHO CSV ───────── */

export type ScaleFormat = "older" | "newer";
export type ParsedCsv = { format: ScaleFormat | null; readings: Reading[]; skipped: { line: number; why: string }[]; unit: WeightUnit | null; columns: MetricKey[] };

/** A small RFC-4180 reader: quotes, doubled quotes, commas inside quotes, CR LF, a BOM. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((x) => x.some((v) => v.trim() !== ""));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9%()]/g, "");

/** A header → what it holds. The mass columns say their unit in the header, "(lb)" or "(kg)". */
type Col = { key: MetricKey; unit?: WeightUnit } | { key: "date" } | { key: "time" } | { key: "no" } | null;
export function readHeader(h: string): Col {
  const n = norm(h);
  const mass = (key: MetricKey): Col => ({ key, unit: /\(kg\)/.test(n) ? "kg" : "lb" });
  if (n === "no" || n === "no.") return { key: "no" };
  if (/^date/.test(n)) return { key: "date" };
  if (/^time/.test(n)) return { key: "time" };
  if (/^weight\((lb|kg)\)$/.test(n) || n === "weight") return mass("weight");
  if (/^bodyfat(percentage)?\(%\)$/.test(n) || n === "bodyfat%") return { key: "bf" };
  if (/^bodyfatmass\((lb|kg)\)$/.test(n)) return mass("fat_mass");
  if (/^fatfreemass\((lb|kg)\)$/.test(n)) return mass("ffm");
  if (/^skeletalmuscle\(%\)$/.test(n)) return { key: "smm_pct" };
  if (/^skeletalmusclemass\((lb|kg)\)$/.test(n)) return mass("smm_mass");
  if (/^musclepercentage\(%\)$/.test(n) || /^muscle\(%\)$/.test(n)) return { key: "muscle_pct" };
  if (/^visceralfat/.test(n)) return { key: "visceral" };
  if (/^bodywater\(%\)$/.test(n)) return { key: "water" };
  if (/^bmr/.test(n)) return { key: "bmr" };
  if (/^metabolicage/.test(n)) return { key: "met_age" };
  if (n === "whr") return { key: "whr" };
  if (/^musclemass\((lb|kg)\)$/.test(n)) return mass("muscle_mass");
  if (/^bonemass\((lb|kg)\)$/.test(n)) return mass("bone_mass");
  if (/^protein(percentage)?\(%\)$/.test(n)) return { key: "protein" };
  if (/^subcutaneousfat(percentage)?\(%\)$/.test(n)) return { key: "subq_fat" };
  if (n === "bmi") return { key: "bmi" };
  return null;
}

/** "9/1/26", "9/1/2026", "2026.09.01", "2026-09-01", each optionally followed by a time ("07:12", "7:12:05 AM"). */
export function readDate(raw: string): { date: string; time: string | null } | null {
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T,]+(.*))?$/);
  let y: number, mo: number, d: number, rest: string | undefined;
  if (m) {
    mo = +m[1];
    d = +m[2];
    y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    rest = m[4];
  } else {
    m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T,]+(.*))?$/);
    if (!m) return null;
    y = +m[1];
    mo = +m[2];
    d = +m[3];
    rest = m[4];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return { date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, time: rest ? readTime(rest) : null };
}
export function readTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|AM|PM)?$/);
  if (!m) return null;
  let h = +m[1];
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || +m[2] > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Plausible ranges, so a stray column never lands as a body. */
export const RANGE: Record<MetricKey, [number, number]> = { weight: [30, 1500], bf: [1, 80], ffm: [20, 1000], smm_pct: [5, 80], visceral: [1, 60], water: [20, 85], bmr: [500, 6000], met_age: [5, 120], fat_mass: [1, 800], muscle_pct: [5, 95], smm_mass: [5, 500], whr: [0.4, 1.6], muscle_mass: [10, 800], bone_mass: [1, 60], protein: [5, 40], subq_fat: [1, 70], bmi: [10, 80] };

export const inRange = (key: MetricKey, v: number): boolean => v >= RANGE[key][0] && v <= RANGE[key][1];

/**
 * The file → readings. Older: Date M/D/YY with Weight(lb), Body Fat(%), Skeletal Muscle(%), Fat-Free Mass(lb), Visceral Fat,
 * Body Water(%), BMR(kcal), Metabolic Age. Newer (Sept 2026): a leading No., Date YYYY.MM.DD, Body Fat Percentage(%), plus
 * Body Fat Mass, Muscle Percentage, Skeletal Muscle Mass and WHR. Either may carry a Time column, or a time in the Date cell.
 * A file in kg is converted to lb. Rows that don't parse are listed with their line, never dropped silently.
 */
export function parseScaleCsv(text: string): ParsedCsv {
  const rows = parseCsvRows(text);
  if (!rows.length) return { format: null, readings: [], skipped: [{ line: 1, why: "the file is empty" }], unit: null, columns: [] };
  const cols = rows[0].map(readHeader);
  const dateAt = cols.findIndex((c) => c?.key === "date");
  const columns = cols.flatMap((c) => (c && isMetricKey(c.key) ? [c.key] : []));
  if (dateAt < 0 || !columns.includes("weight")) return { format: null, readings: [], skipped: [{ line: 1, why: "not a scale export: no Date and Weight columns" }], unit: null, columns };
  const format: ScaleFormat = cols.some((c) => c?.key === "no") || columns.includes("muscle_pct") || columns.includes("whr") ? "newer" : "older";
  const unit = (cols.find((c) => c?.key === "weight") as { unit?: WeightUnit } | undefined)?.unit ?? "lb";
  const timeAt = cols.findIndex((c) => c?.key === "time");
  const readings: Reading[] = [];
  const skipped: ParsedCsv["skipped"] = [];
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const when = readDate(row[dateAt] ?? "");
    if (!when) return skipped.push({ line, why: `no date in "${(row[dateAt] ?? "").slice(0, 20)}"` });
    const time = when.time ?? (timeAt >= 0 ? readTime(row[timeAt] ?? "") : null);
    const values: Partial<Record<MetricKey, number>> = {};
    cols.forEach((c, j) => {
      if (!c || !isMetricKey(c.key)) return;
      const raw = (row[j] ?? "").trim();
      if (!raw || raw === "--" || raw === "-") return;
      const n = Number(raw.replace(/[^0-9.\-]/g, ""));
      if (!Number.isFinite(n)) return;
      const v = METRIC[c.key].unit === "mass" ? toUnit(n, (c as { unit?: WeightUnit }).unit ?? "lb", "lb") : n;
      const [lo, hi] = RANGE[c.key];
      if (v >= lo && v <= hi) values[c.key] = r(v, METRIC[c.key].decimals);
    });
    if (values.weight == null) return skipped.push({ line, why: "no weight" });
    readings.push({ date: when.date, time, values });
  });
  return { format, readings, skipped, unit, columns };
}

/** What makes two readings the same one: the date and time, or with no time the date and weight. Used to skip re-imports. */
export const readingKey = (x: Reading): string => `${x.date}|${x.time ?? `w${x.values.weight}`}`;

/**
 * The stored reading an incoming one is (rev 476): on the same day, the one at the same minute; when either has no time, the one
 * whose weight is within 0.2 lb, so a reading typed or told to Claude and the same step on the scale imported from RENPHO are
 * one reading, not two. Null when it is a new reading.
 */
export function matchReading<T extends Reading>(day: T[], x: Reading): T | null {
  const same = day.filter((r) => r.date === x.date);
  const minute = (t: string | null) => (t ? t.slice(0, 5) : null);
  if (x.time) {
    const at = same.find((r) => minute(r.time) === minute(x.time));
    if (at) return at;
  }
  const w = x.values.weight;
  if (w == null) return null;
  return same.find((r) => (!r.time || !x.time) && r.values.weight != null && Math.abs(r.values.weight - w) <= 0.2) ?? null;
}

/** What an incoming reading adds to the one it matched: the numbers it lacks. A number already there is never overwritten. */
export function missingValues(have: Partial<Record<MetricKey, number>>, incoming: Partial<Record<MetricKey, number>>): Partial<Record<MetricKey, number>> {
  return Object.fromEntries(Object.entries(incoming).filter(([k, v]) => v != null && have[k as MetricKey] == null)) as Partial<Record<MetricKey, number>>;
}

/* ───────── Trends ───────── */

export type DayPoint = { date: string; value: number };

/** The mean of the points in the seven days ending on `date`, or null with none. */
export function avg7(points: DayPoint[], date: string, addDays: (d: string, n: number) => string): number | null {
  const from = addDays(date, -6);
  const inWindow = points.filter((p) => p.date >= from && p.date <= date);
  return inWindow.length ? r(inWindow.reduce((a, p) => a + p.value, 0) / inWindow.length, 2) : null;
}

export type TrendStats = { latest: DayPoint | null; avg7: number | null; /** This week's average against the week before, when both exist. */ change7: number | null; /** The latest against the earliest point in view. */ changeAll: number | null };

/** The numbers a trend card leads with. Points oldest first, already filtered to the range in view. */
export function trendStats(points: DayPoint[], today: string, addDays: (d: string, n: number) => string): TrendStats {
  if (!points.length) return { latest: null, avg7: null, change7: null, changeAll: null };
  const latest = points[points.length - 1];
  const now = avg7(points, today, addDays);
  const before = avg7(points, addDays(today, -7), addDays);
  return { latest, avg7: now, change7: now != null && before != null ? r(now - before, 2) : null, changeAll: points.length > 1 ? r(latest.value - points[0].value, 2) : null };
}
