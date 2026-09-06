import { describe, expect, it } from "vitest";
import { addDays, isWeekday, startOfWeek, todayInTz, weekday } from "@/lib/dates";
import { runningStreak, streakBonus, weeklyStreakDay } from "../streak";
import { nextTier, tierFor, tierProgress } from "../tiers";
import { closeActivityPoints, contentPoints, taskPoints } from "../points";
import { nextBestActions } from "../nba";

describe("dates", () => {
  it("knows weekdays", () => {
    expect(weekday("2026-09-07")).toBe(1); // Monday
    expect(isWeekday("2026-09-05")).toBe(false); // Saturday
    expect(startOfWeek("2026-09-10")).toBe("2026-09-07");
    expect(startOfWeek("2026-09-13")).toBe("2026-09-07"); // Sunday belongs to the week before
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });
  it("formats today in a timezone", () => {
    expect(todayInTz("America/Los_Angeles", new Date("2026-09-07T03:00:00Z"))).toBe("2026-09-06");
    expect(todayInTz("Europe/London", new Date("2026-09-07T03:00:00Z"))).toBe("2026-09-07");
  });
});

describe("streak", () => {
  it("escalates within a week and resets on Monday", () => {
    const closed = new Set(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
    expect(weeklyStreakDay(closed, "2026-09-07")).toBe(1);
    expect(weeklyStreakDay(closed, "2026-09-11")).toBe(5);
    expect(weeklyStreakDay(closed, "2026-09-14")).toBe(1); // next Monday restarts
  });
  it("drops back to day 1 after a missed weekday", () => {
    const closed = new Set(["2026-09-07", "2026-09-09"]);
    expect(weeklyStreakDay(closed, "2026-09-09")).toBe(1);
  });
  it("gives no escalation on weekends", () => {
    expect(weeklyStreakDay(new Set(), "2026-09-12")).toBe(0);
    expect(streakBonus(0)).toBe(0);
  });
  it("bonus ladder is 10/20/40/80/160 and caps", () => {
    expect([1, 2, 3, 4, 5, 9].map(streakBonus)).toEqual([10, 20, 40, 80, 160, 160]);
  });
  it("running streak bridges weekends and survives an unclosed today", () => {
    const closed = new Set(["2026-09-03", "2026-09-04", "2026-09-07"]); // Thu, Fri, Mon
    expect(runningStreak(closed, "2026-09-07")).toBe(3);
    expect(runningStreak(closed, "2026-09-08")).toBe(3); // Tuesday morning, not closed yet
    expect(runningStreak(closed, "2026-09-09")).toBe(0); // missed Tuesday
  });
});

describe("tiers", () => {
  it("maps points to the 9 tiers", () => {
    expect(tierFor(0).name).toBe("Artisan");
    expect(tierFor(99).name).toBe("Artisan");
    expect(tierFor(100).name).toBe("Philosopher");
    expect(tierFor(3000).name).toBe("Sentinel");
    expect(tierFor(99999).name).toBe("Olympian");
    expect(nextTier(60000)).toBeNull();
  });
  it("computes progress to the next tier", () => {
    const p = tierProgress(300);
    expect(p.current.name).toBe("Philosopher");
    expect(p.next?.name).toBe("Sage");
    expect(p.pct).toBe(50);
    expect(p.toNext).toBe(200);
  });
});

describe("points", () => {
  it("scores tasks and content", () => {
    expect(taskPoints("top3")).toBe(15);
    expect(taskPoints("medium")).toBe(5);
    expect(taskPoints("medium", 40)).toBe(40);
    expect(contentPoints(true)).toBe(25);
  });
  it("scores an evening close", () => {
    const r = closeActivityPoints({ dmsStarted: 3, conversations: 2, callsBooked: 1, callsHeld: 0, posts: 1 });
    expect(r.total).toBe(15 + 4 + 25 + 15);
    expect(r.lines.map((l) => l.label)).not.toContain("Calls held");
  });
});

describe("next best action", () => {
  const base = {
    today: "2026-09-08",
    hour: 9,
    morningDone: true,
    eveningDone: false,
    overdueTasks: 0,
    focusTasksOpen: 0,
    followUpsDue: 0,
    unansweredInbound: 0,
    contentDueToday: 0,
    contentOverdue: 0,
    nextPathwayTask: null,
    pendingRevision: 0,
    curriculumDay: null,
    streakAlive: true,
    runningStreak: 4,
  };
  it("leads with lock-in when the morning is not done", () => {
    expect(nextBestActions({ ...base, morningDone: false, overdueTasks: 3 })[0].key).toBe("checkin");
  });
  it("puts inbound replies above overdue tasks", () => {
    const keys = nextBestActions({ ...base, unansweredInbound: 2, overdueTasks: 1 }).map((a) => a.key);
    expect(keys.indexOf("inbound")).toBeLessThan(keys.indexOf("overdue"));
  });
  it("offers the close after 3pm and a fallback when clear", () => {
    expect(nextBestActions({ ...base, hour: 16 }).some((a) => a.key === "close")).toBe(true);
    expect(nextBestActions(base)[0].key).toBe("done");
  });
});
