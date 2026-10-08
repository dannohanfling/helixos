import { describe, expect, it } from "vitest";
import { daysInMonth, elapsed, formatKpi, kpiActual, mondayOf, pace, periodWindow, readKpi, recordPace, weeklySeries, type KpiRow } from "../kpi";

/** Business goals BG2: the KPI's window, its actual from its source, linear pace, the weekly chart, a record's pace. */
const kpi = (over: Partial<KpiRow>): KpiRow => ({ id: "k", recordId: "r", name: "Calls booked", unit: "count", target: 12, period: "month", periodStart: null, periodEnd: null, source: "numbers", metric: "callsBooked", archivedAt: null, ...over });
const logs = [{ date: "2026-10-02", callsBooked: 2 }, { date: "2026-10-09", callsBooked: 3 }, { date: "2026-10-20", callsBooked: 4 }, { date: "2026-09-30", callsBooked: 9 }];
const values = [{ kpiId: "m", date: "2026-10-03", value: 100 }, { kpiId: "m", date: "2026-10-12", value: 250 }, { kpiId: "other", date: "2026-10-12", value: 999 }];

describe("KPIs", () => {
  it("windows: the week from Monday, the month, the quarter, the year, the KPI's own range", () => {
    expect(mondayOf("2026-10-08")).toBe("2026-10-05");
    expect(daysInMonth("2026-10")).toBe(31);
    expect(periodWindow(kpi({ period: "week" }), "2026-10-08")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(periodWindow(kpi({ period: "month" }), "2026-10-08")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodWindow(kpi({ period: "quarter" }), "2026-11-20")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodWindow(kpi({ period: "year" }), "2026-10-08")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodWindow(kpi({ period: "range", periodStart: "2026-10-01", periodEnd: "2026-10-14" }), "2026-10-08")).toEqual({ from: "2026-10-01", to: "2026-10-14" });
  });
  it("the actual: a Numbers KPI sums its counter over the window; a typed one sums its own values", () => {
    const w = { from: "2026-10-01", to: "2026-10-31" };
    expect(kpiActual(kpi({}), w, logs, values)).toBe(9);
    expect(kpiActual(kpi({ id: "m", source: "manual", unit: "$" }), w, logs, values)).toBe(350);
    expect(kpiActual(kpi({ id: "m", source: "close" }), { from: "2026-10-10", to: "2026-10-31" }, logs, values)).toBe(250);
  });
  it("pace is linear: half the month gone, half the target due; ahead at 105% of that, on at 85%, else behind; done at the target", () => {
    const w = { from: "2026-10-01", to: "2026-10-31" };
    expect(elapsed(w, "2026-10-16")).toBeCloseTo(16 / 31, 5);
    expect(pace(7, 12, w, "2026-10-16")).toBe("ahead");
    expect(pace(6, 12, w, "2026-10-16")).toBe("on");
    expect(pace(4, 12, w, "2026-10-16")).toBe("behind");
    expect(pace(12, 12, w, "2026-10-16")).toBe("done");
    expect(pace(3, 0, w, "2026-10-16")).toBe("none");
    expect(readKpi(kpi({}), "2026-10-16", logs, values)).toMatchObject({ actual: 9, expected: 6, pace: "ahead", pct: 75 });
  });
  it("the chart: the actual cumulative by week against the straight target line, weeks after today marked", () => {
    const s = weeklySeries(kpi({}), { from: "2026-10-01", to: "2026-10-31" }, "2026-10-16", logs, values);
    expect(s.map((p) => p.week)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(s.map((p) => p.actual)).toEqual([2, 5, 5, 9, 9]);
    expect(s.map((p) => p.target)).toEqual([2, 4, 7, 10, 12]);
    expect(s.map((p) => p.future)).toEqual([false, false, false, true, true]);
  });
  it("a record's pace from its KPIs, and the words", () => {
    const r = (p: "ahead" | "on" | "behind" | "done" | "none") => ({ kpi: kpi({}), window: { from: "", to: "" }, actual: 0, expected: 0, pace: p, pct: 0 });
    expect(recordPace([])).toBe("none");
    expect(recordPace([r("on"), r("ahead")])).toBe("on");
    expect(recordPace([r("ahead"), r("done")])).toBe("ahead");
    expect(recordPace([r("on"), r("behind")])).toBe("behind");
    expect(recordPace([r("done"), r("done")])).toBe("done");
    expect(formatKpi(1200, "$")).toBe("$1,200");
    expect(formatKpi(40, "%")).toBe("40%");
    expect(formatKpi(12, "count")).toBe("12");
    expect(formatKpi(2.5, "hours")).toBe("2.5 hours");
  });
});
