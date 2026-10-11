/**
 * The training plan (rev 648): which routine goes on which day, worked out fresh from the member's day types, their rotation,
 * the routine pinned to the weekend and what they've logged. Nothing here is stored; Training's Today card, the next 7 days,
 * the week's planned count, Today's HumanOS line and the connector all read this one function, so they can't disagree.
 */
import { addDays, weekday } from "@/lib/dates";

/** What the member set under Settings → Training plan. `liftTypes` null: every day type but one named Off or Rest. */
export type TrainingPlanSettings = { rotation: string[]; weekend: string | null; liftTypes: string[] | null };

export const EMPTY_PLAN: TrainingPlanSettings = { rotation: [], weekend: null, liftTypes: null };

/** A plan with something in it: a rotation or a weekend routine. Without one, Training works as it did before rev 648. */
export const planSetUp = (p: TrainingPlanSettings | null | undefined): p is TrainingPlanSettings => !!p && (p.rotation.length > 0 || !!p.weekend);

/** A day type is a lift day when it's ticked; with nothing ticked yet, when its name isn't Off or Rest. */
export function liftTypeIds(plan: TrainingPlanSettings | null | undefined, types: { id: string; name: string }[]): Set<string> {
  if (plan?.liftTypes) return new Set(plan.liftTypes.filter((id) => types.some((t) => t.id === id)));
  return new Set(types.filter((t) => !/\b(off|rest)\b/i.test(t.name)).map((t) => t.id));
}

/** One day going in: its day type (after the refeed rule and any by-hand type), Off by hand, a routine picked by hand, its session. */
export type PlanDayIn = { date: string; dayTypeId: string | null; off: boolean; pick: string | null; session: { routineId: string | null; sets: number; completed: boolean } | null };

export type PlanDay = {
  date: string;
  /** Sunday 0 … Saturday 6. */
  weekday: number;
  dayTypeId: string | null;
  lift: boolean;
  routineId: string | null;
  /**
   * Why this routine: done or started (logged), swap (picked by hand), weekend (the pinned routine), rotation, rest, or none
   * (a lift day with nothing to plan).
   */
  why: "done" | "started" | "swap" | "weekend" | "rotation" | "rest" | "none";
  /** "Legs missed last weekend": the weekend routine, carried to this Saturday. */
  carried: boolean;
};

/**
 * The plan from `days[0]` on (today first, in date order), by rev 648's rule:
 * - Off days follow day types: a day is a lift day when its type is a lift type and it isn't marked Off.
 * - The weekend routine goes on Saturday; on Sunday when Saturday had no session of it; never on a weekday; missed both days, it
 *   goes on next Saturday, `carried`.
 * - Every other lift day takes the rotation routine done longest ago (never done counts oldest; ties by rotation order), and each
 *   planned day counts as done for the ones after it, so a missed day slides and doing another routine re-plans by itself.
 * - A routine picked by hand for a day stands; a day with a session shows what was logged.
 * `history` is every past session with a set (before `days[0]`), any order.
 */
export function planDays(days: PlanDayIn[], plan: TrainingPlanSettings, opts: { liftTypes: Set<string>; routineIds: Set<string>; history: { date: string; routineId: string | null }[] }): PlanDay[] {
  const today = days[0]?.date ?? "";
  const weekend = plan.weekend && opts.routineIds.has(plan.weekend) ? plan.weekend : null;
  const rotation = plan.rotation.filter((id, i) => id !== weekend && opts.routineIds.has(id) && plan.rotation.indexOf(id) === i);
  const last = new Map<string, string>();
  const did = new Map<string, Set<string>>();
  const mark = (date: string, routineId: string | null) => {
    if (!routineId) return;
    if ((last.get(routineId) ?? "") < date) last.set(routineId, date);
    if (!did.has(date)) did.set(date, new Set());
    did.get(date)!.add(routineId);
  };
  for (const h of opts.history) if (h.date < today) mark(h.date, h.routineId);
  const weekendOn = (date: string) => !!weekend && !!did.get(date)?.has(weekend);

  const out: PlanDay[] = [];
  for (const d of days) {
    const wd = weekday(d.date);
    const lift = !d.off && !!d.dayTypeId && opts.liftTypes.has(d.dayTypeId);
    const base = { date: d.date, weekday: wd, dayTypeId: d.dayTypeId, lift, carried: false };
    let day: PlanDay;
    if (d.session && (d.session.sets > 0 || d.session.routineId)) {
      day = { ...base, routineId: d.session.routineId, why: d.session.sets > 0 ? (d.session.completed ? "done" : "started") : "started" };
    } else if (!lift) {
      day = { ...base, routineId: null, why: "rest" };
    } else if (d.pick && opts.routineIds.has(d.pick)) {
      day = { ...base, routineId: d.pick, why: "swap" };
    } else if (weekend && (wd === 6 || (wd === 0 && !weekendOn(addDays(d.date, -1))))) {
      // Saturday by default; Sunday when Saturday's lift didn't happen (no session of it, or set Off).
      day = { ...base, routineId: weekend, why: "weekend", carried: wd === 6 && !weekendOn(addDays(d.date, -7)) && !weekendOn(addDays(d.date, -6)) && doneBefore(did, weekend, addDays(d.date, -7)) };
    } else if (rotation.length) {
      const next = [...rotation].sort((a, b) => (last.get(a) ?? "").localeCompare(last.get(b) ?? "") || rotation.indexOf(a) - rotation.indexOf(b))[0];
      day = { ...base, routineId: next, why: "rotation" };
    } else {
      day = { ...base, routineId: null, why: "none" };
    }
    out.push(day);
    // A planned day counts as done for the days after it; a session started with nothing in it yet counts the same.
    mark(d.date, day.routineId);
  }
  return out;
}

/** Was the weekend routine done at all before `before`? A brand new plan with nothing logged never says "missed". */
function doneBefore(did: Map<string, Set<string>>, id: string, before: string): boolean {
  for (const [date, ids] of did) if (date < before && ids.has(id)) return true;
  return false;
}

/** "Mon Chest, Tue rest, Wed Back…": the week said in one line, for the connector. */
export function planSpoken(days: { weekday: number; routineName: string | null; lift: boolean }[]): string {
  const short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days.map((d) => `${short[d.weekday]} ${d.routineName ? d.routineName.replace(/\s+day$/i, "") : d.lift ? "lift, nothing planned" : "rest"}`).join(", ");
}

/** "Lift", "Off", "Refeed": the day type's name, or Off for a day marked Off by hand. */
export const typeLabel = (d: { offByHand: boolean; lift: boolean; dayType: { name: string } | null }) => (d.offByHand ? "Off" : (d.dayType?.name ?? (d.lift ? "Lift" : "Off")));

/** Today's HumanOS line (rev 648): "Lift · Back Day · 6 exercises", "Done · Back Day", "Off · Rest". */
export function planLine(d: { lift: boolean; why: PlanDay["why"]; typeName: string; name: string | null; exercises: number }): string {
  if (d.why === "done") return `Done · ${d.name ?? "Workout"}`;
  if (d.why === "started") return `${d.typeName} · ${d.name ?? "Workout"} · going`;
  if (!d.lift) return `${d.typeName} · Rest`;
  if (!d.name) return `${d.typeName} · nothing planned`;
  return `${d.typeName} · ${d.name}${d.exercises ? ` · ${d.exercises} exercise${d.exercises === 1 ? "" : "s"}` : ""}`;
}

/* ───────── The main muscle groups, read from exercise names ───────── */

/** First match wins: an exercise name to the muscles it mostly works, the first one primary. */
const MUSCLE_RULES: [RegExp, string[]][] = [
  [/tricep|skull ?crusher|push ?down|kick ?back|close[- ]grip/i, ["Triceps"]],
  [/leg curl|hamstring|\brdl\b|romanian|good ?morning|nordic/i, ["Hamstrings", "Glutes"]],
  [/\bcurls?\b|bicep|preacher|hammer/i, ["Biceps"]],
  [/\bcalf|calves/i, ["Calves"]],
  [/squat|leg press|lunge|leg extension|\bquads?\b|hack|step[- ]?ups?|split/i, ["Quads", "Glutes"]],
  [/glute|hip thrust|bridge|abduct/i, ["Glutes"]],
  [/deadlift/i, ["Back", "Hamstrings"]],
  [/lateral raise|side raise|rear delt|reverse fl(y|ye)|face pull|upright row|shrug/i, ["Shoulders"]],
  [/shoulder|overhead|\bohp\b|military|arnold|\bdelts?\b|front raise/i, ["Shoulders", "Triceps"]],
  [/bench|chest|\bpecs?\b|\bfl(y|ye|ies)\b|push[- ]?ups?|\bdips?\b|crossover|incline|decline/i, ["Chest", "Triceps"]],
  [/\brows?\b|pull[- ]?downs?|pull[- ]?ups?|chin[- ]?ups?|\blats?\b|back extension|pullover/i, ["Back", "Biceps"]],
  [/crunch|plank|\babs?\b|\bcore\b|sit[- ]?ups?|leg raise|russian|wood ?chop|pallof/i, ["Core"]],
];

/** The muscles a single exercise works, by its name; none when the name doesn't say. */
export function musclesOf(name: string): string[] {
  return MUSCLE_RULES.find(([re]) => re.test(name))?.[1] ?? [];
}

/** A routine's main muscle groups, "Chest · Triceps": a primary counts 1, a secondary ½; the top `max`, most worked first. */
export function mainMuscles(names: string[], max = 3): string[] {
  const score = new Map<string, number>();
  for (const n of names) musclesOf(n).forEach((m, i) => score.set(m, (score.get(m) ?? 0) + (i === 0 ? 1 : 0.5)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([m]) => m);
}

/* ───────── How long a routine takes ───────── */

/** "about 60 min": the middle of the last 5 sessions of a routine, first set to last plus 5 minutes, to the nearest 5. Null without one. */
export function roughLength(sessions: { first: string; last: string }[]): number | null {
  const mins = sessions
    .slice(-5)
    .map((s) => (stamp(s.last) - stamp(s.first)) / 60000)
    .filter((m) => Number.isFinite(m) && m > 0)
    .map((m) => m + 5)
    .sort((a, b) => a - b);
  if (!mins.length) return null;
  const mid = mins.length % 2 ? mins[(mins.length - 1) / 2] : (mins[mins.length / 2 - 1] + mins[mins.length / 2]) / 2;
  return Math.max(5, Math.round(mid / 5) * 5);
}

/** SQLite's "2026-10-11 07:30:12" (UTC) as a time. */
const stamp = (s: string) => Date.parse(`${s.replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"}`);
