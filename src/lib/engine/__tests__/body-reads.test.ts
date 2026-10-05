import { describe, expect, it } from "vitest";
import { dayRead, defaultStep, fadeOf, gymGroup, learnedStep, nextFor, sameTopRun, stepFromEdit, topReps, trendOf, workoutRead, type ReadExercise } from "@/lib/engine/body-reads";

const ex = (o: Partial<ReadExercise>): ReadExercise => ({ exerciseId: "e1", name: "Bench press", kind: "weight", targetSets: 3, targetReps: "8-12", targetWeight: null, step: 5, today: [], last: [], lastDate: null, pr: null, sameTopSessions: 1, ...o });
const sets = (w: number, ...reps: number[]) => reps.map((r) => ({ weight: w, reps: r }));

describe("the post-workout read (rev 471)", () => {
  it("reads up, held and down by the top set alone (rev 486)", () => {
    expect(trendOf(sets(185, 8, 8, 8), sets(180, 8, 8, 8))).toBe("up");
    expect(trendOf(sets(180, 9, 8, 8), sets(180, 8, 8, 8))).toBe("up");
    expect(trendOf(sets(180, 8, 8, 8), sets(180, 8, 8, 8))).toBe("held");
    // Danno's Back Day: the same top set with a fade or fewer sets is held, not down.
    expect(trendOf(sets(65, 10, 10), sets(65, 10, 10, 10))).toBe("held");
    expect(trendOf(sets(100, 12, 10, 7), sets(100, 12, 12, 11))).toBe("held");
    expect(trendOf(sets(175, 8, 8, 8), sets(180, 8, 8, 8))).toBe("down");
    expect(trendOf(sets(180, 7), sets(180, 8))).toBe("down");
    expect(trendOf(sets(180, 8), [])).toBe("first");
  });
  it("names a fade, and the top of a reps target", () => {
    expect(fadeOf(sets(90, 12, 10, 7))).toEqual({ weight: 90, reps: [12, 10, 7] });
    expect(fadeOf(sets(90, 12, 11, 11))).toBeNull();
    expect(topReps("8-12")).toBe(12);
    expect(topReps("8–12")).toBe(12);
    expect(topReps("AMRAP")).toBeNull();
  });
  it("goes up one learned step only when every set reached the top (rev 486)", () => {
    expect(defaultStep("Cable row", "lb")).toBe(5);
    expect(defaultStep("DB curl", "lb")).toBe(2.5);
    expect(defaultStep("Back squat", "kg")).toBe(2.5);
    expect(learnedStep([145, 165, 185, 165])).toBe(20);
    expect(learnedStep([50, 55, 60, 70])).toBe(5);
    expect(learnedStep([100])).toBeNull();
    expect(stepFromEdit(50, 60, 57.5)).toBe(10);
    expect(stepFromEdit(50, 57.5, 57.5)).toBeNull();
    expect(stepFromEdit(50, 45, 57.5)).toBeNull();
    expect(nextFor(ex({ today: sets(185, 12, 12, 12) }), "lb")).toMatchObject({ weight: 190, add: true });
    expect(nextFor(ex({ step: 20, today: sets(145, 12, 12, 12) }), "lb")).toMatchObject({ weight: 165, add: true });
    expect(nextFor(ex({ name: "Dumbbell curl", step: 2.5, today: sets(30, 12, 12, 12) }), "lb")).toMatchObject({ weight: 32.5, add: true });
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
        ex({ exerciseId: "e2", name: "Leg curl", targetReps: "10", today: sets(90, 12, 10, 7), last: sets(90, 12, 10, 10), sameTopSessions: 3 }),
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
    expect(r.lines).toContain("Up on Bench press; held on Leg curl.");
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

describe("the end-of-day read (rev 471)", () => {
  const base = {
    isToday: false,
    hour: 21,
    training: "Push A: 9 of 9 planned sets done · 76 min, strain 10.2.",
    dayType: "Lift",
    logged: true,
    totals: { cal: 1420, p: 165, f: 58, c: 20 },
    bands: { cal: { min: 1400, max: 1500 }, p: { min: 180, max: 200 }, f: { min: 55, max: 65 } },
    sleepH: 7.25,
    recovery: 67,
    strain: 10.2,
    habits: { kept: 4, due: 6 },
    weight: { avg: 150.44, weekAgo: 151.2, unit: "lb" as const },
  };
  it("ties the day together, protein first, the weight by its average", () => {
    const r = dayRead(base);
    expect(r.lines).toEqual([
      "Push A: 9 of 9 planned sets done · 76 min, strain 10.2.",
      "Fuel for a Lift day: protein 165 g (180–200 g), calories 1,420 (1,400–1,500), fat 58 g (55–65 g).",
      "Recovery: 7.3 h sleep, recovery 67%, strain 10.2.",
      "Habits: 4 of 6 kept.",
      "Weight trend: 150.4 lb on the 7-day average, down 0.8 over the week.",
    ]);
    expect(r.tomorrow).toBe("Tomorrow: the same again.");
  });
  it("says what's still to go while the evening is early, and picks one thing for tomorrow", () => {
    expect(dayRead({ ...base, isToday: true, hour: 17 }).lines).toContain("Still to go: 15 g protein.");
    expect(dayRead({ ...base, totals: { ...base.totals, p: 120 } }).tomorrow).toMatch(/^Tomorrow: protein first\. 180 g/);
    expect(dayRead({ ...base, sleepH: 5.5 }).tomorrow).toMatch(/sleep/);
    expect(dayRead({ ...base, totals: { ...base.totals, cal: 1800 } }).tomorrow).toMatch(/plan dinner first/);
    expect(dayRead({ ...base, habits: { kept: 1, due: 6 } }).tomorrow).toMatch(/habit that matters most/);
    expect(dayRead({ ...base, training: null, logged: false }).lines.slice(0, 2)).toEqual(["No workout logged.", "No food logged."]);
  });
});

describe("the plan against what was done (rev 486)", () => {
  it("says the weight set for today beside what was lifted", () => {
    const r = workoutRead({ unit: "lb", routineName: null, note: null, plan: null, lifting: null, gym: [], gymMinutes: null, daysSinceRoutine: null, exercises: [ex({ name: "Rear delt fly", targetWeight: 60, today: sets(60, 12, 12, 12), last: sets(55, 12, 12, 12) })] });
    expect(r.exercises[0].line).toBe("Rear delt fly: up at 60 lb × 12 (last 55 lb × 12); planned 60, did 60 lb × 12.");
  });
  it("puts less volume at the same top set on its own line", () => {
    const r = workoutRead({ unit: "lb", routineName: null, note: null, plan: null, lifting: null, gym: [], gymMinutes: null, daysSinceRoutine: null, exercises: [ex({ name: "High row", today: sets(65, 10, 10), last: sets(65, 10, 10, 10) })] });
    expect(r.exercises[0].trend).toBe("held");
    expect(r.lines).toContain("High row: less volume than last time.");
  });
});

describe("the end-of-day read's correlation line (rev 507)", async () => {
  const { correlationLine, rotationFor } = await import("@/lib/engine/body-correlate");
  const v = (kind: "steady" | "unsteady" | "none", r: number | null, n: number) => ({ kind, r, n, early: false, halves: [r, r] as [number | null, number | null], words: "" });
  it("says one steady link of 0.4 or more, never a cause, and nothing below the bar", () => {
    expect(correlationLine([{ a: "sleep_h", b: "callsBooked", lag: 1, labelA: "Sleep hours", labelB: "Calls booked", verdict: v("steady", 0.52, 34) }])).toBe("More sleep tends to go with more calls booked the next day (r 0.52 over 34 days).");
    expect(correlationLine([{ a: "strain", b: "recovery", lag: 1, labelA: "Strain", labelB: "Recovery %", verdict: v("steady", -0.45, 40) }])).toBe("More strain tends to go with less recovery the next day (r -0.45 over 40 days).");
    expect(correlationLine([{ a: "sleep_h", b: "callsBooked", lag: 1, labelA: "", labelB: "", verdict: v("steady", 0.35, 34) }, { a: "cal", b: "weight", lag: 1, labelA: "", labelB: "", verdict: v("unsteady", 0.6, 30) }])).toBeNull();
    expect(correlationLine([{ a: "habit:sauna", b: "energy", lag: 1, labelA: "Sauna (min)", labelB: "Lock-in energy", verdict: v("steady", 0.41, 22) }])).toBe("More sauna tends to go with more lock-in energy the next day (r 0.41 over 22 days).");
  });
  it("turns the rotation one step a day", () => {
    expect(rotationFor([1, 2, 3], "2026-10-05")[0]).not.toBe(rotationFor([1, 2, 3], "2026-10-06")[0]);
  });
});
