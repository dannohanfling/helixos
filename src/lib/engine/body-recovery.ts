/**
 * Recovery (rev 237 phase 8): sleep and the numbers a wearable adds later, as body_daily keys, the way composition works
 * (src/lib/engine/body-scale.ts). Manual first: hours slept and an optional sleep score. WHOOP (B6) fills recovery, strain,
 * resting heart rate and HRV with source "whoop" into the same keys. A night belongs to the morning it ends on.
 */
export type RecoveryKey = "sleep_h" | "sleep_score" | "recovery" | "strain" | "rhr" | "hrv" | "sleep_light_min" | "sleep_deep_min" | "sleep_rem_min" | "sleep_awake_min" | "bedtime" | "waketime" | "burn_cal" | "cycle_hr" | "max_hr";
export type RecoveryMetric = { key: RecoveryKey; label: string; unit: string; decimals: number; range: [number, number] };
/** Phase 16b adds the night's stages and bed times, the day's energy estimate and average heart rate, and the device's max heart rate. */
export const RECOVERY: RecoveryMetric[] = [
  { key: "sleep_h", label: "Sleep", unit: "h", decimals: 1, range: [0, 24] },
  { key: "sleep_score", label: "Sleep score", unit: "", decimals: 0, range: [0, 100] },
  { key: "recovery", label: "Recovery", unit: "%", decimals: 0, range: [0, 100] },
  { key: "strain", label: "Strain", unit: "", decimals: 1, range: [0, 21] },
  { key: "rhr", label: "Resting heart rate", unit: "bpm", decimals: 0, range: [20, 200] },
  { key: "hrv", label: "HRV", unit: "ms", decimals: 0, range: [1, 300] },
  { key: "sleep_light_min", label: "Light sleep", unit: "min", decimals: 0, range: [0, 1440] },
  { key: "sleep_deep_min", label: "Deep sleep", unit: "min", decimals: 0, range: [0, 1440] },
  { key: "sleep_rem_min", label: "REM sleep", unit: "min", decimals: 0, range: [0, 1440] },
  { key: "sleep_awake_min", label: "Awake in bed", unit: "min", decimals: 0, range: [0, 1440] },
  /** Minutes after 6 pm the night began, so a bedtime past midnight still averages (23:30 is 330, 00:30 is 390). */
  { key: "bedtime", label: "Bedtime", unit: "", decimals: 0, range: [0, 1440] },
  /** Minutes after midnight the night ended. */
  { key: "waketime", label: "Wake time", unit: "", decimals: 0, range: [0, 1440] },
  { key: "burn_cal", label: "Energy burned (device estimate)", unit: "cal", decimals: 0, range: [0, 20000] },
  { key: "cycle_hr", label: "Average heart rate", unit: "bpm", decimals: 0, range: [20, 250] },
  { key: "max_hr", label: "Max heart rate", unit: "bpm", decimals: 0, range: [60, 250] },
];
/** The keys a night row can carry on the Sleep page, in display order. */
export const NIGHT_KEYS: RecoveryKey[] = ["sleep_h", "sleep_score", "sleep_light_min", "sleep_deep_min", "sleep_rem_min", "sleep_awake_min", "bedtime", "waketime"];
/** "23:10" from minutes after 6 pm; "06:40" from minutes after midnight. */
export const fmtBedtime = (v: number): string => fmtClock((v + 18 * 60) % 1440);
export const fmtWake = (v: number): string => fmtClock(v % 1440);
export const fmtClock = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
/** "HH:MM" on a clock → minutes after 6 pm (a bedtime) or after midnight (a wake time). */
export const bedtimeMinutes = (hm: string): number | null => {
  const m = clockMinutes(hm);
  return m == null ? null : (m - 18 * 60 + 1440) % 1440;
};
export const clockMinutes = (hm: string): number | null => {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
};
/** 75 → "1 h 15 min"; 45 → "45 min". */
export const fmtMinutes = (min: number): string => (min >= 60 ? fmtHours(min / 60) : `${Math.round(min)} min`);
/**
 * Bedtime drift (phase 16b): each night's distance in minutes from the mean of the nights in the seven days before it, once two
 * such nights exist. A steady window reads near zero; a late night on a steady week reads as its own lateness.
 */
export function bedtimeDrift(points: { date: string; value: number }[], daysBetween: (a: string, b: string) => number): { date: string; value: number }[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.flatMap((p, i) => {
    const before = sorted.slice(0, i).filter((x) => daysBetween(x.date, p.date) <= 7);
    if (before.length < 2) return [];
    const mean = before.reduce((a, x) => a + x.value, 0) / before.length;
    return [{ date: p.date, value: Math.round(Math.abs(p.value - mean)) }];
  });
}
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
  if (key === "bedtime") return fmtBedtime(v);
  if (key === "waketime") return fmtWake(v);
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
