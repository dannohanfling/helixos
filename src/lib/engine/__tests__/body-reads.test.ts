import { describe, expect, it } from "vitest";
import { fadeOf, gymGroup, nextFor, sameTopRun, stepFor, topReps, trendOf, workoutRead, type ReadExercise } from "@/lib/engine/body-reads";

const ex = (o: Partial<ReadExercise>): ReadExercise => ({ exerciseId: "e1", name: "Bench press", kind: "weight", targetSets: 3, targetReps: "8-12", targetWeight: null, today: [], last: [], lastDate: null, pr: null, sameTopSessions: 1, ...o });
const sets = (w: number, ...reps: number[]) => reps.map((r) => ({ weight: w, reps: r }));

describe("the post-workout read (rev 471)", () => {
  it("reads up, held and down by the top set, then the volume", () => {
    const x = ex({});
    expect(trendOf(sets(185, 8, 8, 8), sets(180, 8, 8, 8), x)).toBe("up");
    expect(trendOf(sets(180, 9, 8, 8), sets(180, 8, 8, 8), x)).toBe("up");
    expect(trendOf(sets(180, 8, 8, 8), sets(180, 8, 8, 8), x)).toBe("held");
    expect(trendOf(sets(175, 8, 8, 8), sets(180, 8, 8, 8), x)).toBe("down");
    expect(trendOf(sets(180, 8), [], x)).toBe("first");
  });
  it("names a fade, and the top of a reps target", () => {
    expect(fadeOf(sets(90, 12, 10, 7))).toEqual({ weight: 90, reps: [12, 10, 7] });
    expect(fadeOf(sets(90, 12, 11, 11))).toBeNull();
    expect(topReps("8-12")).toBe(12);
    expect(topReps("8–12")).toBe(12);
    expect(topReps("AMRAP")).toBeNull();
  });
  it("adds the smallest step only when every set reached the top", () => {
    expect(stepFor("Cable row", "lb")).toBe(2.5);
    expect(stepFor("Back squat", "lb")).toBe(5);
    expect(stepFor("Back squat", "kg")).toBe(2.5);
    expect(nextFor(ex({ today: sets(185, 12, 12, 12) }), "lb")).toMatchObject({ weight: 190, add: true });
    expect(nextFor(ex({ name: "Dumbbell curl", today: sets(30, 12, 12, 12) }), "lb")).toMatchObject({ weight: 32.5, add: true });
    expect(nextFor(ex({ today: sets(185, 12, 12, 9) }), "lb")).toMatchObject({ weight: 185, add: false });
    expect(nextFor(ex({ today: sets(185, 12, 12) }), "lb")).toMatchObject({ weight: 185, add: false });
    expect(nextFor(ex({ targetReps: null, today: sets(185, 12) }), "lb")).toBeNull();
  });
  it("puts PRs first, notes the member's words, and never advises on pain", () => {
    const r = workoutRead({
      unit: "lb",
      routineName: "Push A",
      note: "Focused on consistency, a little pain in the shoulder",
      plan: { done: 9, planned: 9 },
      lifting: { minutes: 76, strain: 10.2 },
      gym: [{ sport: "Stretching", minutes: 12, startedAt: null, endedAt: null, strain: null }, { sport: "Sauna", minutes: 20, startedAt: null, endedAt: null, strain: null }],
      gymMinutes: 118,
      exercises: [
        ex({ today: [...sets(185, 12, 12), { weight: 185, reps: 12, pr: true }], last: sets(180, 12, 12, 12) }),
        ex({ exerciseId: "e2", name: "Leg curl", targetReps: "10", today: sets(90, 12, 10, 7), last: sets(90, 10, 10, 10), sameTopSessions: 3 }),
      ],
      daysSinceRoutine: 3,
    });
    expect(r.lines[0]).toBe("Push A: 9 of 9 planned sets done · 76 min, strain 10.2.");
    expect(r.lines[1]).toBe("At the gym: stretching 12 min, sauna 20 min; 118 min in all.");
    expect(r.lines[2]).toContain("You wrote:");
    expect(r.lines).toContain("New PR: Bench press.");
    expect(r.lines).toContain("Leg curl faded: 12, 10, 7 at 90 lb.");
    expect(r.lines.at(-1)).toBe("Noted. If it keeps up, check with a professional.");
    expect(r.care).toBe(true);
    expect(r.next.map((n) => [n.exercise, n.weight, n.add])).toEqual([["Bench press", 190, true], ["Leg curl", 90, false]]);
    expect(r.exercises[0].line).toBe("Bench press: up at 185 lb × 12 (last 180 lb × 12), a new PR.");
  });
  it("counts sessions with the same top set", () => {
    expect(sameTopRun([sets(185, 8), sets(185, 8, 6), sets(185, 8), sets(180, 8)])).toBe(3);
    expect(sameTopRun([sets(185, 8)])).toBe(1);
  });
  it("groups what WHOOP recorded within an hour of the lift as the gym visit", () => {
    const at = (h: string) => `2026-10-04T${h}:00.000Z`;
    const acts = [
      { sport: "Stretching", minutes: 12, startedAt: at("14:30"), endedAt: at("14:42"), strain: 1 },
      { sport: "Weightlifting", minutes: 76, startedAt: at("14:45"), endedAt: at("16:01"), strain: 10 },
      { sport: "Sauna", minutes: 20, startedAt: at("16:10"), endedAt: at("16:30"), strain: 2 },
      { sport: "Walking", minutes: 30, startedAt: at("20:00"), endedAt: at("20:30"), strain: 3 },
    ];
    const g = gymGroup(acts, (s) => /weightlift/i.test(s));
    expect(g.lift?.sport).toBe("Weightlifting");
    expect(g.around.map((a) => a.sport)).toEqual(["Stretching", "Sauna"]);
    expect(g.others.map((a) => a.sport)).toEqual(["Walking"]);
    expect(g.minutes).toBe(120);
    expect(gymGroup(acts.filter((a) => a.sport !== "Weightlifting"), (s) => /weightlift/i.test(s)).lift).toBeNull();
  });
});
