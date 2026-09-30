import { describe, expect, it } from "vitest";
import { heatLevel, repsMark, repsRange, sessionPlan, weekTally } from "@/lib/engine/body-training";

describe("phase 3: planned against actual", () => {
  it("reads a target's reps in the shapes members write, and none for AMRAP or time", () => {
    expect(repsRange("8–10")).toEqual([8, 10]);
    expect(repsRange("8-10")).toEqual([8, 10]);
    expect(repsRange("8 to 10")).toEqual([8, 10]);
    expect(repsRange("5")).toEqual([5, 5]);
    expect(repsRange("8+")).toEqual([8, Infinity]);
    expect(repsRange("AMRAP")).toBeNull();
    expect(repsRange("30s")).toBeNull();
    expect(repsRange("")).toBeNull();
  });
  it("marks a set under, in or over its plan, and none without a countable target", () => {
    expect(repsMark(7, "8–10")).toBe("under");
    expect(repsMark(9, "8–10")).toBe("in");
    expect(repsMark(12, "8–10")).toBe("over");
    expect(repsMark(12, "8+")).toBe("in");
    expect(repsMark(5, "AMRAP")).toBe("none");
    expect(repsMark(5, null)).toBe("none");
  });
  it("counts done sets against the routine's lines; complete only when every line is", () => {
    const lines = [{ exerciseId: "bench", sets: 3, reps: "5" }, { exerciseId: "pull", sets: 3, reps: "8–10" }];
    const p = sessionPlan(lines, [{ exerciseId: "bench" }, { exerciseId: "bench" }, { exerciseId: "bench" }, { exerciseId: "pull" }, { exerciseId: "row" }]);
    expect(p.exercises).toEqual([{ exerciseId: "bench", planned: 3, reps: "5", done: 3, complete: true }, { exerciseId: "pull", planned: 3, reps: "8–10", done: 1, complete: false }]);
    expect(p.plannedSets).toBe(6);
    expect(p.doneSets).toBe(5);
    expect(p.complete).toBe(false);
    expect(sessionPlan(lines, [...Array(3)].map(() => ({ exerciseId: "bench" })).concat([...Array(4)].map(() => ({ exerciseId: "pull" })))).complete).toBe(true);
    // No routine: nothing planned, never "complete" by plan.
    expect(sessionPlan([], [{ exerciseId: "row" }])).toEqual({ exercises: [], plannedSets: 0, doneSets: 1, complete: false });
  });
  it("the heat of a day, and the week's tally with or without planned days", () => {
    expect([0, 1, 4, 5, 11, 12, 30].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3]);
    const week = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];
    const trained = new Set(["2026-09-28", "2026-09-30", "2026-10-02"]);
    const lift = new Set(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(weekTally(week, (d) => trained.has(d), (d) => lift.has(d))).toEqual({ done: 3, planned: 5 });
    expect(weekTally(week, (d) => trained.has(d), () => false)).toEqual({ done: 3, planned: null });
  });
});
