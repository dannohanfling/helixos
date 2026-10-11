import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { liftTypeIds, mainMuscles, musclesOf, planDays, planLine, planSetUp, planSpoken, roughLength, type PlanDayIn, type TrainingPlanSettings } from "@/lib/engine/body-plan";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

// Danno's week (rev 648): Mon, Wed, Fri, Sat, Sun lift; Tue and Thu off. 2026-10-12 is a Monday.
const LIFT = "t-lift";
const OFF = "t-off";
const REFEED = "t-refeed";
const PATTERN: Record<number, string> = { 0: LIFT, 1: LIFT, 2: OFF, 3: LIFT, 4: OFF, 5: LIFT, 6: LIFT };
const PLAN: TrainingPlanSettings = { rotation: ["chest", "back", "shoulder"], weekend: "legs", liftTypes: null };
const TYPES = [
  { id: LIFT, name: "Lift" },
  { id: OFF, name: "Off" },
  { id: REFEED, name: "Refeed" },
];
const opts = (history: { date: string; routineId: string | null }[] = []) => ({ liftTypes: liftTypeIds(PLAN, TYPES), routineIds: new Set(["chest", "back", "shoulder", "legs", "arms"]), history });

/** Seven days from `from` on Danno's pattern, with any day's fields replaced. */
function week(from: string, over: Record<string, Partial<PlanDayIn>> = {}): PlanDayIn[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { date, dayTypeId: PATTERN[wd], off: false, pick: null, session: null, ...over[date] };
  });
}
const routines = (days: { routineId: string | null }[]) => days.map((d) => d.routineId ?? "-");

describe("the training plan (rev 648)", () => {
  it("off days follow day types; the rotation runs Chest → Back → Shoulder on the other lift days, Legs on Saturday", () => {
    const p = planDays(week("2026-10-12"), PLAN, opts());
    expect(routines(p)).toEqual(["chest", "-", "back", "-", "shoulder", "legs", "chest"]);
    expect(p.map((d) => d.why)).toEqual(["rotation", "rest", "rotation", "rest", "rotation", "weekend", "rotation"]);
  });

  it("the rotation picks the routine done longest ago, never-done first, ties by rotation order", () => {
    const p = planDays(week("2026-10-12"), PLAN, opts([{ date: "2026-10-09", routineId: "chest" }, { date: "2026-10-05", routineId: "back" }, { date: "2026-10-07", routineId: "shoulder" }]));
    expect(routines(p).filter((r) => r !== "-")).toEqual(["back", "shoulder", "chest", "legs", "back"]);
    // A routine added to the rotation and never done goes first.
    const added = planDays(week("2026-10-12"), { ...PLAN, rotation: ["chest", "back", "shoulder", "arms"] }, opts([{ date: "2026-10-09", routineId: "chest" }, { date: "2026-10-05", routineId: "back" }, { date: "2026-10-07", routineId: "shoulder" }]));
    expect(added[0].routineId).toBe("arms");
  });

  it("a missed Wednesday slides to Friday, never skips", () => {
    const fromWed = planDays(week("2026-10-14"), PLAN, opts([{ date: "2026-10-12", routineId: "chest" }]));
    expect(fromWed[0].routineId).toBe("back");
    // Wednesday came and went with nothing logged: Friday is Back, and Shoulder moves on.
    const fromFri = planDays(week("2026-10-16"), PLAN, opts([{ date: "2026-10-12", routineId: "chest" }]));
    expect(routines(fromFri)).toEqual(["back", "legs", "shoulder", "chest", "-", "back", "-"]);
  });

  it("doing Back on a planned Chest day re-plans by itself", () => {
    const p = planDays(week("2026-10-12", { "2026-10-12": { session: { routineId: "back", sets: 18, completed: true } } }), PLAN, opts());
    expect(p[0]).toMatchObject({ routineId: "back", why: "done" });
    expect(routines(p)).toEqual(["back", "-", "chest", "-", "shoulder", "legs", "back"]);
    // A session started with nothing logged yet shows as going.
    const going = planDays(week("2026-10-12", { "2026-10-12": { session: { routineId: "shoulder", sets: 0, completed: false } } }), PLAN, opts());
    expect(going[0]).toMatchObject({ routineId: "shoulder", why: "started" });
  });

  it("Legs: Saturday by default, Sunday when Saturday has no session of it or is set Off, never on a weekday", () => {
    // Sunday after a Saturday with nothing logged: Legs today.
    const sun = planDays(week("2026-10-18"), PLAN, opts([{ date: "2026-10-16", routineId: "shoulder" }]));
    expect(sun[0]).toMatchObject({ routineId: "legs", why: "weekend" });
    // Sunday after Legs on Saturday: the rotation.
    const after = planDays(week("2026-10-18"), PLAN, opts([{ date: "2026-10-17", routineId: "legs" }]));
    expect(after[0].why).toBe("rotation");
    // Saturday set Off by hand: Legs goes to Sunday.
    const off = planDays(week("2026-10-12", { "2026-10-17": { off: true } }), PLAN, opts());
    expect(routines(off).slice(5)).toEqual(["-", "legs"]);
    // Saturday given another routine by hand: Legs goes to Sunday.
    const swapped = planDays(week("2026-10-12", { "2026-10-17": { pick: "chest" } }), PLAN, opts());
    expect(routines(swapped).slice(5)).toEqual(["chest", "legs"]);
    // Never on a weekday, whatever the history.
    for (const from of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]) {
      const p = planDays(week(from), PLAN, opts([{ date: "2026-09-01", routineId: "legs" }]));
      for (const d of p) if (d.weekday >= 1 && d.weekday <= 5) expect(d.routineId, d.date).not.toBe("legs");
    }
  });

  it("Legs missed both weekend days goes on next Saturday with a note; a brand new plan never says missed", () => {
    const missed = planDays(week("2026-10-19"), PLAN, opts([{ date: "2026-10-10", routineId: "legs" }, { date: "2026-10-16", routineId: "chest" }]));
    const sat = missed.find((d) => d.date === "2026-10-24")!;
    expect(sat).toMatchObject({ routineId: "legs", carried: true });
    const kept = planDays(week("2026-10-19"), PLAN, opts([{ date: "2026-10-10", routineId: "legs" }, { date: "2026-10-18", routineId: "legs" }]));
    expect(kept.find((d) => d.date === "2026-10-24")!.carried).toBe(false);
    expect(planDays(week("2026-10-19"), PLAN, opts()).some((d) => d.carried)).toBe(false);
  });

  it("off days follow day types, including a date set Off or Refeed by hand", () => {
    // Every type but one named Off or Rest is a lift type until the member ticks their own.
    expect([...liftTypeIds(PLAN, TYPES)].sort()).toEqual([LIFT, REFEED].sort());
    expect([...liftTypeIds({ ...PLAN, liftTypes: [LIFT] }, TYPES)]).toEqual([LIFT]);
    const p = planDays(week("2026-10-12", { "2026-10-13": { dayTypeId: REFEED }, "2026-10-14": { dayTypeId: OFF }, "2026-10-16": { off: true } }), PLAN, opts());
    expect(p.map((d) => d.lift)).toEqual([true, true, false, false, false, true, true]);
    expect(routines(p)).toEqual(["chest", "back", "-", "-", "-", "legs", "shoulder"]);
    // Refeed unticked: a rest day.
    const unticked = planDays(week("2026-10-12", { "2026-10-13": { dayTypeId: REFEED } }), PLAN, { ...opts(), liftTypes: liftTypeIds({ ...PLAN, liftTypes: [LIFT] }, TYPES) });
    expect(unticked[1].why).toBe("rest");
  });

  it("a routine picked by hand stands for its day only; the rest works out from it", () => {
    const p = planDays(week("2026-10-12", { "2026-10-14": { pick: "shoulder" } }), PLAN, opts());
    expect(routines(p)).toEqual(["chest", "-", "shoulder", "-", "back", "legs", "chest"]);
    expect(p[2].why).toBe("swap");
    // A pick on a rest day plans nothing; a weekend routine in the rotation too is planned as the weekend only.
    expect(planDays(week("2026-10-12", { "2026-10-13": { pick: "back" } }), PLAN, opts())[1].routineId).toBeNull();
    expect(routines(planDays(week("2026-10-12"), { ...PLAN, rotation: ["legs", "chest", "back"] }, opts()))).toEqual(["chest", "-", "back", "-", "chest", "legs", "back"]);
  });

  it("set up once there's a rotation or a weekend routine; says the week in one line and today in a few words", () => {
    expect(planSetUp(null)).toBe(false);
    expect(planSetUp({ rotation: [], weekend: null, liftTypes: null })).toBe(false);
    expect(planSetUp({ rotation: [], weekend: "legs", liftTypes: null })).toBe(true);
    const names: Record<string, string> = { chest: "Chest Day", back: "Back Day", shoulder: "Shoulder Day", legs: "Leg Day" };
    const p = planDays(week("2026-10-12"), PLAN, opts());
    expect(planSpoken(p.map((d) => ({ weekday: d.weekday, lift: d.lift, routineName: d.routineId ? names[d.routineId] : null })))).toBe("Mon Chest, Tue rest, Wed Back, Thu rest, Fri Shoulder, Sat Leg, Sun Chest");
    expect(planLine({ lift: true, why: "rotation", typeName: "Lift", name: "Back Day", exercises: 6 })).toBe("Lift · Back Day · 6 exercises");
    expect(planLine({ lift: false, why: "rest", typeName: "Off", name: null, exercises: 0 })).toBe("Off · Rest");
    expect(planLine({ lift: true, why: "done", typeName: "Lift", name: "Back Day", exercises: 6 })).toBe("Done · Back Day");
  });

  it("the main muscle groups come from the exercise names", () => {
    expect(mainMuscles(["Bench Press", "Incline Dumbbell Press", "Cable Fly", "Triceps Pushdown"])).toEqual(["Chest", "Triceps"]);
    expect(mainMuscles(["Barbell Row", "Lat Pulldown", "Hammer Curl"])).toEqual(["Back", "Biceps"]);
    expect(mainMuscles(["Back Squat", "Leg Press", "Leg Curl", "Calf Raise"]).slice(0, 2)).toEqual(["Quads", "Glutes"]);
    expect(musclesOf("Overhead Press")).toEqual(["Shoulders", "Triceps"]);
    expect(musclesOf("Lateral Raise")).toEqual(["Shoulders"]);
    expect(musclesOf("Romanian Deadlift")).toEqual(["Hamstrings", "Glutes"]);
    expect(musclesOf("Mystery machine")).toEqual([]);
  });

  it("a routine's rough length is the middle of its last 5 sessions, first set to last plus 5 minutes", () => {
    const s = (mins: number) => ({ first: "2026-10-01 07:00:00", last: `2026-10-01 0${7 + Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}:00` });
    expect(roughLength([s(50), s(55), s(60)])).toBe(60);
    expect(roughLength([])).toBeNull();
    expect(roughLength([{ first: "2026-10-01 07:00:00", last: "2026-10-01 07:00:00" }])).toBeNull();
  });

  it("the page's Today card, its 7 days, Today's line and both connector tools read the one plan", () => {
    const page = read("src/app/(app)/body/training/page.tsx");
    expect(page).toMatch(/trainingPlanView\(/);
    expect(page).toMatch(/const today = plan\?\.days\[0\] \?\? null;/);
    expect(page).toMatch(/<WeekPlanList days=\{plan\.days\}/);
    const tools = read("src/lib/mcp/tools/body.ts");
    expect(tools.match(/trainingPlanView\(/g)?.length).toBe(2);
    expect(read("src/lib/queries/body.ts")).toMatch(/const plan = await trainingPlanView\(v\.workspace\.id, v\.user\.id, v\.today\);\n  const day = plan\?\.setUp \? plan\.days\[0\] : null;/);
  });
});
