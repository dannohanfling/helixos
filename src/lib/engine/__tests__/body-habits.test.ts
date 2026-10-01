import { describe, expect, it } from "vitest";
import { addDays, startOfWeek, weekday } from "@/lib/dates";
import { STARTER_HABITS, daysFrom, dueOn, fmtDays, fmtHabitValue, fmtTarget, habitsWeek, kept, streak, weekDots, type HabitLike } from "@/lib/engine/body-habits";
import { fmtHours, parseHours, sleepAverages, sleepWeek } from "@/lib/engine/body-recovery";

const dates = { addDays, weekday, startOfWeek };
const done: HabitLike = { id: "h1", name: "Breathwork", kind: "done", unit: null, target: null, days: [] };
const med: HabitLike = { id: "h2", name: "Meditation", kind: "minutes", unit: null, target: 10, days: [] };
const water: HabitLike = { id: "h3", name: "Water", kind: "amount", unit: "oz", target: null, days: [] };
const weekdaysOnly: HabitLike = { id: "h4", name: "Pages", kind: "count", unit: null, target: 20, days: [1, 2, 3, 4, 5] };
const log = (habitId: string, date: string, value = 1) => ({ habitId, date, value });

describe("habits (B7, rev 237 phase 8)", () => {
  it("the starter list has the fourteen of rev 196, each with a kind", () => {
    expect(STARTER_HABITS.map((h) => h.name)).toEqual(["Breathwork", "Meditation", "Pages read", "Stretching", "Sauna", "Cold exposure", "Walk / steps", "Water", "Electrolytes", "Supplements", "Sunlight", "Journaling", "Gratitude", "No screens before bed"]);
    expect(STARTER_HABITS.find((h) => h.name === "Water")).toEqual({ name: "Water", kind: "amount", unit: "oz", target: 130 });
  });
  it("kept: a done habit with its tick, a measured one at its target or above zero without one", () => {
    expect(kept(done, 1)).toBe(true);
    expect(kept(done, 0)).toBe(false);
    expect(kept(done, null)).toBe(false);
    expect(kept(med, 9)).toBe(false);
    expect(kept(med, 10)).toBe(true);
    expect(kept(water, 0)).toBe(false);
    expect(kept(water, 40)).toBe(true);
  });
  it("due days: every day with none set; the weekdays otherwise; seven or none ticked means every day", () => {
    expect(dueOn(done, 0)).toBe(true);
    expect(dueOn(weekdaysOnly, 0)).toBe(false);
    expect(dueOn(weekdaysOnly, 3)).toBe(true);
    expect(daysFrom([0, 1, 2, 3, 4, 5, 6])).toEqual([]);
    expect(daysFrom([5, 1, 3, 3])).toEqual([1, 3, 5]);
    expect(fmtDays([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(fmtDays([])).toBe("every day");
  });
  it("the streak counts back from today, lets today stand open, forgives one miss a calendar week and ends on the second", () => {
    // Today Thursday 2026-10-01. Kept Mon 28, Tue 29; missed Wed 30; today not yet logged → 2.
    const logs = [log("h1", "2026-09-28"), log("h1", "2026-09-29")];
    expect(streak(done, logs, "2026-10-01", dates)).toBe(2);
    // Logged today too → 3; the Wednesday miss is the week's one forgiven miss.
    expect(streak(done, [...logs, log("h1", "2026-10-01")], "2026-10-01", dates)).toBe(3);
    // Two misses in one week (Tue and Wed) end it at Monday: only today counts.
    expect(streak(done, [log("h1", "2026-09-28"), log("h1", "2026-10-01")], "2026-10-01", dates)).toBe(1);
    // A miss in each of two weeks is forgiven in each: Fri 25 kept, Sat 26 missed (prev week), Sun 27 kept, Mon kept, Tue kept, Wed missed, today kept → 6.
    const two = ["2026-09-25", "2026-09-27", "2026-09-28", "2026-09-29", "2026-10-01"].map((d) => log("h1", d));
    expect(streak(done, two, "2026-10-01", dates)).toBe(5);
    // A weekday-only habit skips the weekend: Fri 25 kept, Mon 28 kept, Tue 29 kept, Wed 30 missed (forgiven), today open → 3.
    const wk = ["2026-09-25", "2026-09-28", "2026-09-29"].map((d) => log("h4", d, 20));
    expect(streak(weekdaysOnly, wk, "2026-10-01", dates)).toBe(3);
    // A measured habit under target isn't kept.
    expect(streak(med, [log("h2", "2026-10-01", 5), log("h2", "2026-09-30", 10)], "2026-10-01", dates)).toBe(1);
  });
  it("the week's dots: kept, missed, off, today, ahead, Monday to Sunday", () => {
    const logs = [log("h4", "2026-09-28", 20), log("h4", "2026-09-30", 20)];
    expect(weekDots(weekdaysOnly, logs, "2026-09-28", "2026-10-01", dates)).toEqual(["kept", "missed", "kept", "today", "ahead", "off", "off"]);
  });
  it("the week's tally: due and kept across habits over the days passed", () => {
    const logs = [log("h1", "2026-09-28"), log("h1", "2026-09-29"), log("h4", "2026-09-28", 25), log("h4", "2026-09-29", 5)];
    // Mon–Wed: done due 3 (kept 2); pages due 3 (kept 1).
    expect(habitsWeek([done, weekdaysOnly], logs, "2026-09-28", "2026-09-30", dates)).toEqual({ due: 6, kept: 3 });
  });
  it("values and targets read as words", () => {
    expect(fmtHabitValue(med, 12)).toBe("12 min");
    expect(fmtHabitValue(water, 130)).toBe("130 oz");
    expect(fmtHabitValue(weekdaysOnly, 20)).toBe("20");
    expect(fmtHabitValue(done, 1)).toBe("✓");
    expect(fmtTarget(med)).toBe("10 min a day");
    expect(fmtTarget(done)).toBe("");
  });
});

describe("sleep (rev 237 phase 8)", () => {
  it("hours parse from 7:30, 7.5 and 7h 30m; and read back as hours and minutes", () => {
    expect(parseHours("7:30")).toBe(7.5);
    expect(parseHours("7.5")).toBe(7.5);
    expect(parseHours("7h 30m")).toBe(7.5);
    expect(parseHours("8")).toBe(8);
    expect(parseHours("late")).toBeNull();
    expect(fmtHours(7.5)).toBe("7 h 30 min");
    expect(fmtHours(8)).toBe("8 h");
  });
  it("a week of nights: the average, the count, and the nights at the 7 h floor", () => {
    expect(sleepWeek([{ date: "2026-09-28", hours: 7.5 }, { date: "2026-09-29", hours: 6 }, { date: "2026-09-30", hours: 8 }])).toEqual({ avg: 7.2, nights: 3, atFloor: 2 });
    expect(sleepWeek([])).toEqual({ avg: null, nights: 0, atFloor: 0 });
  });
  it("the trailing average needs three nights within seven days", () => {
    const nights = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-10-05"].map((date, i) => ({ date, hours: 6 + i }));
    const between = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    expect(sleepAverages(nights, between)).toEqual([null, null, 7, null]);
  });
});
