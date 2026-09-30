/**
 * B2, workouts (rev 182): the rules behind Training, pure so they're tested without a database. A set is weight × reps in the
 * unit it was logged in; every comparison converts to one unit first, so a member who switches lb ⇄ kg keeps their PRs.
 *
 * The one rule for "better": more weight wins; at the same weight, more reps. A bodyweight set counts its added weight (none is
 * 0), so for pull-ups with nothing added it's simply the most reps.
 */
export type WeightUnit = "lb" | "kg";
export type SetLike = { date: string; weight: number | null; unit: WeightUnit; reps: number };

const LB_PER_KG = 2.20462;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A weight in another unit, to 0.1. */
export function toUnit(weight: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return weight;
  return r1(from === "kg" ? weight * LB_PER_KG : weight / LB_PER_KG);
}

const load = (s: SetLike, unit: WeightUnit) => (s.weight == null ? 0 : toUnit(s.weight, s.unit, unit));

/** Positive when a beats b. */
export function compareSets(a: SetLike, b: SetLike, unit: WeightUnit = "lb"): number {
  const d = load(a, unit) - load(b, unit);
  return Math.abs(d) > 0.05 ? d : a.reps - b.reps;
}

/** The best set of all, or null with none. The earliest wins a tie, so a PR is dated when it was first reached. */
export function bestSet<T extends SetLike>(sets: T[], unit: WeightUnit = "lb"): T | null {
  return sets.reduce<T | null>((best, s) => (!best || compareSets(s, best, unit) > 0 ? s : best), null);
}

/**
 * Which sets were PRs when logged: each beats every set before it. The first set ever is not a PR (there was nothing to beat),
 * so a new exercise doesn't open with trophies. Sets must be in the order they were done.
 */
export function prFlags(sets: SetLike[], unit: WeightUnit = "lb"): boolean[] {
  let best: SetLike | null = null;
  return sets.map((s) => {
    const pr = !!best && compareSets(s, best, unit) > 0;
    if (!best || compareSets(s, best, unit) > 0) best = s;
    return pr;
  });
}

/** "Last time": the sets from the latest date before `date`, in the order they were done. */
export function lastTime<T extends SetLike>(sets: T[], date: string): T[] {
  const before = sets.filter((s) => s.date < date);
  if (!before.length) return [];
  const last = before.reduce((d, s) => (s.date > d ? s.date : d), before[0].date);
  return before.filter((s) => s.date === last);
}

/** Estimated one-rep max (Epley): weight × (1 + reps/30), the weight itself for a single. Null with no weight. */
export function e1rm(weight: number | null, reps: number): number | null {
  if (weight == null || weight <= 0 || reps <= 0) return null;
  return r1(reps === 1 ? weight : weight * (1 + reps / 30));
}

export type HistoryPoint = { date: string; top: { weight: number | null; reps: number }; e1rm: number | null; sets: number; volume: number };

/** One point per date, oldest first: the top set, its estimated 1RM, how many sets and the volume (weight × reps summed). */
export function historyOf(sets: SetLike[], unit: WeightUnit = "lb"): HistoryPoint[] {
  const dates = [...new Set(sets.map((s) => s.date))].sort();
  return dates.map((date) => {
    const day = sets.filter((s) => s.date === date);
    const top = bestSet(day, unit)!;
    const w = top.weight == null ? null : toUnit(top.weight, top.unit, unit);
    return { date, top: { weight: w, reps: top.reps }, e1rm: e1rm(w, top.reps), sets: day.length, volume: Math.round(day.reduce((a, s) => a + load(s, unit) * s.reps, 0)) };
  });
}

/** "185 × 5" in the member's unit; a bodyweight set is "12 reps", or "+25 × 12" with weight added. */
export function fmtSet(s: { weight: number | null; unit: WeightUnit; reps: number }, unit: WeightUnit, kind: "weight" | "bodyweight" = "weight"): string {
  const w = s.weight == null ? null : toUnit(s.weight, s.unit, unit);
  const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (kind === "bodyweight") return w ? `+${n(w)} × ${s.reps}` : `${s.reps} reps`;
  return `${w == null ? "—" : n(w)} × ${s.reps}`;
}

/** A routine line's target, "3 × 8–10" (reps are free text: "8–10", "AMRAP", "30s"). */
export const fmtTarget = (t: { sets: number; reps: string }) => `${t.sets} × ${t.reps || "?"}`;

/** What the next set's form opens with: today's last set, else last time's first set, else blank. */
export function nextSetDefaults(today: SetLike[], last: SetLike[], unit: WeightUnit): { weight: number | null; reps: number | null } {
  const from = today.length ? today[today.length - 1] : last[0];
  if (!from) return { weight: null, reps: null };
  return { weight: from.weight == null ? null : toUnit(from.weight, from.unit, unit), reps: from.reps };
}

/** The routine Training offers on a day: the first one tied to the day's type. */
export function routineForDay<T extends { dayTypeId: string | null }>(routines: T[], dayTypeId: string | null): T | null {
  if (!dayTypeId) return null;
  return routines.find((r) => r.dayTypeId === dayTypeId) ?? null;
}
