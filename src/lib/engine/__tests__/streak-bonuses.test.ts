import { describe, expect, it } from "vitest";
import { bonusFor, countsDay, unpaidBonuses, weekendBonus, type ActiveDays } from "../streak";

// 2026-10-12 is Monday; 17 and 18 are Saturday and Sunday.
const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
const activity = (dates: string[], repaired: string[] = []): ActiveDays => ({
  active: new Set(dates), repaired: new Set(repaired), ladder: new Set(dates.filter((d) => !repaired.includes(d))),
});

describe("countsDay", () => {
  it.each([
    ["2026-10-12", true], ["2026-10-13", true], ["2026-10-14", true],
    ["2026-10-15", true], ["2026-10-16", true], ["2026-10-17", false], ["2026-10-18", false],
  ])("classifies %s in both work-day modes", (date, weekday) => {
    expect(countsDay(date, "weekdays")).toBe(weekday);
    expect(countsDay(date, "all")).toBe(true);
  });

  it.each([
    ["2024-02-29", true], // Leap Thursday.
    ["2026-03-08", false], // Spring daylight saving Sunday.
    ["2026-11-01", false], // Autumn daylight saving Sunday.
    ["2027-12-31", true], ["2028-01-01", false],
  ])("uses the calendar date at the %s boundary", (date, weekday) => {
    expect(countsDay(date, "weekdays")).toBe(weekday);
    expect(countsDay(date, "all")).toBe(true);
  });
});

describe("weekendBonus", () => {
  it.each([
    ["2026-10-17", "2026-10-16"], ["2026-10-18", "2026-10-17"],
    ["2026-03-08", "2026-03-07"], ["2026-11-01", "2026-10-31"],
    ["2028-01-01", "2027-12-31"],
  ])("pays a flat 40 on active %s after active %s, only in all-day mode", (date, previous) => {
    const active = new Set([previous, date]);
    expect(weekendBonus(active, date, "all")).toBe(40);
    expect(weekendBonus(active, date, "weekdays")).toBe(0);
  });

  it("does not pay on a weekday even with an active predecessor", () => {
    expect(weekendBonus(new Set(["2026-10-18", "2026-10-19"]), "2026-10-19", "all")).toBe(0);
  });

  it("does not bridge a missing Saturday to pay Sunday", () => {
    expect(weekendBonus(new Set(["2026-10-16", "2026-10-18"]), "2026-10-18", "all")).toBe(0);
  });

  it.each(["2026-10-17", "2026-10-18"])("a first active day on %s earns no weekend bonus", (date) => {
    expect(weekendBonus(new Set([date]), date, "all")).toBe(0);
  });
});

describe("bonusFor", () => {
  it.each(["all", "weekdays"] as const)("returns the full weekday ladder and reasons in %s mode", (mode) => {
    const active = new Set(week);
    expect(week.slice(0, 5).map((date) => bonusFor(active, date, mode))).toEqual([
      { points: 10, reason: "Streak day 1", streakDay: 1 },
      { points: 20, reason: "Streak day 2", streakDay: 2 },
      { points: 40, reason: "Streak day 3", streakDay: 3 },
      { points: 80, reason: "Streak day 4", streakDay: 4 },
      { points: 160, reason: "Streak day 5", streakDay: 5 },
    ]);
    expect(bonusFor(active, "2026-10-19", mode)).toEqual({ points: 10, reason: "Streak day 1", streakDay: 1 });
  });

  it("starts at 10 midweek, then escalates again after a missed weekday", () => {
    expect(bonusFor(new Set(), "2026-10-14", "all")).toEqual({ points: 10, reason: "Streak day 1", streakDay: 1 });
    const active = new Set(["2026-10-12", "2026-10-14"]);
    expect(bonusFor(active, "2026-10-14", "all")).toEqual({ points: 10, reason: "Streak day 1", streakDay: 1 });
    expect(bonusFor(active, "2026-10-15", "all")).toEqual({ points: 20, reason: "Streak day 2", streakDay: 2 });
  });

  it.each(["2026-10-17", "2026-10-18"])("returns weekend metadata for %s without moving the weekday ladder", (date) => {
    expect(bonusFor(new Set(week), date, "all")).toEqual({ points: 40, reason: "Weekend streak +40", streakDay: 0 });
    expect(bonusFor(new Set(week), date, "weekdays")).toEqual({ points: 0, reason: "Weekend streak +40", streakDay: 0 });
    expect(bonusFor(new Set([date]), date, "all").points).toBe(0);
  });
});

describe("unpaidBonuses", () => {
  it("returns only active, unpaid dates, oldest first, including both range endpoints", () => {
    const days = activity(["2026-10-16", "2026-10-14", "2026-10-12", "2026-10-13", "2026-10-19"]);
    const paid = new Set(["2026-10-13"]);
    const before = activity([...days.active]);
    expect(unpaidBonuses(days, "all", paid, "2026-10-12", "2026-10-16")).toEqual([
      { date: "2026-10-12", bonus: { points: 10, reason: "Streak day 1", streakDay: 1 } },
      { date: "2026-10-14", bonus: { points: 40, reason: "Streak day 3", streakDay: 3 } },
      { date: "2026-10-16", bonus: { points: 10, reason: "Streak day 1", streakDay: 1 } },
    ]);
    expect(days).toEqual(before);
    expect(paid).toEqual(new Set(["2026-10-13"]));
  });

  it("uses prior activity outside the payment window to calculate the bonus", () => {
    expect(unpaidBonuses(activity(week), "all", new Set(), "2026-10-16", "2026-10-16")).toEqual([
      { date: "2026-10-16", bonus: { points: 160, reason: "Streak day 5", streakDay: 5 } },
    ]);
    expect(unpaidBonuses(activity(week), "all", new Set(), "2026-10-17", "2026-10-17")).toEqual([
      { date: "2026-10-17", bonus: { points: 40, reason: "Weekend streak +40", streakDay: 0 } },
    ]);
  });

  it.each(["all", "weekdays"] as const)("returns nothing for empty, fully paid or reversed ranges in %s mode", (mode) => {
    expect(unpaidBonuses(activity([]), mode, new Set(), "2026-10-12", "2026-10-18")).toEqual([]);
    expect(unpaidBonuses(activity(week), mode, new Set(week), "2026-10-12", "2026-10-18")).toEqual([]);
    expect(unpaidBonuses(activity(week), mode, new Set(), "2026-10-18", "2026-10-12")).toEqual([]);
  });

  it("filters zero-bonus weekends, including a first Saturday and a Sunday after a missed Saturday", () => {
    expect(unpaidBonuses(activity(["2026-10-17"]), "all", new Set(), "2026-10-17", "2026-10-17")).toEqual([]);
    expect(unpaidBonuses(activity(["2026-10-16", "2026-10-18"]), "all", new Set(), "2026-10-18", "2026-10-18")).toEqual([]);
    expect(unpaidBonuses(activity(week), "weekdays", new Set(), "2026-10-17", "2026-10-18")).toEqual([]);
  });

  it("does not let repaired dates feed either the weekday escalation or weekend bonus", () => {
    const days = activity(week, ["2026-10-13", "2026-10-16"]);
    expect(unpaidBonuses(days, "all", new Set(), "2026-10-14", "2026-10-14")).toEqual([
      { date: "2026-10-14", bonus: { points: 10, reason: "Streak day 1", streakDay: 1 } },
    ]);
    expect(unpaidBonuses(days, "all", new Set(), "2026-10-17", "2026-10-17")).toEqual([]);
    expect(days.repaired).toEqual(new Set(["2026-10-13", "2026-10-16"]));
  });

  it("pays each eligible day once and leaves no bonuses after those dates are marked paid", () => {
    const days = activity(week);
    const due = unpaidBonuses(days, "all", new Set(), "2026-10-12", "2026-10-18");
    expect(due.map((x) => x.bonus.points)).toEqual([10, 20, 40, 80, 160, 40, 40]);
    expect(due.reduce((sum, x) => sum + x.bonus.points, 0)).toBe(390);
    expect(unpaidBonuses(days, "all", new Set(due.map((x) => x.date)), "2026-10-12", "2026-10-18")).toEqual([]);
  });

  it("walks leap day and a year boundary with inclusive calendar dates", () => {
    expect(unpaidBonuses(activity(["2024-02-28", "2024-02-29", "2024-03-01"]), "all", new Set(), "2024-02-28", "2024-03-01").map((x) => [x.date, x.bonus.points])).toEqual([
      ["2024-02-28", 10], ["2024-02-29", 20], ["2024-03-01", 40],
    ]);
    expect(unpaidBonuses(activity(["2027-12-31", "2028-01-01", "2028-01-02", "2028-01-03"]), "all", new Set(), "2027-12-31", "2028-01-03").map((x) => [x.date, x.bonus.points])).toEqual([
      ["2027-12-31", 10], ["2028-01-01", 40], ["2028-01-02", 40], ["2028-01-03", 10],
    ]);
  });
});
