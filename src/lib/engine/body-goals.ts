/**
 * Goals (rev 508 §5): several at once, of six kinds, each paced the same way. Pure: the series come in already read.
 *
 * - A trend goal (a scale number, the waist, a lift, average sleep) runs from its start to its target on the 7-day average
 *   (a lift on its best weight for the reps so far). It compares the rate a week it needs with the rate over the last 3 weeks,
 *   says on track, a little behind or behind, and the date it lands at the current rate.
 * - A count goal (a habit, workouts) is days or sessions a week: the last 3 weeks' average against the target.
 * - Past about 1% of bodyweight a week, or 0.5 points of body fat, it says "that's an aggressive pace" and names a gentler date.
 *   It never suggests eating less: the advice is the date, not the plate.
 */
import type { BodyGoalKind } from "@/db/schema";
import { METRIC, fmtMetric, isMetricKey, storedValue } from "@/lib/engine/body-scale";
import { toUnit, type WeightUnit } from "@/lib/engine/body-training";

export type Point = { date: string; value: number };
export type GoalLike = { kind: BodyGoalKind; key: string; refId: string | null; reps: number | null; target: number; by: string | null; startValue: number | null; startDate: string | null; createdAt: string; archivedAt: string | null };
export type GoalState = "done" | "on_track" | "a_little_behind" | "behind" | "no_data";
export type GoalStatus = {
  current: number | null;
  start: number | null;
  target: number;
  /** 0 to 1, start to target. */
  progress: number;
  toGo: number | null;
  needPerWeek: number | null;
  actualPerWeek: number | null;
  state: GoalState;
  /** At the current rate, when it lands; null when it isn't moving that way. */
  projected: string | null;
  /** The pace a date asks for is past the safe rate: the rate and a gentler date. */
  aggressive: { limitPerWeek: number; gentlerBy: string } | null;
};
type Dates = { addDays: (d: string, n: number) => string; daysBetween: (a: string, b: string) => number };

export const COUNT_KINDS = new Set<BodyGoalKind>(["habit", "training"]);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The 7-day average ending on a date; else the latest point in the 14 days before it; else null. */
export function levelAt(points: Point[], date: string, d: Dates): number | null {
  const from = d.addDays(date, -6);
  const week = points.filter((p) => p.date >= from && p.date <= date);
  if (week.length) return week.reduce((a, p) => a + p.value, 0) / week.length;
  const back = points.filter((p) => p.date <= date && p.date >= d.addDays(date, -14));
  return back.length ? back[back.length - 1].value : null;
}
/** A lift's best so far on a date: the heaviest weight lifted for the goal's reps or more. */
export function bestAt(points: Point[], date: string): number | null {
  const upto = points.filter((p) => p.date <= date);
  return upto.length ? Math.max(...upto.map((p) => p.value)) : null;
}
/** Days with an entry in the 7 days ending on a date. */
export function countIn(points: Point[], from: string, to: string): number {
  return new Set(points.filter((p) => p.date >= from && p.date <= to).map((p) => p.date)).size;
}

/** The safe rate a week, for the goals that have one: 1% of bodyweight for weight, half a point for body fat. */
export function safeRate(g: Pick<GoalLike, "kind" | "key">, current: number | null): number | null {
  if (g.kind !== "scale" || current == null) return null;
  if (g.key === "weight") return r2(current * 0.01);
  if (g.key === "bf") return 0.5;
  return null;
}

export function goalStatus(g: GoalLike, points: Point[], today: string, d: Dates): GoalStatus {
  if (COUNT_KINDS.has(g.kind)) {
    const current = countIn(points, d.addDays(today, -6), today);
    const avg3 = countIn(points, d.addDays(today, -20), today) / 3;
    const started = g.startDate ?? g.createdAt.slice(0, 10);
    // Three weeks in, the average speaks; before that, this week does.
    const rate = d.daysBetween(started, today) >= 20 ? avg3 : current;
    const state: GoalState = rate >= g.target ? "on_track" : rate >= g.target * 0.75 ? "a_little_behind" : "behind";
    return { current, start: null, target: g.target, progress: Math.min(1, g.target > 0 ? current / g.target : 0), toGo: Math.max(0, g.target - current), needPerWeek: g.target, actualPerWeek: r2(avg3), state, projected: null, aggressive: null };
  }
  const at = (date: string) => (g.kind === "lift" ? bestAt(points, date) : levelAt(points, date, d));
  const current = at(today);
  const startDate = g.startDate ?? g.createdAt.slice(0, 10);
  const start = g.startValue ?? at(startDate) ?? points.find((p) => p.date >= startDate)?.value ?? null;
  const empty: GoalStatus = { current, start, target: g.target, progress: 0, toGo: null, needPerWeek: null, actualPerWeek: null, state: "no_data", projected: null, aggressive: null };
  if (current == null || start == null) return empty;
  const dir = Math.sign(g.target - start) || Math.sign(g.target - current) || 1;
  const toGo = r2(g.target - current);
  const span = g.target - start;
  const progress = span === 0 ? 1 : Math.max(0, Math.min(1, (current - start) / span));
  const before = at(d.addDays(today, -21));
  const actualPerWeek = before != null ? r2((current - before) / 3) : null;
  if (dir * (current - g.target) >= 0) return { ...empty, progress: 1, toGo: 0, actualPerWeek, state: "done" };
  const daysLeft = g.by ? d.daysBetween(today, g.by) : null;
  const needPerWeek = daysLeft != null && daysLeft > 0 ? r2(toGo / Math.max(daysLeft / 7, 1 / 7)) : null;
  const toward = actualPerWeek != null && dir * actualPerWeek > 0;
  const projected = toward ? d.addDays(today, Math.ceil((Math.abs(toGo) / Math.abs(actualPerWeek!)) * 7)) : null;
  let state: GoalState;
  if (actualPerWeek == null) state = "no_data";
  else if (daysLeft != null && daysLeft <= 0) state = "behind";
  else if (needPerWeek != null) {
    const ratio = actualPerWeek / needPerWeek;
    state = ratio >= 0.9 ? "on_track" : ratio >= 0.5 ? "a_little_behind" : "behind";
  } else state = toward ? "on_track" : Math.abs(actualPerWeek) < Math.abs(toGo) * 0.01 ? "a_little_behind" : "behind";
  const limit = safeRate(g, current);
  const aggressive = limit != null && needPerWeek != null && Math.abs(needPerWeek) > limit ? { limitPerWeek: limit, gentlerBy: d.addDays(today, Math.ceil((Math.abs(toGo) / limit) * 7)) } : null;
  return { current, start, target: g.target, progress, toGo, needPerWeek, actualPerWeek, state, projected, aggressive };
}

export const STATE_WORDS: Record<GoalState, string> = { done: "Reached", on_track: "On track", a_little_behind: "A little behind", behind: "Behind", no_data: "Not enough to go on yet" };

/** Which goals the Today card shows: the two that need it most (behind first), then the nearest dates. */
export function topGoals<T extends { goal: GoalLike; status: GoalStatus }>(list: T[], n = 2): T[] {
  const rank: Record<GoalState, number> = { behind: 0, a_little_behind: 1, on_track: 2, no_data: 3, done: 4 };
  return list
    .filter((x) => !x.goal.archivedAt)
    .slice()
    .sort((a, b) => rank[a.status.state] - rank[b.status.state] || (a.goal.by ?? "9999").localeCompare(b.goal.by ?? "9999"))
    .slice(0, n);
}

/**
 * The end-of-day read's line for tomorrow when a goal is behind (rev 508 §5): one concrete thing for that kind, never eating
 * less. Null when none is behind.
 */
export function goalTomorrow(list: { title: string; kind: BodyGoalKind; state: GoalState }[]): string | null {
  const g = list.find((x) => x.state === "behind");
  if (!g) return null;
  if (g.kind === "habit") return `Tomorrow: ${g.title} is behind its goal, so do it first thing.`;
  if (g.kind === "training") return `Tomorrow: ${g.title} is behind, so fit a workout in if the day allows.`;
  if (g.kind === "sleep") return `Tomorrow: ${g.title} is behind, so start winding down half an hour earlier tonight.`;
  if (g.kind === "lift") return `Tomorrow: ${g.title} is behind. If it's on the plan, give it your best set while you're fresh.`;
  return `Tomorrow: ${g.title} is behind its date. Keep the day inside its bands and look at the date on Health goals.`;
}

/* ───────── Words and units ───────── */


const CM_PER_IN = 2.54;
const r1 = (n: number) => Math.round(n * 10) / 10;
const num = (n: number) => r1(n).toLocaleString("en-US", { maximumFractionDigits: 1 });

/** A value of this goal in the member's units: "175 lb", "32 in" (or "81.3 cm"), "225 lb", "7.5 h", "5 days". */
export function fmtGoal(g: Pick<GoalLike, "kind" | "key">, v: number, unit: WeightUnit): string {
  if (g.kind === "scale" && isMetricKey(g.key)) return fmtMetric(g.key, v, unit);
  if (g.kind === "waist") return unit === "kg" ? `${num(v * CM_PER_IN)} cm` : `${num(v)} in`;
  if (g.kind === "lift") return `${num(toUnit(v, "lb", unit))} ${unit}`;
  if (g.kind === "sleep") return `${num(v)} h`;
  if (g.kind === "habit") return `${Math.round(v)} day${Math.round(v) === 1 ? "" : "s"}`;
  return `${Math.round(v)} workout${Math.round(v) === 1 ? "" : "s"}`;
}
/** A rate a week in the member's units, signed: "−0.6 lb", "+2.5 lb". */
export function fmtRate(g: Pick<GoalLike, "kind" | "key">, v: number, unit: WeightUnit): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtGoal(g, Math.abs(v), unit)}`;
}
/** The member's typed target in the stored unit: masses to lb, a waist to inches. */
export function storedTarget(g: Pick<GoalLike, "kind" | "key">, typed: number, unit: WeightUnit): number {
  if (g.kind === "scale" && isMetricKey(g.key)) return storedValue(g.key, typed, unit);
  if (g.kind === "waist") return unit === "kg" ? r2(typed / CM_PER_IN) : typed;
  if (g.kind === "lift") return toUnit(typed, unit, "lb");
  return typed;
}
export const waistUnit = (unit: WeightUnit) => (unit === "kg" ? "cm" : "in");

/** "Weight to 175 lb by Dec 1", "Bench Press 225 lb × 5", "Meditate 5 days a week", "Train 4 times a week", "Sleep 7.5 h a night". */
export function goalTitle(g: GoalLike, name: string | null, unit: WeightUnit, fmtDate: (d: string) => string): string {
  const by = g.by ? ` by ${fmtDate(g.by)}` : "";
  if (g.kind === "scale") return `${isMetricKey(g.key) ? METRIC[g.key].label : g.key} to ${fmtGoal(g, g.target, unit)}${by}`;
  if (g.kind === "waist") return `Waist to ${fmtGoal(g, g.target, unit)}${by}`;
  if (g.kind === "lift") return `${name ?? "A lift"} ${fmtGoal(g, g.target, unit)} × ${g.reps ?? 1}${by}`;
  if (g.kind === "sleep") return `Sleep ${fmtGoal(g, g.target, unit)} a night on average${by}`;
  if (g.kind === "habit") return `${name ?? "A habit"} ${fmtGoal(g, g.target, unit)} a week`;
  return `Train ${Math.round(g.target)} time${Math.round(g.target) === 1 ? "" : "s"} a week`;
}

/** The goal's one line under its bar: where it is, the rates, and when it lands; the aggressive note when the date asks too much. */
export function statusLine(g: GoalLike, s: GoalStatus, unit: WeightUnit, fmtDate: (d: string) => string): string {
  const v = (n: number) => fmtGoal(g, n, unit);
  if (COUNT_KINDS.has(g.kind)) return `${STATE_WORDS[s.state]}: ${s.current} this week, ${num(s.actualPerWeek ?? 0)} a week over the last 3 weeks, against ${Math.round(g.target)}.`;
  if (s.state === "no_data") return s.current == null ? "Nothing logged for this yet." : `${v(s.current)} now. Three weeks of entries show the pace.`;
  if (s.state === "done") return `Reached: ${v(s.current!)} against ${v(g.target)}.`;
  const parts = [`${STATE_WORDS[s.state]}: ${v(s.start!)} → ${v(s.current!)} of ${v(g.target)}`];
  if (s.needPerWeek != null) parts.push(`${fmtRate(g, s.needPerWeek, unit)} a week needed`);
  if (s.actualPerWeek != null) parts.push(`${fmtRate(g, s.actualPerWeek, unit)} a week lately`);
  let line = `${parts.join(", ")}.`;
  if (s.projected) line += ` At this rate, ${fmtDate(s.projected)}.`;
  if (s.aggressive) line += ` That's an aggressive pace: past ${fmtGoal(g, s.aggressive.limitPerWeek, unit)} a week. ${fmtDate(s.aggressive.gentlerBy)} is gentler.`;
  return line;
}
