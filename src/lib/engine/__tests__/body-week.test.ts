import { describe, expect, it } from "vitest";
import { daysBetween } from "@/lib/dates";
import { WEEK_SUMMARY_TASK, change, coachBodyText, goalPace, nutritionWeek, weekNumbers, weighWeek, type WeekDay } from "@/lib/engine/body-week";

const lift = { cal: { min: 1400, max: 1500 }, p: { min: 180, max: 200 }, f: { min: 55, max: 65 }, c: { min: 0, max: 5 } };
const rest = { cal: { min: 1300, max: 1400 }, p: { min: 170, max: 190 }, f: { min: 50, max: 60 }, c: { min: 0, max: 5 } };
const day = (date: string, logged: number, totals: [number, number, number, number], bands: WeekDay["bands"], worst: WeekDay["worst"], final = true): WeekDay => ({ date, logged, totals: { cal: totals[0], p: totals[1], f: totals[2], c: totals[3] }, bands, worst, final });

describe("the weekly rollup (rev 231): nutrition", () => {
  it("averages over the logged days, protein against its floor and fat against its ceiling, days in band among the judged", () => {
    const days = [
      day("2026-09-28", 3, [1450, 190, 60, 3], lift, "in"),
      day("2026-09-29", 2, [1350, 175, 52, 2], rest, "in"),
      day("2026-09-30", 0, [0, 0, 0, 0], lift, null),
      day("2026-10-01", 3, [1600, 200, 70, 4], lift, "significant"),
      day("2026-10-02", 1, [700, 90, 30, 1], lift, "open", false),
    ];
    expect(nutritionWeek(days)).toEqual({ daysLogged: 4, daysPassed: 5, avgCal: 1275, avgP: 163.8, avgPFloor: 177.5, avgF: 53, avgFCeiling: 63.8, avgC: 2.5, daysJudged: 3, daysInBand: 2 });
  });
  it("nothing logged: nulls, never zeros pretending", () => {
    expect(nutritionWeek([day("2026-09-28", 0, [0, 0, 0, 0], lift, null)])).toEqual({ daysLogged: 0, daysPassed: 1, avgCal: null, avgP: null, avgPFloor: null, avgF: null, avgFCeiling: null, avgC: null, daysJudged: 0, daysInBand: 0 });
    expect(nutritionWeek([])).toMatchObject({ daysLogged: 0, daysPassed: 0, avgCal: null });
  });
});

describe("the weekly rollup: weight and goal pace", () => {
  it("the week's average and the change against last week", () => {
    expect(weighWeek([{ weight: 176.2 }, { weight: 175.6 }, { weight: 175.0 }])).toEqual({ avg: 175.6, days: 3 });
    expect(weighWeek([])).toEqual({ avg: null, days: 0 });
    expect(change(175.6, 177.1)).toBe(-1.5);
    expect(change(175.6, null)).toBeNull();
  });
  it("goal pace: the gap, weeks left, the needed rate against the last four weeks' rate", () => {
    const p = goalPace({ target: 170, by: "2026-12-01" }, 175.0, 175.3, 178.5, "2026-09-30", daysBetween)!;
    expect(p.toGo).toBe(-5);
    expect(p.weeksLeft).toBe(8.9);
    expect(p.needPerWeek).toBe(-0.6);
    expect(p.actualPerWeek).toBe(-0.8);
    expect(p.onPace).toBe(true);
    // Losing too slowly is off pace; gaining toward a gain goal reads the other way.
    expect(goalPace({ target: 170, by: "2026-12-01" }, 175.0, 175.3, 176.0, "2026-09-30", daysBetween)!.onPace).toBe(false);
    expect(goalPace({ target: 180, by: "2026-12-01" }, 175.0, 175.3, 172.0, "2026-09-30", daysBetween)!.onPace).toBe(true);
    // No date: the gap and the actual rate only. Reached: on pace whatever the rate. No goal or no weight: nothing.
    expect(goalPace({ target: 170, by: null }, 175.0, 175.3, 178.5, "2026-09-30", daysBetween)).toMatchObject({ weeksLeft: null, needPerWeek: null, actualPerWeek: -0.8, onPace: null });
    expect(goalPace({ target: 175, by: "2026-12-01" }, 175.0, 175.3, 175.3, "2026-09-30", daysBetween)!.onPace).toBe(true);
    expect(goalPace(null, 175.0, null, null, "2026-09-30", daysBetween)).toBeNull();
    expect(goalPace({ target: 170, by: null }, null, null, null, "2026-09-30", daysBetween)).toBeNull();
  });
});

describe("the coach's Body column (rev 237 phase 12)", () => {
  const fmt = (d: string) => `d${d.slice(5)}`;
  it("says days in band, the last weigh-in and the sessions, short and long", () => {
    const t = coachBodyText({ inBand: 3, judged: 4, lastWeighIn: "2026-09-28", sessions: 2 }, "2026-10-01", fmt, daysBetween);
    expect(t.short).toBe("🎯 3/4 · ⚖️ d09-28 · 🏋️ 2");
    expect(t.long).toBe("3 of 4 days in band this week · last weigh-in d09-28 · 2 sessions this week");
  });
  it("says today or yesterday for a fresh weigh-in, and a dash with nothing judged or weighed", () => {
    expect(coachBodyText({ inBand: 0, judged: 0, lastWeighIn: "2026-10-01", sessions: 1 }, "2026-10-01", fmt, daysBetween).short).toBe("🎯 — · ⚖️ today · 🏋️ 1");
    expect(coachBodyText({ inBand: 0, judged: 0, lastWeighIn: "2026-09-30", sessions: 1 }, "2026-10-01", fmt, daysBetween).long).toBe("no days judged yet this week · weighed yesterday · 1 session this week");
    expect(coachBodyText({ inBand: 0, judged: 0, lastWeighIn: null, sessions: 0 }, "2026-10-01", fmt, daysBetween)).toEqual({ short: "🎯 — · ⚖️ — · 🏋️ 0", long: "no days judged yet this week · no weigh-in yet · 0 sessions this week" });
  });
});

describe("the AI week summary (rev 237 phase 15): numbers only", () => {
  it("phrases the week as lines of numbers with nothing named, and the task asks for one short paragraph", () => {
    const n = { daysLogged: 5, daysPassed: 7, avgCal: 1450, avgP: 190, avgPFloor: 180, avgF: 58, avgFCeiling: 65, avgC: 4, daysJudged: 4, daysInBand: 3 };
    const text = weekNumbers({ label: "2026-09-28 to 2026-10-04", nutrition: n, prevNutrition: { ...n, daysInBand: 2, daysJudged: 5 }, training: { sessions: 3, planned: 4, sets: 24, prs: 1 }, prevTraining: { sessions: 2, planned: 4, sets: 15, prs: 0 }, weigh: { avg: 150.4, days: 3 }, prevWeigh: { avg: 151.2, days: 2 }, weightUnit: "lb", sleepAvg: 7.2, burnAvg: 2480, habits: { due: 14, kept: 11 } });
    expect(text).toContain("Energy burned: about 2480 cal a day, the device's estimate.");
    expect(text.split("\n")).toEqual([
      "Week: 2026-09-28 to 2026-10-04.",
      "Days logged: 5 of 7; finished days in band: 3 of 4 (last week 2 of 5).",
      "Averages on logged days: 1450 cal, 190 g protein (floor 180), 58 g fat (ceiling 65), 4 g carbs.",
      "Training: 3 sessions of 4 planned, 24 sets, 1 PRs (last week 2 sessions, 15 sets).",
      "Weight: average 150.4 lb over 3 days (last week 151.2 lb).",
      "Sleep: 7.2 h a night on average.",
      "Energy burned: about 2480 cal a day, the device's estimate.",
      "Habits: 11 of 14 kept.",
    ]);
    expect(weekNumbers({ label: "w", nutrition: { ...n, avgCal: null, avgP: null, avgPFloor: null, avgF: null, avgFCeiling: null, avgC: null }, prevNutrition: n, training: { sessions: 0, planned: null, sets: 0, prs: 0 }, prevTraining: { sessions: 0, planned: null, sets: 0, prs: 0 }, weigh: { avg: null, days: 0 }, prevWeigh: { avg: null, days: 0 }, weightUnit: "kg", sleepAvg: null, habits: { due: 0, kept: 0 } })).toContain("Weight: no weigh-ins over 0 days.");
    expect(WEEK_SUMMARY_TASK).toMatch(/week summary/i);
    expect(WEEK_SUMMARY_TASK).toMatch(/Numbers only/);
  });
});
