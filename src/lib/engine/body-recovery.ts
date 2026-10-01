/**
 * Recovery (rev 237 phase 8): sleep and the numbers a wearable adds later, as body_daily keys, the way composition works
 * (src/lib/engine/body-scale.ts). Manual first: hours slept and an optional sleep score. WHOOP (B6) fills recovery, strain,
 * resting heart rate and HRV with source "whoop" into the same keys. A night belongs to the morning it ends on.
 */
export type RecoveryKey = "sleep_h" | "sleep_score" | "recovery" | "strain" | "rhr" | "hrv";
export type RecoveryMetric = { key: RecoveryKey; label: string; unit: string; decimals: number; range: [number, number] };
export const RECOVERY: RecoveryMetric[] = [
  { key: "sleep_h", label: "Sleep", unit: "h", decimals: 1, range: [0, 24] },
  { key: "sleep_score", label: "Sleep score", unit: "", decimals: 0, range: [0, 100] },
  { key: "recovery", label: "Recovery", unit: "%", decimals: 0, range: [0, 100] },
  { key: "strain", label: "Strain", unit: "", decimals: 1, range: [0, 21] },
  { key: "rhr", label: "Resting heart rate", unit: "bpm", decimals: 0, range: [20, 200] },
  { key: "hrv", label: "HRV", unit: "ms", decimals: 0, range: [1, 300] },
];
export const RECOVERY_METRIC = Object.fromEntries(RECOVERY.map((m) => [m.key, m])) as Record<RecoveryKey, RecoveryMetric>;
export const isRecoveryKey = (k: string): k is RecoveryKey => k in RECOVERY_METRIC;
export const recoveryInRange = (key: RecoveryKey, v: number): boolean => v >= RECOVERY_METRIC[key].range[0] && v <= RECOVERY_METRIC[key].range[1];
/** The reading id of a night's manual numbers: one per date, replaced when logged again. */
export const sleepReadingId = (date: string) => `sleep:${date}`;

/** "7:30" or "7.5" or "7h 30m" → 7.5 hours; null when it isn't a time. */
export function parseHours(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return +m[1] + +m[2] / 60;
  m = s.match(/^(\d{1,2})\s*h(?:ours?)?\s*(?:(\d{1,2})\s*m(?:in)?)?$/);
  if (m) return +m[1] + (m[2] ? +m[2] / 60 : 0);
  m = s.match(/^(\d{1,2}(?:\.\d+)?)\s*(?:h|hours?)?$/);
  if (m) return +m[1];
  return null;
}
/** 7.5 → "7 h 30 min"; 7 → "7 h". */
export function fmtHours(h: number): string {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  if (min === 60) return `${whole + 1} h`;
  return min ? `${whole} h ${min} min` : `${whole} h`;
}
export function fmtRecovery(key: RecoveryKey, v: number): string {
  if (key === "sleep_h") return fmtHours(v);
  const m = RECOVERY_METRIC[key];
  const n = v.toLocaleString("en-US", { maximumFractionDigits: m.decimals, minimumFractionDigits: 0 });
  return m.unit === "%" ? `${n}%` : m.unit ? `${n} ${m.unit}` : n;
}

export type Night = { date: string; hours: number };
/** A run of nights: the average, how many, and how many reached the floor (7 h unless told otherwise). */
export function sleepWeek(nights: Night[], floor = 7): { avg: number | null; nights: number; atFloor: number } {
  if (!nights.length) return { avg: null, nights: 0, atFloor: 0 };
  const avg = Math.round((nights.reduce((a, n) => a + n.hours, 0) / nights.length) * 10) / 10;
  return { avg, nights: nights.length, atFloor: nights.filter((n) => n.hours >= floor).length };
}
/** Each night's trailing 7-night average (nights present within the last seven days), for the trend line. */
export function sleepAverages(nights: Night[], daysBetween: (a: string, b: string) => number): (number | null)[] {
  return nights.map((n, i) => {
    const window = nights.slice(0, i + 1).filter((x) => daysBetween(x.date, n.date) < 7);
    return window.length >= 3 ? Math.round((window.reduce((a, x) => a + x.hours, 0) / window.length) * 10) / 10 : null;
  });
}
