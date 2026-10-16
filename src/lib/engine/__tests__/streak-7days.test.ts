import { describe, expect, it } from "vitest";
import { activeDaysOf, activityDate, bonusFor, brokenStreak, handCreditedDate, initialsOf, planRecount, runningStreak, unpaidBonuses, weekendBonus, weeklyStreakDay, type ActiveDays, type RecountMember } from "../streak";

// 2026-10-05 is a Monday; 10, 11 the weekend; 12 the next Monday.
const run = (dates: string[]): ActiveDays => ({ active: new Set(dates), repaired: new Set(), ladder: new Set(dates) });
const row = (type: string, points: number, createdAt: string, extra: Partial<{ refId: string | null; adjustedBy: string | null }> = {}) => ({ type, points, createdAt, refId: null, adjustedBy: null, ...extra });

describe("the seven-day streak (H-289)", () => {
  it("an activity-only day keeps the streak: a task ticked, no close, counts as a day", () => {
    const tz = "America/Los_Angeles";
    const rows = [
      row("close", 20, "2026-10-05 02:00:00", { refId: "2026-10-05" }),
      // Tuesday: a task at 22:30 Pacific (05:30 UTC Wednesday): Tuesday's.
      row("task", 5, "2026-10-07 05:30:00", { refId: "task-1" }),
      row("close", 20, "2026-10-08 02:00:00", { refId: "2026-10-07" }),
    ];
    const days = activeDaysOf(rows, [], tz);
    expect([...days.active].sort()).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(runningStreak(days.active, "2026-10-07", "all")).toBe(3);
    // Without the task, Tuesday is a missed day on every day, bridged by nothing.
    const without = activeDaysOf(rows.filter((r) => r.type !== "task"), [], tz);
    expect(runningStreak(without.active, "2026-10-07", "all")).toBe(1);
    // And the ladder reads the same days: Wednesday is day 3, not day 1.
    expect(weeklyStreakDay(days.ladder, "2026-10-07")).toBe(3);
  });

  it("a streak bonus, a coach's adjustment, a redeem and a repair never make a day active; a log begun or closed does", () => {
    const tz = "Europe/London";
    expect(activityDate(row("streak", 40, "2026-10-10 20:00:00", { refId: "2026-10-10" }), tz)).toBeNull();
    expect(activityDate(row("bonus", 100, "2026-10-10 20:00:00", { adjustedBy: "coach" }), tz)).toBeNull();
    expect(activityDate(row("redeem", -50, "2026-10-10 20:00:00"), tz)).toBeNull();
    expect(activityDate(row("dm", 7, "2026-10-11 20:00:00", { refId: "activity:2026-10-10" }), tz)).toBe("2026-10-10");
    expect(activityDate(row("checkin", 10, "2026-10-11T07:00:00.000Z", { refId: "2026-10-11" }), tz)).toBe("2026-10-11");
    expect(activityDate(row("content", 15, "2026-10-11 23:30:00"), tz)).toBe("2026-10-12"); // BST: 00:30 the next day
    const days = activeDaysOf([], [{ date: "2026-10-06", morningDoneAt: "x", eveningDoneAt: null, repairedAt: null }, { date: "2026-10-07", morningDoneAt: null, eveningDoneAt: "x", repairedAt: "x" }], tz);
    expect([...days.active].sort()).toEqual(["2026-10-06", "2026-10-07"]);
    expect([...days.ladder]).toEqual(["2026-10-06"]); // the repaired day feeds the streak, never the ladder
  });

  it("a weekend day pays a flat +40 when it carries the streak on and never moves the ladder; a full week is 390", () => {
    const week = run(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
    const paid = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"].map((d) => bonusFor(week.ladder, d, "all"));
    expect(paid.map((b) => b.points)).toEqual([10, 20, 40, 80, 160, 40, 40]);
    expect(paid.reduce((a, b) => a + b.points, 0)).toBe(390);
    expect(paid[5].reason).toBe("Weekend streak +40");
    expect(paid[0].reason).toBe("Streak day 1");
    // Monday restarts at day 1 whatever the weekend did.
    expect(bonusFor(week.ladder, "2026-10-12", "all")).toMatchObject({ points: 10, streakDay: 1 });
    // A lone Saturday after a quiet Friday starts a streak but pays no weekend bonus; Sunday after it does.
    const lone = run(["2026-10-08", "2026-10-10", "2026-10-11"]);
    expect(weekendBonus(lone.active, "2026-10-10", "all")).toBe(0);
    expect(weekendBonus(lone.active, "2026-10-11", "all")).toBe(40);
    expect(runningStreak(lone.active, "2026-10-11", "all")).toBe(2);
    // On every day a quiet Saturday breaks the streak.
    const quietSat = run(["2026-10-08", "2026-10-09", "2026-10-11", "2026-10-12"]);
    expect(runningStreak(quietSat.active, "2026-10-12", "all")).toBe(2);
    expect(brokenStreak(quietSat.active, "2026-10-13", "all")).toBeNull(); // alive: Sunday and Monday
    const quietWeekend = run(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(brokenStreak(quietWeekend.active, "2026-10-11", "all")).toMatchObject({ lost: 5, endedOn: "2026-10-09", missed: ["2026-10-10"], repairable: true });
    expect(brokenStreak(quietWeekend.active, "2026-10-12", "all")!.repairable).toBe(false); // two days slipped
  });

  it("a Monday to Friday member is unchanged: weekends bridge, never break, never pay", () => {
    const days = run(["2026-10-08", "2026-10-09", "2026-10-11", "2026-10-12"]); // Thu, Fri, Sun, Mon
    expect(runningStreak(days.active, "2026-10-12", "weekdays")).toBe(3);
    expect(runningStreak(days.active, "2026-10-13", "weekdays")).toBe(3); // Tuesday morning, nothing yet
    expect(bonusFor(days.ladder, "2026-10-11", "weekdays").points).toBe(0);
    expect(bonusFor(days.ladder, "2026-10-12", "weekdays")).toMatchObject({ points: 10, streakDay: 1 });
    const quietWeekend = run(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(brokenStreak(quietWeekend.active, "2026-10-12", "weekdays")).toBeNull();
    expect(runningStreak(quietWeekend.active, "2026-10-12", "weekdays")).toBe(5);
  });

  it("the settle pays an unclosed active day once: a paid day is never paid again, and only inside the window", () => {
    const days = run(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-10", "2026-10-11"]);
    const due = unpaidBonuses(days, "all", new Set(["2026-10-05", "2026-10-06"]), "2026-10-01", "2026-10-11");
    expect(due.map((x) => [x.date, x.bonus.points])).toEqual([
      ["2026-10-07", 40],
      ["2026-10-11", 40],
    ]);
    // Paid: nothing more to pay, however often it runs.
    expect(unpaidBonuses(days, "all", new Set(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-11"]), "2026-10-01", "2026-10-11")).toEqual([]);
    // The window: a day before `from` or after `through` is not touched.
    expect(unpaidBonuses(days, "all", new Set(), "2026-10-08", "2026-10-10").map((x) => x.date)).toEqual([]);
    expect(unpaidBonuses(days, "all", new Set(), "2026-10-07", "2026-10-07").map((x) => x.date)).toEqual(["2026-10-07"]);
  });

  it("reads the day a coach credited by hand from the adjustment's reason", () => {
    const made = "2026-10-12 14:00:00";
    expect(handCreditedDate("Streak bonus credited to 2026-10-10", made)).toBe("2026-10-10");
    expect(handCreditedDate("Day 2 streak, credited to Oct 10", made)).toBe("2026-10-10");
    expect(handCreditedDate("credited to October 11th", made)).toBe("2026-10-11");
    expect(handCreditedDate("Credited to 10 Oct", made)).toBe("2026-10-10");
    expect(handCreditedDate("credited to 10/11", made)).toBe("2026-10-11");
    expect(handCreditedDate("credited to Dec 30", "2026-01-02 09:00:00")).toBe("2025-12-30"); // the year before, not the future
    expect(handCreditedDate("Great week", made)).toBeNull();
    expect(handCreditedDate("credited to the team", made)).toBeNull();
  });

  it("the recount skips hand-credited days, pays through yesterday, and a rerun adds nothing", () => {
    const member: RecountMember = {
      userId: "u1",
      initials: "M.F.",
      days: "all",
      activity: run(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]),
      paid: new Set(["2026-10-05", "2026-10-08", "2026-10-09"]),
      handPaid: new Set(["2026-10-10", "2026-10-11"]),
      asOf: "2026-10-13",
    };
    const plan = planRecount([member]);
    expect(plan.rows[0].add).toEqual([
      { date: "2026-10-06", points: 20, reason: "Streak recount: 2026-10-06" },
      { date: "2026-10-07", points: 40, reason: "Streak recount: 2026-10-07" },
      { date: "2026-10-12", points: 10, reason: "Streak recount: 2026-10-12" },
    ]);
    expect(plan.rows[0].skipped).toEqual(["2026-10-10", "2026-10-11"]);
    expect(plan.rows[0].points).toBe(70);
    expect(plan.rows[0].streak).toBe(9);
    expect(plan.totals).toEqual({ members: 1, days: 3, points: 70, skipped: 2 });
    // Applied: every day paid; the rerun finds nothing to add and still skips the hand-paid days.
    const again = planRecount([{ ...member, paid: new Set([...member.paid, ...plan.rows[0].add.map((x) => x.date)]) }]);
    expect(again.rows[0].add).toEqual([]);
    expect(again.totals).toEqual({ members: 1, days: 0, points: 0, skipped: 2 });
    // A Monday to Friday member: the weekend days pay nothing and the ladder is the same.
    const weekdays = planRecount([{ ...member, days: "weekdays", handPaid: new Set() }]);
    expect(weekdays.rows[0].add.map((x) => x.date)).toEqual(["2026-10-06", "2026-10-07", "2026-10-12"]);
    expect(weekdays.rows[0].streak).toBe(7);
  });

  it("initials, never a name", () => {
    expect(initialsOf("Maya Fernandez")).toBe("M.F.");
    expect(initialsOf("Danno")).toBe("D.");
    expect(initialsOf("  ")).toBe("?");
  });
});
