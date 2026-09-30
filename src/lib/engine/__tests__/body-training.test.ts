import { describe, expect, it } from "vitest";
import { bestSet, compareSets, e1rm, fmtSet, fmtTarget, historyOf, lastTime, nextSetDefaults, prFlags, routineForDay, toUnit, type SetLike } from "@/lib/engine/body-training";

const s = (date: string, weight: number | null, reps: number, unit: "lb" | "kg" = "lb"): SetLike => ({ date, weight, unit, reps });

describe("B2 workouts: better, best and PRs", () => {
  it("more weight wins; at the same weight, more reps", () => {
    expect(compareSets(s("d", 185, 5), s("d", 175, 10))).toBeGreaterThan(0);
    expect(compareSets(s("d", 185, 6), s("d", 185, 5))).toBeGreaterThan(0);
    expect(compareSets(s("d", 185, 5), s("d", 185, 5))).toBe(0);
    // Across units: 100 kg is 220.5 lb, more than 220 lb.
    expect(compareSets(s("d", 100, 1, "kg"), s("d", 220, 1))).toBeGreaterThan(0);
    // Bodyweight: nothing added counts as 0, so it's the reps; any added weight beats none.
    expect(compareSets(s("d", null, 12), s("d", null, 10))).toBeGreaterThan(0);
    expect(compareSets(s("d", 10, 5), s("d", null, 15))).toBeGreaterThan(0);
  });
  it("the best set is the earliest of equals, so a PR is dated when first reached", () => {
    const sets = [s("2026-09-01", 185, 5), s("2026-09-08", 185, 5), s("2026-09-08", 180, 8)];
    expect(bestSet(sets)).toBe(sets[0]);
    expect(bestSet([])).toBeNull();
  });
  it("a set is a PR when it beats everything before it; the first set ever is not", () => {
    expect(prFlags([s("a", 135, 8), s("a", 155, 5), s("b", 155, 5), s("b", 155, 6), s("c", 150, 10), s("c", 160, 3)])).toEqual([false, true, false, true, false, true]);
    expect(prFlags([])).toEqual([]);
  });
});

describe("B2 workouts: last time, history and the form's defaults", () => {
  const sets = [s("2026-09-20", 175, 8), s("2026-09-20", 175, 7), s("2026-09-24", 180, 6), s("2026-09-24", 180, 6), s("2026-09-29", 185, 5)];
  it("last time is the latest earlier date's sets, in order", () => {
    expect(lastTime(sets, "2026-09-29")).toEqual([sets[2], sets[3]]);
    expect(lastTime(sets, "2026-09-24")).toEqual([sets[0], sets[1]]);
    expect(lastTime(sets, "2026-09-20")).toEqual([]);
  });
  it("history: one point per date, oldest first, with the top set, e1RM, set count and volume", () => {
    const h = historyOf(sets);
    expect(h.map((p) => p.date)).toEqual(["2026-09-20", "2026-09-24", "2026-09-29"]);
    expect(h[0]).toEqual({ date: "2026-09-20", top: { weight: 175, reps: 8 }, e1rm: 221.7, sets: 2, volume: 175 * 15 });
    expect(h[2].e1rm).toBe(e1rm(185, 5));
  });
  it("e1RM is Epley, the weight itself for a single, null without weight", () => {
    expect(e1rm(200, 1)).toBe(200);
    expect(e1rm(100, 10)).toBe(133.3);
    expect(e1rm(null, 10)).toBeNull();
  });
  it("the next set opens with today's last set, else last time's first, in the member's unit", () => {
    expect(nextSetDefaults([s("t", 185, 5)], [s("l", 175, 8)], "lb")).toEqual({ weight: 185, reps: 5 });
    expect(nextSetDefaults([], [s("l", 100, 8, "kg")], "lb")).toEqual({ weight: 220.5, reps: 8 });
    expect(nextSetDefaults([], [], "kg")).toEqual({ weight: null, reps: null });
  });
});

describe("B2 workouts: units and words", () => {
  it("converts lb ⇄ kg to 0.1", () => {
    expect(toUnit(100, "kg", "lb")).toBe(220.5);
    expect(toUnit(225, "lb", "kg")).toBe(102.1);
    expect(toUnit(135, "lb", "lb")).toBe(135);
  });
  it("sets and targets read as a member writes them", () => {
    expect(fmtSet(s("d", 185, 5), "lb")).toBe("185 × 5");
    expect(fmtSet(s("d", 100, 5, "kg"), "lb")).toBe("220.5 × 5");
    expect(fmtSet(s("d", null, 12), "lb", "bodyweight")).toBe("12 reps");
    expect(fmtSet(s("d", 25, 8), "lb", "bodyweight")).toBe("+25 × 8");
    expect(fmtTarget({ sets: 3, reps: "8–10" })).toBe("3 × 8–10");
  });
  it("the routine offered on a day is the one tied to its day type", () => {
    const routines = [{ id: "a", dayTypeId: "lift" }, { id: "b", dayTypeId: null }];
    expect(routineForDay(routines, "lift")?.id).toBe("a");
    expect(routineForDay(routines, "rest")).toBeNull();
    expect(routineForDay(routines, null)).toBeNull();
  });
});
