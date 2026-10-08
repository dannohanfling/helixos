/**
 * Business goals BG2: KPIs as measures. Pure. A KPI's actual is read from where its source says (a daily-log counter summed
 * over the period, or the values typed by hand or asked for in the close); pace is linear across the period: half the period
 * gone, half the target due. A key result with KPIs is on pace when every one of them is; without, its status stands.
 */
import type { KpiPeriod, KpiSource } from "@/db/schema";
import { addDays } from "@/lib/dates";

/** The days in a month, "YYYY-MM". */
export const daysInMonth = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export type KpiRow = { id: string; recordId: string; name: string; unit: string; target: number; period: KpiPeriod; periodStart: string | null; periodEnd: string | null; source: KpiSource; metric: string | null; archivedAt: string | null };
export type ValueRow = { kpiId: string; date: string; value: number };
export type LogRow = Record<string, unknown> & { date: string };
export type Window = { from: string; to: string };
export type Pace = "ahead" | "on" | "behind" | "done" | "none";

/** The Monday of the week a day is in. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return addDays(day, -back);
}
/** The period's window on a day: the week (Monday to Sunday), the month, the quarter, the year, or the KPI's own range. */
export function periodWindow(kpi: Pick<KpiRow, "period" | "periodStart" | "periodEnd">, today: string): Window {
  const y = today.slice(0, 4);
  const m = Number(today.slice(5, 7));
  if (kpi.period === "week") { const from = mondayOf(today); return { from, to: addDays(from, 6) }; }
  if (kpi.period === "month") { const month = today.slice(0, 7); return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` }; }
  if (kpi.period === "quarter") { const q0 = Math.floor((m - 1) / 3) * 3 + 1; const last = `${y}-${String(q0 + 2).padStart(2, "0")}`; return { from: `${y}-${String(q0).padStart(2, "0")}-01`, to: `${last}-${String(daysInMonth(last)).padStart(2, "0")}` }; }
  if (kpi.period === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  const from = kpi.periodStart ?? today;
  const to = kpi.periodEnd ?? from;
  return from <= to ? { from, to } : { from: to, to: from };
}
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
/** How much of the window has gone by today, 0 to 1. */
export function elapsed(w: Window, today: string): number {
  if (today < w.from) return 0;
  if (today > w.to) return 1;
  return Math.max(0, Math.min(1, daysBetween(w.from, today) / daysBetween(w.from, w.to)));
}
/** The KPI's actual over its window: the counter summed from the logs, or the typed values summed. */
export function kpiActual(kpi: KpiRow, w: Window, logs: readonly LogRow[], values: readonly ValueRow[]): number {
  if (kpi.source === "numbers") {
    const key = kpi.metric ?? "";
    return logs.filter((l) => l.date >= w.from && l.date <= w.to).reduce((a, l) => a + Number(l[key] ?? 0), 0);
  }
  return values.filter((v) => v.kpiId === kpi.id && v.date >= w.from && v.date <= w.to).reduce((a, v) => a + v.value, 0);
}
/** Linear pace: ahead at 105% of what the day asks, on at 85%, else behind; done at the target; none with no target. */
export function pace(actual: number, target: number, w: Window, today: string): Pace {
  if (!(target > 0)) return "none";
  if (actual >= target) return "done";
  const expected = target * elapsed(w, today);
  if (expected <= 0) return actual > 0 ? "ahead" : "on";
  return actual >= expected * 1.05 ? "ahead" : actual >= expected * 0.85 ? "on" : "behind";
}
export const PACE_LABEL: Record<Pace, string> = { ahead: "Ahead", on: "On pace", behind: "Behind", done: "Done", none: "No target" };
export const PACE_TONE: Record<Pace, "neutral" | "good" | "warn" | "accent"> = { ahead: "good", on: "good", behind: "warn", done: "accent", none: "neutral" };

export type KpiRead = { kpi: KpiRow; window: Window; actual: number; expected: number; pace: Pace; pct: number };
/** One KPI read on a day. */
export function readKpi(kpi: KpiRow, today: string, logs: readonly LogRow[], values: readonly ValueRow[]): KpiRead {
  const window = periodWindow(kpi, today);
  const actual = kpiActual(kpi, window, logs, values);
  return { kpi, window, actual, expected: Math.round(kpi.target * elapsed(window, today)), pace: pace(actual, kpi.target, window, today), pct: kpi.target > 0 ? Math.min(999, Math.round((actual / kpi.target) * 100)) : 0 };
}
/** The chart's points: the actual, cumulative by week across the window, against the straight target line. */
export function weeklySeries(kpi: KpiRow, w: Window, today: string, logs: readonly LogRow[], values: readonly ValueRow[]): { week: string; actual: number; target: number; future: boolean }[] {
  const out: { week: string; actual: number; target: number; future: boolean }[] = [];
  let running = 0;
  const total = daysBetween(w.from, w.to);
  for (let monday = mondayOf(w.from); monday <= w.to; monday = addDays(monday, 7)) {
    const from = monday < w.from ? w.from : monday;
    const to = addDays(monday, 6) > w.to ? w.to : addDays(monday, 6);
    running += kpiActual(kpi, { from, to }, logs, values);
    out.push({ week: monday, actual: running, target: Math.round((kpi.target * daysBetween(w.from, to)) / total), future: from > today });
  }
  return out;
}
/** A record's pace from its KPIs: on pace when every KPI is on, ahead or done; behind when any is behind; none without KPIs. */
export function recordPace(reads: readonly KpiRead[]): Pace {
  const live = reads.filter((r) => r.pace !== "none");
  if (!live.length) return "none";
  if (live.some((r) => r.pace === "behind")) return "behind";
  if (live.every((r) => r.pace === "done")) return "done";
  return live.some((r) => r.pace === "ahead") && live.every((r) => r.pace !== "on") ? "ahead" : "on";
}
/** A value as the unit reads: "$1,200", "12", "40%". */
export function formatKpi(value: number, unit: string): string {
  if (unit === "$") return `$${Math.round(value).toLocaleString()}`;
  if (unit === "%") return `${Math.round(value)}%`;
  return `${Number.isInteger(value) ? value : Math.round(value * 10) / 10}${unit === "count" || !unit ? "" : ` ${unit}`}`;
}
