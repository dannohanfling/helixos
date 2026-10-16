import { describe, expect, it } from "vitest";
import { todayInTz } from "@/lib/dates";
import { runningStreak, streakBonus, weeklyStreakDay } from "../streak";

// Weekday-mode coverage preserves the original streak rules.
const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];

describe("streakBonus", () => {
  it.each([
    [-1, 0], [0, 0], [1, 10], [2, 20], [3, 40],
    [4, 80], [5, 160], [6, 160], [100, 160],
  ])("day %i earns %i points", (day, bonus) => {
    expect(streakBonus(day)).toBe(bonus);
  });
});

describe("weeklyStreakDay", () => {
  it("counts each consecutive weekday including the pending close", () => {
    const closed = new Set<string>();
    for (const [index, date] of week.entries()) {
      expect(weeklyStreakDay(closed, date)).toBe(index + 1);
      closed.add(date);
      expect(weeklyStreakDay(closed, date)).toBe(index + 1);
    }
  });

  it.each(["2026-10-17", "2026-10-18"])("gives no weekend escalation on %s, even if closed", (date) => {
    expect(weeklyStreakDay(new Set(week), date)).toBe(0);
    expect(weeklyStreakDay(new Set([...week, date]), date)).toBe(0);
  });

  it("restarts on Monday even after a full closed week and weekend", () => {
    expect(weeklyStreakDay(new Set([...week, "2026-10-17", "2026-10-18"]), "2026-10-19")).toBe(1);
  });

  it("starts at one on a first close midweek and restarts after a missed weekday", () => {
    expect(weeklyStreakDay(new Set(), "2026-10-14")).toBe(1);
    const closed = new Set(["2026-10-12", "2026-10-14"]);
    expect(weeklyStreakDay(closed, "2026-10-14")).toBe(1);
    expect(weeklyStreakDay(closed, "2026-10-15")).toBe(2);
    expect([...closed]).toEqual(["2026-10-12", "2026-10-14"]);
  });
});

describe("runningStreak", () => {
  it.each(["2026-10-12", "2026-10-17", "2026-10-18"])("has no streak without closes on %s", (today) => {
    expect(runningStreak(new Set(), today, "weekdays")).toBe(0);
  });

  it("counts the first close and keeps it alive until the next weekday ends", () => {
    const closed = new Set(["2026-10-12"]);
    expect(runningStreak(closed, "2026-10-12", "weekdays")).toBe(1);
    expect(runningStreak(closed, "2026-10-13", "weekdays")).toBe(1);
    expect(runningStreak(closed, "2026-10-14", "weekdays")).toBe(0);
  });

  it.each(["2026-10-17", "2026-10-18", "2026-10-19"])("bridges the weekend through %s without extending it", (today) => {
    expect(runningStreak(new Set(week), today, "weekdays")).toBe(5);
    expect(runningStreak(new Set([...week, "2026-10-17", "2026-10-18"]), today, "weekdays")).toBe(5);
  });

  it("extends across Monday while the weekly bonus resets", () => {
    const closed = new Set([...week, "2026-10-19"]);
    expect(runningStreak(closed, "2026-10-19", "weekdays")).toBe(6);
    expect(weeklyStreakDay(closed, "2026-10-19")).toBe(1);
  });

  it("does not forgive a missed weekday, and a new close starts a fresh run", () => {
    const closed = new Set(["2026-10-12", "2026-10-13"]);
    expect(runningStreak(closed, "2026-10-15", "weekdays")).toBe(0);
    closed.add("2026-10-15");
    expect(runningStreak(closed, "2026-10-15", "weekdays")).toBe(1);
    closed.add("2026-10-16");
    expect(runningStreak(closed, "2026-10-16", "weekdays")).toBe(2);
  });

  it("weekend closes cannot start a streak or mend a missed Friday", () => {
    expect(runningStreak(new Set(["2026-10-17", "2026-10-18"]), "2026-10-19", "weekdays")).toBe(0);
    const closed = new Set(["2026-10-15", "2026-10-17", "2026-10-18"]);
    expect(runningStreak(closed, "2026-10-18", "weekdays")).toBe(0);
    expect(runningStreak(closed, "2026-10-19", "weekdays")).toBe(0);
  });

  it.each([
    ["2026-03-06", "2026-03-09"], // Spring daylight saving transition.
    ["2026-10-30", "2026-11-02"], // Autumn transition and month boundary.
    ["2027-12-31", "2028-01-03"], // Year boundary.
    ["2024-02-28", "2024-02-29"], // Leap day.
  ])("counts consecutive weekdays across %s to %s", (previous, today) => {
    expect(runningStreak(new Set([previous, today]), today, "weekdays")).toBe(2);
  });

  it("uses the supplied local date at midnight rather than the UTC calendar day", () => {
    const closed = new Set(["2026-10-15"]);
    const before = todayInTz("America/Los_Angeles", new Date("2026-10-17T06:59:59Z"));
    const after = todayInTz("America/Los_Angeles", new Date("2026-10-17T07:00:00Z"));
    expect(before).toBe("2026-10-16");
    expect(after).toBe("2026-10-17");
    expect(runningStreak(closed, before, "weekdays")).toBe(1);
    expect(runningStreak(closed, after, "weekdays")).toBe(0);
  });

  it("ignores future closes and insertion order without changing the input", () => {
    const dates = ["2026-10-16", "2026-10-13", "2026-10-12"];
    const closed = new Set(dates);
    expect(runningStreak(closed, "2026-10-14", "weekdays")).toBe(2);
    expect([...closed]).toEqual(dates);
  });
});
