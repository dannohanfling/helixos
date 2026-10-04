/**
 * The post-workout read (handoff rev 471): a session's numbers turned into a few plain lines, the same on Training, on Today and
 * through the connector. Pure: the query gathers the sets, the last time and the PR per exercise, the routine's targets, the
 * member's note and what WHOOP recorded; this decides what is worth saying. Arithmetic and fixed rules only, no model: the same
 * session always reads the same. It never gives medical advice: a note that mentions pain or an injury is noted, with one line
 * to check with a professional if it keeps up.
 */
import type { WeightUnit } from "@/lib/engine/body-training";

export type ReadSet = { weight: number | null; reps: number; pr?: boolean };
export type ReadExercise = {
  exerciseId: string;
  name: string;
  /** "weight" for loaded lifts; anything else counts reps alone. */
  kind: string;
  targetSets: number | null;
  /** The routine's reps target as written: "8", "8-12", "8–12", "AMRAP". */
  targetReps: string | null;
  /** A weight the member accepted for next time (the routine's own). */
  targetWeight: number | null;
  today: ReadSet[];
  last: ReadSet[];
  lastDate: string | null;
  pr: { weight: number | null; reps: number; date: string } | null;
  /** Sessions in a row, ending today, whose top set was the same. */
  sameTopSessions: number;
};
export type GymActivity = { sport: string; minutes: number; startedAt: string | null; endedAt: string | null; strain: number | null };
export type WorkoutInput = {
  unit: WeightUnit;
  routineName: string | null;
  note: string | null;
  plan: { done: number; planned: number } | null;
  /** WHOOP's lifting workout for the session, when it recorded one. */
  lifting: { minutes: number; strain: number | null } | null;
  /** What WHOOP recorded around it: stretching, sauna. */
  gym: GymActivity[];
  /** The whole visit, first start to last end, when WHOOP gives the times. */
  gymMinutes: number | null;
  exercises: ReadExercise[];
  /** Days since this routine last ran before today. */
  daysSinceRoutine: number | null;
};
export type NextTarget = { exerciseId: string; exercise: string; weight: number | null; reps: string | null; why: string; add: boolean };
export type WorkoutRead = { lines: string[]; exercises: { exerciseId: string; name: string; trend: "up" | "held" | "down" | "first"; line: string }[]; next: NextTarget[]; care: boolean };

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const loaded = (x: ReadExercise) => x.kind === "weight";
const setText = (s: ReadSet, unit: WeightUnit, x: ReadExercise) => (loaded(x) && s.weight != null ? `${num(s.weight)} ${unit} × ${s.reps}` : `${s.reps} reps${s.weight ? ` +${num(s.weight)} ${unit}` : ""}`);

/** The best set: the heaviest, then the most reps at that weight. */
export function topSet(sets: ReadSet[]): ReadSet | null {
  return sets.reduce<ReadSet | null>((best, s) => (!best || (s.weight ?? 0) > (best.weight ?? 0) || ((s.weight ?? 0) === (best.weight ?? 0) && s.reps > best.reps) ? s : best), null);
}
export const volume = (sets: ReadSet[], x: ReadExercise): number => sets.reduce((a, s) => a + (loaded(x) ? (s.weight ?? 0) * s.reps : s.reps), 0);

/** Up, held or down against last time: the top set first (weight, then reps at that weight), then the volume. */
export function trendOf(today: ReadSet[], last: ReadSet[], x: ReadExercise): "up" | "held" | "down" | "first" {
  if (!last.length) return "first";
  const a = topSet(today)!;
  const b = topSet(last)!;
  if ((a.weight ?? 0) !== (b.weight ?? 0)) return (a.weight ?? 0) > (b.weight ?? 0) ? "up" : "down";
  if (a.reps !== b.reps) return a.reps > b.reps ? "up" : "down";
  const va = volume(today, x);
  const vb = volume(last, x);
  return va > vb * 1.02 ? "up" : va < vb * 0.98 ? "down" : "held";
}

/** Reps falling across sets at one weight, by three or more first to last: "12, 10, 7". Null when the sets held. */
export function fadeOf(today: ReadSet[]): { weight: number | null; reps: number[] } | null {
  const byWeight = new Map<string, number[]>();
  for (const s of today) byWeight.set(String(s.weight ?? 0), [...(byWeight.get(String(s.weight ?? 0)) ?? []), s.reps]);
  for (const [w, reps] of byWeight) {
    if (reps.length < 2) continue;
    const falling = reps.every((r, i) => i === 0 || r <= reps[i - 1]);
    if (falling && reps[0] - reps[reps.length - 1] >= 3) return { weight: Number(w) || null, reps };
  }
  return null;
}

/** The top of a reps target: "8-12" → 12, "10" → 10, "AMRAP" → null. */
export const topReps = (target: string | null): number | null => {
  const ns = (target ?? "").match(/\d+/g)?.map(Number) ?? [];
  return ns.length ? Math.max(...ns) : null;
};

const SMALL = /cable|dumbbell|\bdb\b|curl|raise|fly|flye|extension|pushdown|kickback|face ?pull|lateral|rear delt|shrug/i;
/** The smallest sensible step: 2.5 lb (1 kg) on a cable or dumbbell, 5 lb (2.5 kg) on a machine or barbell. */
export const stepFor = (name: string, unit: WeightUnit): number => (SMALL.test(name) ? (unit === "kg" ? 1 : 2.5) : unit === "kg" ? 2.5 : 5);

/**
 * Next time, where earned: every set at the top weight reached the top of the reps target (and the planned sets were done) →
 * add the smallest step; a fade or a missed target → the same weight again. Nothing when there's no target to read.
 */
export function nextFor(x: ReadExercise, unit: WeightUnit): NextTarget | null {
  const top = topSet(x.today);
  const goal = topReps(x.targetReps);
  if (!top || goal == null) return null;
  const atTop = x.today.filter((s) => (s.weight ?? 0) === (top.weight ?? 0));
  const allSets = x.targetSets == null || x.today.length >= x.targetSets;
  const earned = allSets && atTop.every((s) => s.reps >= goal) && !fadeOf(x.today);
  if (!loaded(x) || top.weight == null) return earned ? { exerciseId: x.exerciseId, exercise: x.name, weight: top.weight, reps: x.targetReps, why: `every set reached ${goal}: add a rep or a little load`, add: false } : null;
  if (earned) {
    const w = Math.round((top.weight + stepFor(x.name, unit)) * 10) / 10;
    return { exerciseId: x.exerciseId, exercise: x.name, weight: w, reps: x.targetReps, why: `every set reached ${goal} reps at ${num(top.weight)} ${unit}`, add: true };
  }
  return { exerciseId: x.exerciseId, exercise: x.name, weight: top.weight, reps: x.targetReps, why: fadeOf(x.today) ? "the reps faded: the same weight again" : `not every set reached ${goal}: the same weight again`, add: false };
}

const CARE = /\bpain|hurt|injur|tweak|sprain|strain(ed)? (my|a|the)|sharp|twinge|pulled (a|my)/i;

export function workoutRead(w: WorkoutInput): WorkoutRead {
  const done = w.exercises.filter((x) => x.today.length);
  const lines: string[] = [];
  const head = [
    w.plan && w.plan.planned ? `${w.plan.done} of ${w.plan.planned} planned sets done` : `${done.reduce((a, x) => a + x.today.length, 0)} sets`,
    w.lifting ? `${Math.round(w.lifting.minutes)} min${w.lifting.strain != null ? `, strain ${w.lifting.strain}` : ""}` : "",
  ].filter(Boolean);
  lines.push(`${w.routineName ? `${w.routineName}: ` : ""}${head.join(" · ")}.`);
  if (w.gym.length) lines.push(`At the gym: ${w.gym.map((g) => `${g.sport.toLowerCase()} ${Math.round(g.minutes)} min`).join(", ")}${w.gymMinutes ? `; ${Math.round(w.gymMinutes)} min in all` : ""}.`);
  if (w.note?.trim()) lines.push(`You wrote: “${w.note.trim().slice(0, 140)}”.`);

  const exercises = done.map((x) => {
    const trend = trendOf(x.today, x.last, x);
    const top = topSet(x.today)!;
    const prToday = x.today.some((s) => s.pr);
    const vs = x.last.length ? ` (last ${setText(topSet(x.last)!, w.unit, x)})` : "";
    const fromPr = !prToday && x.pr ? `; PR ${setText({ weight: x.pr.weight, reps: x.pr.reps }, w.unit, x)}` : "";
    return { exerciseId: x.exerciseId, name: x.name, trend, line: `${x.name}: ${trend === "first" ? "first time" : trend} at ${setText(top, w.unit, x)}${vs}${prToday ? ", a new PR" : fromPr}.` };
  });
  // The few worth saying first: new PRs, then what dropped, faded or has stood still.
  const notes: string[] = [];
  const prs = done.filter((x) => x.today.some((s) => s.pr)).map((x) => x.name);
  if (prs.length) notes.push(`New PR${prs.length === 1 ? "" : "s"}: ${prs.join(", ")}.`);
  const up = exercises.filter((e) => e.trend === "up").map((e) => e.name);
  const down = exercises.filter((e) => e.trend === "down").map((e) => e.name);
  if (up.length || down.length) notes.push([up.length ? `Up on ${up.join(", ")}` : "", down.length ? `down on ${down.join(", ")}` : ""].filter(Boolean).join("; ").replace(/^d/, "D") + ".");
  for (const x of done) {
    const f = fadeOf(x.today);
    if (f) notes.push(`${x.name} faded: ${f.reps.join(", ")}${f.weight ? ` at ${num(f.weight)} ${w.unit}` : ""}.`);
  }
  for (const x of done) if (x.sameTopSessions >= 3) notes.push(`${x.name} has stayed at ${setText(topSet(x.today)!, w.unit, x)} for ${x.sameTopSessions} sessions.`);
  if (w.daysSinceRoutine != null && w.daysSinceRoutine >= 14) notes.push(`The first ${w.routineName ?? "session of this routine"} in ${w.daysSinceRoutine} days.`);
  lines.push(...notes.slice(0, 3));
  const care = !!w.note && CARE.test(w.note);
  if (care) lines.push("Noted. If it keeps up, check with a professional.");
  const next = done.map((x) => nextFor(x, w.unit)).filter((n): n is NextTarget => !!n);
  return { lines, exercises, next, care };
}

/** Sessions in a row, newest first and starting with today's, whose top set matched: 1 when only today had it. */
export function sameTopRun(sessions: ReadSet[][]): number {
  const key = (s: ReadSet[]) => {
    const t = topSet(s);
    return t ? `${t.weight ?? 0}x${t.reps}` : "";
  };
  const first = sessions[0] ? key(sessions[0]) : "";
  let n = 0;
  for (const s of sessions) {
    if (key(s) !== first || !first) break;
    n++;
  }
  return n;
}

/**
 * The gym visit around a lifting workout (rev 471): WHOOP activities that start within an hour before it or end within an hour
 * after it, on the same day, belong to the session; the rest stay on their own. The visit runs from the first start to the last end.
 */
export function gymGroup<T extends GymActivity>(acts: T[], isLift: (sport: string) => boolean): { lift: T | null; around: T[]; others: T[]; minutes: number | null } {
  const lifts = acts.filter((a) => isLift(a.sport) && a.startedAt && a.endedAt);
  const lift = lifts.sort((a, b) => b.minutes - a.minutes)[0] ?? null;
  if (!lift) return { lift: null, around: [], others: acts.filter((a) => a !== lift), minutes: null };
  const from = Date.parse(lift.startedAt!) - 3_600_000;
  const to = Date.parse(lift.endedAt!) + 3_600_000;
  const around = acts.filter((a) => a !== lift && a.startedAt && a.endedAt && Date.parse(a.endedAt) >= from && Date.parse(a.startedAt) <= to && !isLift(a.sport));
  const visit = [lift, ...around];
  const start = Math.min(...visit.map((a) => Date.parse(a.startedAt!)));
  const end = Math.max(...visit.map((a) => Date.parse(a.endedAt!)));
  return { lift, around, others: acts.filter((a) => a !== lift && !around.includes(a)), minutes: Math.round((end - start) / 60_000) };
}
