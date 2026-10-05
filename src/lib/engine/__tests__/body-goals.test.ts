import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "@/lib/dates";
import { fmtGoal, goalStatus, goalTitle, goalTomorrow, statusLine, storedTarget, topGoals, type GoalLike, type GoalStatus, type Point } from "@/lib/engine/body-goals";

const D = { addDays, daysBetween };
const TODAY = "2026-10-05";
const goal = (over: Partial<GoalLike>): GoalLike => ({ kind: "scale", key: "weight", refId: null, reps: null, target: 175, by: null, startValue: null, startDate: "2026-09-01", createdAt: "2026-09-01 08:00:00", archivedAt: null, ...over });
/** A value a day from `from`, moving `perDay`. */
const line = (from: string, days: number, start: number, perDay: number): Point[] => Array.from({ length: days }, (_, i) => ({ date: addDays(from, i), value: Math.round((start + perDay * i) * 100) / 100 }));
const fmt = (d: string) => d;

describe("goals' pace (rev 508 §5)", () => {
  // 185 on 1 Sep, down 0.1 lb a day: about 0.7 lb a week.
  const weight = line("2026-09-01", 35, 185, -0.1);

  it("a trend goal runs start to target on the 7-day average, with the rate needed, the rate lately and when it lands", () => {
    const s = goalStatus(goal({ by: "2026-12-28" }), weight, TODAY, D);
    expect(s.start).toBe(185);
    expect(s.current).toBeCloseTo(181.9, 1);
    expect(s.actualPerWeek).toBe(-0.7);
    expect(s.needPerWeek).toBeCloseTo(-0.58, 1);
    expect(s.state).toBe("on_track");
    expect(s.projected).toBe("2026-12-13");
    expect(s.progress).toBeGreaterThan(0.25);
    expect(s.aggressive).toBeNull();
  });

  it("a little behind, and behind, by how much of the needed rate the last 3 weeks did", () => {
    expect(goalStatus(goal({ by: "2026-11-23" }), weight, TODAY, D).state).toBe("a_little_behind");
    expect(goalStatus(goal({ by: "2026-10-26" }), weight, TODAY, D).state).toBe("behind");
    expect(goalStatus(goal({ by: "2026-10-01" }), weight, TODAY, D).state).toBe("behind");
  });

  it("past 1% of bodyweight a week is an aggressive pace, with a gentler date; it never says eat less", () => {
    const s = goalStatus(goal({ target: 165, by: "2026-11-02" }), weight, TODAY, D);
    expect(s.aggressive).toEqual({ limitPerWeek: 1.82, gentlerBy: "2026-12-09" });
    const text = statusLine(goal({ target: 165, by: "2026-11-02" }), s, "lb", fmt);
    expect(text).toMatch(/That's an aggressive pace: past 1\.8 lb a week\. 2026-12-09 is gentler\./);
    expect(text).not.toMatch(/eat|calorie|less food/i);
    // Body fat: half a point a week.
    const bf = goalStatus(goal({ key: "bf", target: 15, by: "2026-10-26" }), line("2026-09-01", 35, 22, -0.02), TODAY, D);
    expect(bf.aggressive?.limitPerWeek).toBe(0.5);
  });

  it("reached, and not enough to go on", () => {
    expect(goalStatus(goal({ target: 183 }), weight, TODAY, D)).toMatchObject({ state: "done", progress: 1, toGo: 0 });
    expect(goalStatus(goal({}), [], TODAY, D).state).toBe("no_data");
    expect(goalStatus(goal({ startDate: "2026-10-01", createdAt: "2026-10-01" }), line("2026-10-01", 5, 180, -0.1), TODAY, D).state).toBe("no_data");
  });

  it("a goal from before rev 508 (no start) reads its start off the day it was made; a given start wins", () => {
    expect(goalStatus(goal({ startDate: null, createdAt: "2026-09-10 07:00:00" }), weight, TODAY, D).start).toBeCloseTo(184.4, 1);
    expect(goalStatus(goal({ startValue: 190 }), weight, TODAY, D).start).toBe(190);
  });

  it("a lift goes on its best weight for the reps so far; up is the way", () => {
    const sets = [{ date: "2026-09-08", value: 185 }, { date: "2026-09-15", value: 190 }, { date: "2026-09-29", value: 195 }, { date: "2026-10-03", value: 200 }];
    const s = goalStatus(goal({ kind: "lift", key: "lift:x", refId: "x", reps: 5, target: 225, startValue: 185, by: "2026-12-28" }), sets, TODAY, D);
    expect(s.current).toBe(200);
    expect(s.actualPerWeek).toBe(5);
    expect(s.state).toBe("on_track");
    expect(goalTitle(goal({ kind: "lift", key: "lift:x", reps: 5, target: 225 }), "Bench Press", "kg", fmt)).toBe("Bench Press 102.1 kg × 5");
  });

  it("a habit or workouts: days a week, the last 3 weeks' average against the target", () => {
    const days = (dates: string[]) => dates.map((date) => ({ date, value: 1 }));
    const three = days(Array.from({ length: 21 }, (_, i) => addDays(TODAY, -i)).filter((_, i) => i % 7 < 4));
    const s = goalStatus(goal({ kind: "habit", key: "habit:h", refId: "h", target: 4 }), three, TODAY, D);
    expect(s).toMatchObject({ current: 4, actualPerWeek: 4, state: "on_track", progress: 1 });
    expect(goalStatus(goal({ kind: "training", key: "training", target: 5 }), three, TODAY, D).state).toBe("a_little_behind");
    expect(goalStatus(goal({ kind: "training", key: "training", target: 6 }), three, TODAY, D).state).toBe("behind");
  });

  it("units: masses and the waist in the member's units, stored in lb and inches", () => {
    expect(storedTarget({ kind: "scale", key: "weight" }, 80, "kg")).toBe(176.4);
    expect(storedTarget({ kind: "waist", key: "waist" }, 81.3, "kg")).toBe(32.01);
    expect(fmtGoal({ kind: "waist", key: "waist" }, 32, "kg")).toBe("81.3 cm");
    expect(fmtGoal({ kind: "sleep", key: "sleep" }, 7.5, "lb")).toBe("7.5 h");
    expect(goalTitle(goal({ kind: "habit", key: "habit:h", target: 5 }), "Meditate", "lb", fmt)).toBe("Meditate 5 days a week");
    expect(goalTitle(goal({ kind: "training", key: "training", target: 1 }), null, "lb", fmt)).toBe("Train 1 time a week");
    expect(goalTitle(goal({ by: "2026-12-01" }), null, "lb", fmt)).toBe("Weight to 175 lb by 2026-12-01");
  });

  it("Today's two: behind first, then the nearest date; archived left out", () => {
    const g = (state: GoalStatus["state"], by: string | null, archivedAt: string | null = null) => ({ goal: goal({ by, archivedAt }), status: { state } as GoalStatus });
    const list = [g("on_track", "2026-11-01"), g("behind", "2026-12-01"), g("a_little_behind", null), g("behind", null, "2026-10-01")];
    expect(topGoals(list).map((x) => [x.status.state, x.goal.by])).toEqual([["behind", "2026-12-01"], ["a_little_behind", null]]);
  });

  it("the read's line for tomorrow names the first goal behind, one thing for its kind, never eating less", () => {
    expect(goalTomorrow([{ title: "Weight to 175 lb", kind: "scale", state: "on_track" }])).toBeNull();
    const lines = (["scale", "waist", "lift", "habit", "training", "sleep"] as const).map((kind) => goalTomorrow([{ title: "X", kind, state: "behind" }])!);
    for (const l of lines) {
      expect(l).toMatch(/^Tomorrow: X /);
      expect(l).not.toMatch(/eat less|cut calories|skip|fewer calories/i);
    }
  });
});
