import { describe, expect, it } from "vitest";
import type { AirtableRecord } from "@/lib/engine/airtable-import";
import { buildHistoryPlan, exerciseName, historySummary, parseNotes, readSetLine, readingIdFor, routinesFrom, sessionsFrom, weighInsFrom, type Existing } from "@/lib/engine/body-airtable";

let n = 0;
const rec = (fields: Record<string, unknown>, id = `rec${String(++n).padStart(14, "0")}`): AirtableRecord => ({ id, createdTime: "2026-04-01T00:00:00.000Z", fields });
const none: Existing = { exercises: new Map(), routines: new Set(), sessionDates: new Set(), readingIds: new Set() };

/* Synthetic rows in the base's field names (emoji prefixes as Airtable returns them); nobody's numbers. */
const journal = [
  rec({ "📆 Date": "2026-05-02", "⚖ Weight": 171.4, "🫓 Body Fat %": 0.223, "🏗 Skeletal Muscle %": 0.498, "💧 Body Water %": 0.561, "🧬 Fat-Free Mass": 133, "🫀 Visceral Fat": 9, "🔥 BMR": 1640, "🧠 Metabolic Age": 38 }, "recOLD0000000001"),
  rec({ "📆 Date": "2026-05-03", "⚖ Weight": 171.0, "🫓 Body Fat %": 0.22, "🤖 RENPHO Current Weight": 170.6, "🤖 RENPHO Current Body Fat": 21.9, "🤖 RENPHO Current Skeletal Muscle": 50.1 }, "recMID0000000001"),
  rec({ "📆 Date": "2026-09-20", "RENPHO Weight": 151.2, "RENPHO Body Fat %": 18.1, "RENPHO Skeletal Muscle %": 52.9, "RENPHO Visceral Fat": 8, "RENPHO Body Water %": 59, "RENPHO Metabolic Age": 34, "RENPHO BMR": 1560, "🤖 RENPHO Current Weight": 158 }, "recNEW0000000001"),
  rec({ "📆 Date": "2026-09-21", "RENPHO Weight": 151.0, "RENPHO Body Fat %": 18, "📊 Renpho Data Type": "Weekly Carry-Forward" }, "recEST0000000001"),
  rec({ "📆 Date": "2026-09-22", "RENPHO Weight": 9, "RENPHO Body Fat %": 18 }, "recBAD0000000001"),
  rec({ "📆 Date": "2026-04-12", "🏋️ Workouts": ["recEXA"], "🏋🏿 Routines": ["recRTL"], "🏋️ Exercise Notes": "Working Session\nPrimary — Squats\n• 115 × 10\n" }, "recJ4120000000001"),
  rec({ "📆 Date": "2026-04-12", "🏋️ Workouts": ["recEXB"] }, "recJ4120000000002"),
  rec({ "📆 Date": "2026-09-26", "🏋🏿 Routines": ["recRTL"], "🏋️ Exercise Notes": "🦵 SATURDAY LEGS (9/26) — FIRST LEG DAY IN 13 DAYS\n⚠️ Last legs was 9/13. Long gap.\n\nMEAL FRAMEWORK (Lift Day):\n• Shake within 90 min\n• Target ~1,460 / 200P / 50F\n\nWarm-Up\n• Bodyweight squats ×15\n• Leg Extension 60×10 (primer)\n\nWorking Session (3 sets per exercise, INTERMEDIATE — reload)\n\nBack Squat (⚠️ REDUCED from 135 — 13 days off)\nwarmup: 45×10, 95×8 — assess here\n• 125×8\n• 125×8\n• 125×8\n\nRomanian Deadlift (DB) — KEEP 2ND, this placement is why it stopped getting skipped\n• 45×10\n• 45×10\n• 45×10\n\nLeg Curl (STRICT FORM — hips planted, no body slide)\n• 85×10\n• 90×10\n• ninety by ten\n\n🚫 GUARDRAILS: NO 400 Leg Press, NO max squats.\n\nRecovery\n• Sauna 15-20 min\n• 130+ oz water + 1 LMNT\n" }, "recJ9260000000001"),
  rec({ "📆 Date": "2026-09-27", "🏋️ Exercise Notes": "😴 SUNDAY OFF (9/27) — not trained.\n" }, "recJ9270000000001"),
];
const exercises = [
  rec({ "🏋️ Exercise": "Squats", "🏋🏿 Rep Weight": 115, "💪 Reps / Set": 10, "🏆 Sets": 2, "📖 Journal": ["recJ4120000000001"] }, "recEXA"),
  rec({ "🏋️ Exercise": "Leg Press", "🏋🏿 Rep Weight": 300, "💪 Reps / Set": 15, "🏆 Sets": 2, "📖 Journal": ["recJ4120000000002"] }, "recEXB"),
  rec({ "🏋️ Exercise": "SKULLCRUSHERS", "💪 Reps / Set": 12, "🏆 Sets": 3 }, "recEXC"),
  rec({ "🏋️ Exercise": "Pushups" }, "recEXD"),
];
const routines = [rec({ Name: "💪 Arm Day", "🏋️‍♂️ Exercises": ["recEXC", "recEXD", "recEXC"] }, "recRTA"), rec({ Name: "🦵 Leg Day", "🏋️‍♂️ Exercises": ["recEXA", "recEXB"] }, "recRTL"), rec({ Name: "Empty Day" }, "recRTE")];
const src = { journal, exercises, routines };

describe("Body's Airtable history (rev 237 phase 7)", () => {
  it("weigh-ins: the newest generation wins a day, the oldest's fractions become percents, estimated and out-of-range days are left out and counted", () => {
    const { weighIns, skipped } = weighInsFrom(journal);
    expect(weighIns.map((w) => [w.date, w.gen])).toEqual([
      ["2026-05-02", "oldest"],
      ["2026-05-03", "middle"],
      ["2026-09-20", "latest"],
    ]);
    expect(weighIns[0].values).toEqual({ weight: 171.4, bf: 22.3, smm_pct: 49.8, water: 56.1, ffm: 133, visceral: 9, bmr: 1640, met_age: 38 });
    expect(weighIns[1].values).toEqual({ weight: 170.6, bf: 21.9, smm_pct: 50.1 });
    expect(weighIns[2].values).toEqual({ weight: 151.2, bf: 18.1, smm_pct: 52.9, visceral: 8, water: 59, met_age: 34, bmr: 1560 });
    expect(skipped).toEqual([{ date: "2026-09-21", why: "weekly carry-forward" }]);
    expect(readingIdFor("recNEW0000000001")).toBe("airtable:recNEW0000000001");
  });
  it("set lines: weight × reps, a count of alike sets, bodyweight, and the parenthetical ignored", () => {
    expect(readSetLine("• 65 × 10")).toEqual([{ weight: 65, reps: 10 }]);
    expect(readSetLine("• 12.5×15×3")).toEqual([{ weight: 12.5, reps: 15 }, { weight: 12.5, reps: 15 }, { weight: 12.5, reps: 15 }]);
    expect(readSetLine("• BW × 15")).toEqual([{ weight: null, reps: 15 }]);
    expect(readSetLine("• 60×10 (+CG 60×10)")).toEqual([{ weight: 60, reps: 10 }]);
    expect(readSetLine("• 300 × 6 (I felt a cramp)")).toEqual([{ weight: 300, reps: 6 }]);
    expect(readSetLine("• Sauna 15 min")).toBeNull();
    expect(readSetLine("• 130+ oz water")).toBeNull();
  });
  it("exercise headings: the role prefix, the parenthetical and the trailing remark go; shouted names come to title case", () => {
    expect(exerciseName("Primary — Squats (Back-Safe Technique)")).toBe("Squats");
    expect(exerciseName("Chest Accessory — Pec Fly Machine")).toBe("Pec Fly Machine");
    expect(exerciseName("Triceps — Extensions")).toBe("Triceps Extensions");
    expect(exerciseName("Triceps — Skullcrushers")).toBe("Skullcrushers");
    expect(exerciseName("Romanian Deadlift (DB) — KEEP 2ND, this placement is why it stopped getting skipped")).toBe("Romanian Deadlift");
    expect(exerciseName("Iso-Lateral Shoulder Press (do FIRST — 9/11: 110×10 / 130×10 / 130×10)")).toBe("Iso-Lateral Shoulder Press");
    expect(exerciseName("SKULLCRUSHERS")).toBe("Skullcrushers");
    expect(exerciseName("💪 Arm Day")).toBe("Arm Day");
  });
  it("notes: warm-ups, meals, guardrails and recovery pass; the working sets land under their exercise; a line it can't read is counted", () => {
    const p = parseNotes(journal[7].fields["🏋️ Exercise Notes"] as string);
    expect(p.exercises.map((e) => [e.name, e.sets.length])).toEqual([
      ["Back Squat", 3],
      ["Romanian Deadlift", 3],
      ["Leg Curl", 2],
    ]);
    expect(p.exercises[2].sets).toEqual([{ weight: 85, reps: 10 }, { weight: 90, reps: 10 }]);
    expect(p.unread).toBe(1);
    expect(parseNotes("😴 SUNDAY OFF (9/27) — not trained.\n").exercises).toEqual([]);
    const spring = parseNotes("Warm-Up / Activation\nCable Fly\n• 17.5 × 15\n\nWorking Session\nPrimary — Dumbbell Flat Press\nWorking Sets\n• 60 × 12\n• 65 × 12\n\nSecondary — Incline Dumbbell Press\nWarm-Up\n• 30 × 12\nWorking Sets\n• 55 × 10\n\nRecovery\n• Sauna 15 min\n");
    expect(spring.exercises).toEqual([
      { name: "Dumbbell Flat Press", sets: [{ weight: 60, reps: 12 }, { weight: 65, reps: 12 }] },
      { name: "Incline Dumbbell Press", sets: [{ weight: 55, reps: 10 }] },
    ]);
  });
  it("sessions: a day's Exercises rows win over its notes, rows on two Journal rows of one day merge, the routine's name comes along; notes-only days only when asked", () => {
    const s = sessionsFrom(src, { notes: true });
    expect(s.map((x) => [x.date, x.from, x.routineName, x.exercises.map((e) => `${e.name}:${e.sets.length}`).join(",")])).toEqual([
      ["2026-04-12", "table", "Leg Day", "Squats:2,Leg Press:2"],
      ["2026-09-26", "notes", "Leg Day", "Back Squat:3,Romanian Deadlift:3,Leg Curl:2"],
    ]);
    expect(s[0].exercises[1].sets[0]).toEqual({ weight: 300, reps: 15 });
    expect(sessionsFrom(src, { notes: false }).map((x) => x.date)).toEqual(["2026-04-12"]);
  });
  it("routines: exercises in order without repeats, sets and reps from the row or 3 × 8–12; an empty routine is left out", () => {
    expect(routinesFrom(src)).toEqual([
      { name: "Arm Day", items: [{ exerciseName: "Skullcrushers", sets: 3, reps: "12" }, { exerciseName: "Pushups", sets: 3, reps: "8–12" }] },
      { name: "Leg Day", items: [{ exerciseName: "Squats", sets: 2, reps: "10" }, { exerciseName: "Leg Press", sets: 2, reps: "15" }] },
    ]);
  });
  it("the plan says new or already in, per weigh-in, day, exercise and routine, and the cut-off date narrows it", () => {
    const p = buildHistoryPlan(src, none, { notes: true, from: null });
    expect(historySummary(p)).toEqual({ weighIns: 3, weighInsHave: 0, sessions: 2, sessionsHave: 0, sets: 12, exercises: 7, routines: 2, skipped: 1, unread: 1 });
    expect(p.exercises.map((e) => e.name)).toEqual(["Back Squat", "Leg Curl", "Leg Press", "Pushups", "Romanian Deadlift", "Skullcrushers", "Squats"]);
    const some: Existing = { exercises: new Map([["squats", "x1"], ["leg curl", "x2"]]), routines: new Set(["leg day"]), sessionDates: new Set(["2026-04-12"]), readingIds: new Set([readingIdFor("recOLD0000000001")]) };
    const q = buildHistoryPlan(src, some, { notes: true, from: null });
    expect(historySummary(q)).toEqual({ weighIns: 2, weighInsHave: 1, sessions: 1, sessionsHave: 1, sets: 8, exercises: 4, routines: 1, skipped: 1, unread: 1 });
    expect(q.exercises).toEqual([
      { name: "Back Squat", status: "new" },
      { name: "Leg Curl", status: "have" },
      { name: "Pushups", status: "new" },
      { name: "Romanian Deadlift", status: "new" },
      { name: "Skullcrushers", status: "new" },
    ]);
    const r = buildHistoryPlan(src, none, { notes: true, from: "2026-09-01" });
    expect(r.weighIns.map((w) => w.date)).toEqual(["2026-09-20"]);
    expect(r.sessions.map((s) => s.date)).toEqual(["2026-09-26"]);
  });
});
