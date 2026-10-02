/**
 * Habits (B7, rev 196; rev 237 phase 8): the starter list, what "kept" means for each kind, the streak that forgives one missed
 * day a week, the week's dots and tallies. Positive framing only: nothing here produces a red mark or the word "failed"; a day
 * not kept is a gap, and the streak and the week carry the story. Pure functions over the member's habits and logs.
 */
import type { HabitKind } from "@/db/schema";

export type HabitLike = { id: string; name: string; kind: HabitKind; unit: string | null; target: number | null; days: number[]; /** The day it was added: a habit is never due before it existed (phase 10b). */ since?: string | null };
export type HabitLogLike = { habitId: string; date: string; value: number };

/** The starter list (rev 196), in its order. A member adds any of these in one tap, or their own. */
export const STARTER_HABITS: { name: string; kind: HabitKind; unit?: string; target?: number }[] = [
  { name: "Breathwork", kind: "done" },
  { name: "Meditation", kind: "minutes", target: 10 },
  { name: "Pages read", kind: "count", target: 20 },
  { name: "Stretching", kind: "done" },
  { name: "Sauna", kind: "minutes", target: 15 },
  { name: "Cold exposure", kind: "minutes", target: 3 },
  { name: "Walk / steps", kind: "count", unit: "steps", target: 10000 },
  { name: "Water", kind: "amount", unit: "oz", target: 130 },
  { name: "Electrolytes", kind: "done" },
  { name: "Supplements", kind: "done" },
  { name: "Sunlight", kind: "minutes", target: 10 },
  { name: "Journaling", kind: "done" },
  { name: "Gratitude", kind: "done" },
  { name: "No screens before bed", kind: "done" },
];

export const KIND_LABEL: Record<HabitKind, string> = { done: "done or not", minutes: "minutes", count: "a count", amount: "an amount" };
/** Sunday first, as weekday() counts: Th, Sa and Su where a day is one mark wide, never two Ts and two Ss (Danno, rev 365). */
export const DAY_LETTERS = ["Su", "M", "T", "W", "Th", "F", "Sa"];
/** Sunday first, where there is room for the name. */
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Due on this date: every day when no days are set, else when the weekday (0 = Sunday) is one of them; never before the habit existed. */
export const dueOn = (h: Pick<HabitLike, "days" | "since">, weekdayOf: number, date?: string): boolean => (!h.since || !date || date >= h.since) && (!h.days.length || h.days.includes(weekdayOf));

/** Kept: a done habit with a 1; a measured one at its target, or above zero when it has none. */
export function kept(h: Pick<HabitLike, "kind" | "target">, value: number | null | undefined): boolean {
  if (value == null) return false;
  if (h.kind === "done") return value >= 1;
  return h.target != null && h.target > 0 ? value >= h.target : value > 0;
}

/** "12 min", "20", "130 oz", "✓" for the chips and the lists. */
export function fmtHabitValue(h: Pick<HabitLike, "kind" | "unit">, value: number): string {
  if (h.kind === "done") return value >= 1 ? "✓" : "";
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (h.kind === "minutes") return `${n} min`;
  return h.unit ? `${n} ${h.unit}` : n;
}
/** "10 min a day", "20 a day", "130 oz a day", or "" without a target. */
export function fmtTarget(h: Pick<HabitLike, "kind" | "unit" | "target">): string {
  if (h.kind === "done" || h.target == null) return "";
  return `${fmtHabitValue(h, h.target)} a day`;
}

export type Dates = { addDays: (d: string, n: number) => string; weekday: (d: string) => number; startOfWeek: (d: string) => string };

/**
 * The streak: due days kept in a row, counted back from today. Today unlogged doesn't end it (the day isn't over). One missed
 * due day a calendar week is forgiven; a second in the same week ends the streak there. Capped at 400 days back.
 */
export function streak(h: HabitLike, logs: HabitLogLike[], today: string, dates: Dates): number {
  const value = new Map(logs.filter((l) => l.habitId === h.id).map((l) => [l.date, l.value]));
  const forgiven = new Set<string>();
  let n = 0;
  for (let back = 0; back < 400; back++) {
    const d = dates.addDays(today, -back);
    if (h.since && d < h.since) break;
    if (!dueOn(h, dates.weekday(d), d)) continue;
    if (kept(h, value.get(d))) {
      n++;
      continue;
    }
    if (back === 0) continue;
    const week = dates.startOfWeek(d);
    if (forgiven.has(week)) break;
    forgiven.add(week);
  }
  return n;
}

export type Dot = "kept" | "missed" | "off" | "today" | "ahead";
/** Seven dots, Monday to Sunday: kept, missed (a due day gone by without), off (not due), today (due, not yet kept), ahead. */
export function weekDots(h: HabitLike, logs: HabitLogLike[], monday: string, today: string, dates: Dates): Dot[] {
  const value = new Map(logs.filter((l) => l.habitId === h.id).map((l) => [l.date, l.value]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = dates.addDays(monday, i);
    if (!dueOn(h, dates.weekday(d), d)) return "off";
    if (kept(h, value.get(d))) return "kept";
    if (d > today) return "ahead";
    return d === today ? "today" : "missed";
  });
}

/** Due and kept across every habit over the days from `from` to `to`: "12 of 15 kept". */
export function habitsWeek(habits: HabitLike[], logs: HabitLogLike[], from: string, to: string, dates: Dates): { due: number; kept: number } {
  const value = new Map(logs.map((l) => [`${l.habitId}|${l.date}`, l.value]));
  let due = 0;
  let k = 0;
  for (let d = from; d <= to; d = dates.addDays(d, 1)) {
    for (const h of habits) {
      if (!dueOn(h, dates.weekday(d), d)) continue;
      due++;
      if (kept(h, value.get(`${h.id}|${d}`))) k++;
    }
  }
  return { due, kept: k };
}

/** Days as typed on the form (seven checkboxes "d0".."d6"): all seven ticked, or none, means every day. */
export function daysFrom(ticked: number[]): number[] {
  const set = [...new Set(ticked.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  return set.length === 7 || set.length === 0 ? [] : set;
}
/** "Mon, Wed, Fri" or "every day". */
export function fmtDays(days: number[]): string {
  if (!days.length) return "every day";
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(", ");
}
