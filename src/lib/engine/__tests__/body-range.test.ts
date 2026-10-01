import { describe, expect, it } from "vitest";
import { addDays, startOfWeek } from "@/lib/dates";
import { calendarWeeks, mondaysIn, perWeek, rangeBounds, rateText, stepRange } from "@/lib/engine/body-range";

const dates = { addDays, startOfWeek };
const today = "2026-10-01"; // a Thursday

describe("longer views (rev 237 phase 10b)", () => {
  it("bounds: a week from its Monday, a calendar month capped at today, 90 days and a year ending on the day asked, each with the span before it", () => {
    expect(rangeBounds("week", null, today, dates)).toMatchObject({ from: "2026-09-28", to: "2026-10-01", prevFrom: "2026-09-21", prevTo: "2026-09-27", label: "Week of 2026-09-28" });
    expect(rangeBounds("month", null, today, dates)).toMatchObject({ from: "2026-10-01", to: "2026-10-01", label: "October 2026", prevFrom: "2026-09-01", prevTo: "2026-09-30" });
    expect(rangeBounds("month", "2026-09-15", today, dates)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "September 2026", anchor: "2026-09-01" });
    expect(rangeBounds("90d", null, today, dates)).toMatchObject({ from: "2026-07-04", to: "2026-10-01", prevFrom: "2026-04-05", prevTo: "2026-07-03" });
    expect(rangeBounds("year", "2026-06-30", today, dates)).toMatchObject({ from: "2025-07-01", to: "2026-06-30", label: "Year to 2026-06-30" });
    // A day after today is today.
    expect(rangeBounds("90d", "2027-01-01", today, dates).to).toBe(today);
  });
  it("stepping: back a week or a month, forward never past today", () => {
    const week = rangeBounds("week", null, today, dates);
    expect(stepRange(week, -1, today, dates)).toBe("2026-09-21");
    expect(stepRange(week, 1, today, dates)).toBeNull();
    const sept = rangeBounds("month", "2026-09-10", today, dates);
    expect(stepRange(sept, -1, today, dates)).toBe("2026-08-01");
    expect(stepRange(sept, 1, today, dates)).toBe("2026-10-01");
    expect(stepRange(rangeBounds("month", null, today, dates), 1, today, dates)).toBeNull();
    const q = rangeBounds("90d", "2026-08-01", today, dates);
    expect(stepRange(q, -1, today, dates)).toBe("2026-05-03");
    expect(stepRange(q, 1, today, dates)).toBe(today);
  });
  it("weeks inside a range, per-week sums and means, and the calendar strip's shape", () => {
    expect(mondaysIn("2026-09-10", "2026-09-30", dates)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
    const pts = [{ date: "2026-09-08", value: 2 }, { date: "2026-09-09", value: 4 }, { date: "2026-09-29", value: 7 }, { date: "2026-10-05", value: 100 }];
    expect(perWeek(pts, "2026-09-07", "2026-09-30", "sum", dates).map((w) => [w.monday, w.value, w.n])).toEqual([["2026-09-07", 6, 2], ["2026-09-14", 0, 0], ["2026-09-21", 0, 0], ["2026-09-28", 7, 1]]);
    expect(perWeek(pts, "2026-09-07", "2026-09-30", "mean", dates).map((w) => w.value)).toEqual([3, null, null, 7]);
    const strip = calendarWeeks("2026-09-29", "2026-10-05", today, dates, (d) => (d === "2026-09-30" ? 3 : 1), (d) => d);
    expect(strip).toHaveLength(2);
    expect(strip[0].days.map((d) => d.level)).toEqual([0, 1, 3, 1, 0, 0, 0]); // Mon 28 before the range; Fri 2 onward after today
    expect(strip[0].days[0].title).toBe("");
    expect(rateText(12, 15)).toBe("12 of 15 (80%)");
    expect(rateText(0, 0)).toBe("—");
  });
});
