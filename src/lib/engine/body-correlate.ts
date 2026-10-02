/**
 * The correlation explorer (B10, rev 231; rev 198's rules): any two date-keyed series paired by date with a lag, daily or weekly,
 * Pearson r always with n, and the guardrails: nothing under 21 pairs, "early signal" to 41, a pattern named only when it holds in
 * both halves of the range and clears the threshold, worded "moved together", never "caused". Plain statistics, no AI. Pure.
 */

export type Point = { date: string; value: number };
export type Pair = { date: string; x: number; y: number };
export type Grain = "daily" | "weekly";
/** How a series folds into a week: counts and amounts add up, levels average. */
export type Fold = "sum" | "mean";

export const WINDOWS = [4, 8, 12] as const;
export const LAGS = [0, 1, 2, 3] as const;
/** The threshold a whole-range r must clear for a pattern to be named (proposed 1 Oct; 0.3 is the usual "small but real" line). */
export const R_THRESHOLD = 0.3;
export const MIN_PAIRS = 21;
export const EARLY_PAIRS = 41;

/** A series folded by week (Monday-keyed), by its fold. */
export function foldWeekly(points: Point[], fold: Fold, startOfWeek: (d: string) => string): Point[] {
  const byWeek = new Map<string, number[]>();
  for (const p of points) {
    const w = startOfWeek(p.date);
    byWeek.set(w, [...(byWeek.get(w) ?? []), p.value]);
  }
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, vs]) => ({ date, value: fold === "sum" ? vs.reduce((s, v) => s + v, 0) : vs.reduce((s, v) => s + v, 0) / vs.length }));
}

/**
 * Pair A with B: B on a date with A `lag` days earlier (daily), or A and B of the same week (weekly; the lag is applied to A's
 * dates in days before folding, so "sleep → calls booked the next day" still means that on weekly grain). Dates in `exclude` are
 * left out on B's side.
 */
export function pairUp(a: Point[], b: Point[], opts: { lag: number; grain: Grain; foldA: Fold; foldB: Fold; exclude?: Set<string>; addDays: (d: string, n: number) => string; startOfWeek: (d: string) => string }): Pair[] {
  const shifted = opts.lag ? a.map((p) => ({ date: opts.addDays(p.date, opts.lag), value: p.value })) : a;
  const bKept = opts.exclude?.size ? b.filter((p) => !opts.exclude!.has(p.date)) : b;
  const left = opts.grain === "weekly" ? foldWeekly(shifted, opts.foldA, opts.startOfWeek) : shifted;
  const right = opts.grain === "weekly" ? foldWeekly(bKept, opts.foldB, opts.startOfWeek) : bKept;
  const byDate = new Map(left.map((p) => [p.date, p.value]));
  return right.flatMap((p) => (byDate.has(p.date) ? [{ date: p.date, x: byDate.get(p.date)!, y: p.value }] : [])).sort((p, q) => p.date.localeCompare(q.date));
}

/** Pearson's r over the pairs; null when either side doesn't vary. */
export function pearson(pairs: { x: number; y: number }[]): number | null {
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / n;
  const my = pairs.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pairs) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100;
}

export type Verdict = { kind: "none" | "steady" | "unsteady" | "flat"; r: number | null; n: number; early: boolean; halves: [number | null, number | null]; words: string };

/**
 * The readout, by the rules: under 21 pairs no r at all; 21 to 41 an early signal; a pattern is named only when r clears the
 * threshold and keeps its sign in both halves of the range. Always "moved together" or "moved apart", never a cause.
 */
export function verdict(pairs: Pair[], labelA: string, labelB: string, unit: "days" | "weeks"): Verdict {
  const n = pairs.length;
  const nText = `${n} paired ${n === 1 ? unit.slice(0, -1) : unit}`;
  if (n < MIN_PAIRS) return { kind: "none", r: null, n, early: false, halves: [null, null], words: `Not enough data yet: ${nText}, ${MIN_PAIRS} needed before a pattern is read.` };
  const r = pearson(pairs);
  const early = n <= EARLY_PAIRS;
  const mid = Math.floor(n / 2);
  const halves: [number | null, number | null] = [pearson(pairs.slice(0, mid)), pearson(pairs.slice(mid))];
  const tag = `r ${r == null ? "—" : r.toFixed(2)}, ${nText}${early ? ", early signal" : ""}`;
  if (r == null) return { kind: "flat", r, n, early, halves, words: `One of them didn't change over this range, so there's nothing to compare (${tag}).` };
  const steady = Math.abs(r) >= R_THRESHOLD && halves[0] != null && halves[1] != null && Math.sign(halves[0]) === Math.sign(r) && Math.sign(halves[1]) === Math.sign(r);
  if (steady) return { kind: "steady", r, n, early, halves, words: `${labelA} and ${labelB} moved ${r > 0 ? "together" : "apart"} across this range, in both halves of it (${tag}).` };
  return { kind: "unsteady", r, n, early, halves, words: `No steady pattern between ${labelA} and ${labelB}: ${Math.abs(r) < R_THRESHOLD ? `the link is small` : `it doesn't hold in both halves of the range`} (${tag}).` };
}

/** The seven preset pairs of rev 231, as metric keys with the lag and grain they ask for. */
export const PRESETS: { a: string; b: string; lag: number; grain: Grain; label: string }[] = [
  { a: "sleep_h", b: "callsBooked", lag: 1, grain: "daily", label: "Sleep hours → calls booked the next day" },
  { a: "session", b: "cashCollected", lag: 0, grain: "weekly", label: "Sessions a week → cash collected" },
  { a: "habit:meditation", b: "energy", lag: 1, grain: "daily", label: "Meditation minutes → lock-in energy the next day" },
  { a: "fatOver", b: "weight", lag: 1, grain: "daily", label: "Fat over the ceiling → weight the next day" },
  { a: "offPlan", b: "bf", lag: 0, grain: "weekly", label: "Off-plan days a week → body fat %" },
  { a: "habit:sauna", b: "energy", lag: 1, grain: "daily", label: "Sauna minutes → energy the next day" },
  { a: "habit:walk / steps", b: "tasksClosed", lag: 0, grain: "daily", label: "Steps → tasks closed" },
];

export type MetricDef = { key: string; label: string; group: "Body" | "Nutrition" | "Training" | "Habits" | "Business"; fold: Fold; weeklyByDefault?: boolean; unit?: string };
/** The fixed metrics; habits join at run time as `habit:<name lower-cased>`. */
export const METRIC_DEFS: MetricDef[] = [
  { key: "sleep_h", label: "Sleep hours", group: "Body", fold: "mean", unit: "h" },
  { key: "sleep_score", label: "Sleep score", group: "Body", fold: "mean" },
  // Phase 16b: what a wearable adds, as body_daily keys. Bedtime counts minutes after 6 pm, wake time after midnight.
  { key: "recovery", label: "Recovery %", group: "Body", fold: "mean", unit: "%" },
  { key: "strain", label: "Strain", group: "Body", fold: "mean" },
  { key: "rhr", label: "Resting heart rate", group: "Body", fold: "mean", unit: "bpm" },
  { key: "hrv", label: "HRV", group: "Body", fold: "mean", unit: "ms" },
  { key: "sleep_deep_min", label: "Deep sleep (min)", group: "Body", fold: "mean", unit: "min" },
  { key: "sleep_rem_min", label: "REM sleep (min)", group: "Body", fold: "mean", unit: "min" },
  { key: "bedtime", label: "Bedtime (minutes after 6 pm)", group: "Body", fold: "mean", unit: "min" },
  { key: "waketime", label: "Wake time (minutes after midnight)", group: "Body", fold: "mean", unit: "min" },
  { key: "bedtime_drift", label: "Bedtime drift (minutes from the week's usual)", group: "Body", fold: "mean", unit: "min" },
  { key: "burn_cal", label: "Energy burned (device estimate)", group: "Body", fold: "mean", unit: "cal" },
  { key: "cycle_hr", label: "Average heart rate", group: "Body", fold: "mean", unit: "bpm" },
  { key: "weight", label: "Weight", group: "Body", fold: "mean", weeklyByDefault: true, unit: "lb" },
  { key: "bf", label: "Body fat %", group: "Body", fold: "mean", weeklyByDefault: true, unit: "%" },
  { key: "cal", label: "Calories", group: "Nutrition", fold: "mean", unit: "cal" },
  { key: "p", label: "Protein", group: "Nutrition", fold: "mean", unit: "g" },
  { key: "f", label: "Fat", group: "Nutrition", fold: "mean", unit: "g" },
  { key: "c", label: "Carbs", group: "Nutrition", fold: "mean", unit: "g" },
  { key: "fatOver", label: "Fat over the ceiling", group: "Nutrition", fold: "mean", unit: "g" },
  { key: "inBand", label: "In band (1 = yes)", group: "Nutrition", fold: "sum" },
  { key: "offPlan", label: "Off plan (1 = a mark out of band)", group: "Nutrition", fold: "sum" },
  { key: "session", label: "A workout that day (1 = yes)", group: "Training", fold: "sum" },
  { key: "sets", label: "Sets", group: "Training", fold: "sum" },
  { key: "energy", label: "Lock-in energy", group: "Business", fold: "mean" },
  { key: "dmsStarted", label: "DMs started", group: "Business", fold: "sum" },
  { key: "conversations", label: "Conversations", group: "Business", fold: "sum" },
  { key: "callsBooked", label: "Calls booked", group: "Business", fold: "sum" },
  { key: "callsHeld", label: "Calls held", group: "Business", fold: "sum" },
  { key: "posts", label: "Posts", group: "Business", fold: "sum" },
  { key: "offersMade", label: "Offers made", group: "Business", fold: "sum" },
  { key: "newLeads", label: "New leads", group: "Business", fold: "sum" },
  { key: "cashCollected", label: "Cash collected", group: "Business", fold: "sum", unit: "$" },
  { key: "webinarRegs", label: "Webinar sign-ups", group: "Business", fold: "sum" },
  { key: "tasksClosed", label: "Tasks closed", group: "Business", fold: "sum" },
];
export const habitKey = (name: string) => `habit:${name.trim().toLowerCase()}`;
export const isHabitKey = (key: string) => key.startsWith("habit:");
