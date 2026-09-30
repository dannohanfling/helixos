/**
 * The weekly rollup (rev 237 phase 6, rev 231's list): computed from the days, never stored. Nutrition averages over the days
 * with something logged, protein against its floor (the band's bottom) and fat against its ceiling (the band's top), days in
 * band among the finished days that had targets; the training tally; the week's average weight against last week's; and how
 * a weight goal is pacing. Everything here is pure and tested without a database.
 */
import type { Bands, Macros, Mark } from "@/lib/engine/body";

const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]): number | null => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export type WeekDay = { date: string; logged: number; totals: Macros; bands: Bands | null; worst: Mark | null; final: boolean };

export type NutritionWeek = {
  /** Days with something logged, of the days in the week that have passed (or today). */
  daysLogged: number;
  daysPassed: number;
  avgCal: number | null;
  avgP: number | null;
  /** The mean of the protein band's bottom over the logged days that had one: the floor to beat. */
  avgPFloor: number | null;
  avgF: number | null;
  /** The mean of the fat band's top over the logged days that had one: the ceiling to stay under. */
  avgFCeiling: number | null;
  avgC: number | null;
  /** Finished days with targets and something logged, and how many of them ended in band (✅ or over-is-fine). */
  daysJudged: number;
  daysInBand: number;
};

export function nutritionWeek(days: WeekDay[]): NutritionWeek {
  const logged = days.filter((d) => d.logged > 0);
  const judged = logged.filter((d) => d.final && d.bands && d.worst);
  return {
    daysLogged: logged.length,
    daysPassed: days.length,
    avgCal: mean(logged.map((d) => d.totals.cal)),
    avgP: mean(logged.map((d) => d.totals.p)),
    avgPFloor: mean(logged.flatMap((d) => (d.bands?.p ? [d.bands.p.min] : []))),
    avgF: mean(logged.map((d) => d.totals.f)),
    avgFCeiling: mean(logged.flatMap((d) => (d.bands?.f ? [d.bands.f.max] : []))),
    avgC: mean(logged.map((d) => d.totals.c)),
    daysJudged: judged.length,
    daysInBand: judged.filter((d) => d.worst === "in" || d.worst === "over_ok").length,
  };
}

export type TrainingWeek = { sessions: number; planned: number | null; sets: number; prs: number };

/** The week's average weight over its day figures, and how many days had one. */
export function weighWeek(figures: { weight: number }[]): { avg: number | null; days: number } {
  return { avg: mean(figures.map((f) => f.weight)), days: figures.length };
}

/** This minus last, to a tenth; null when either is missing. */
export const change = (now: number | null, before: number | null): number | null => (now != null && before != null ? r1(now - before) : null);

export type GoalPace = {
  target: number;
  by: string | null;
  /** How far the latest figure is from the target (negative means below it). */
  toGo: number;
  weeksLeft: number | null;
  /** What each week needs to move by to land on time (negative for a loss); null with no date or none left. */
  needPerWeek: number | null;
  /** What the 7-day average has moved by per week over the last four; null without enough history. */
  actualPerWeek: number | null;
  /** Ahead of or on the needed rate, when both are known. */
  onPace: boolean | null;
};

/**
 * A weight goal's pace: the gap, the weeks left, the rate needed against the rate of the last four weeks (7-day average now
 * against 28 days ago). Reaching the target already counts as on pace whatever the rate.
 */
export function goalPace(goal: { target: number; by: string | null } | null, latest: number | null, avgNow: number | null, avg28Ago: number | null, today: string, daysBetween: (a: string, b: string) => number): GoalPace | null {
  if (!goal || latest == null) return null;
  const toGo = r1(goal.target - latest);
  const daysLeft = goal.by ? daysBetween(today, goal.by) : null;
  const weeksLeft = daysLeft != null ? Math.max(0, r1(daysLeft / 7)) : null;
  const needPerWeek = weeksLeft != null && weeksLeft > 0 ? r1(toGo / weeksLeft) : null;
  const actualPerWeek = avgNow != null && avg28Ago != null ? r1((avgNow - avg28Ago) / 4) : null;
  let onPace: boolean | null = null;
  if (Math.abs(toGo) < 0.05) onPace = true;
  else if (needPerWeek != null && actualPerWeek != null) onPace = needPerWeek < 0 ? actualPerWeek <= needPerWeek : actualPerWeek >= needPerWeek;
  return { target: goal.target, by: goal.by, toGo, weeksLeft, needPerWeek, actualPerWeek, onPace };
}
