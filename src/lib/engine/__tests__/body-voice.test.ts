import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { feelingLine, feelingReply, helpLines, matchName, matchSetNotes, needsFor, parseSetNotesCsv, resolveSets, warmupCandidates, type Context } from "@/lib/engine/body-voice";
import { habitTick } from "@/lib/engine/body-whoop";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const EX = [{ name: "Leg Curl" }, { name: "Seated Leg Curl" }, { name: "Incline Dumbbell Press" }, { name: "Pull-up" }, { name: "Romanian Deadlift (DB)" }];
const ctx = (over: Partial<Context> = {}): Context => ({ kind: "weight", unit: "lb", last: [{ weight: 55, reps: 10 }, { weight: 55, reps: 9 }, { weight: 50, reps: 10 }], lastDate: "2026-10-08", plan: { sets: 3, reps: "10", weight: 55 }, next: null, ...over });

describe("the HumanOS voice pack (rev 653)", () => {
  it("names: the exact one, else the one holding every word; near-duplicates are choices; nothing matched is none", () => {
    expect(matchName("incline db press", EX)).toEqual({ kind: "one", item: EX[2] });
    expect(matchName("I did incline dumbbell press", EX)).toEqual({ kind: "one", item: EX[2] });
    expect(matchName("leg curl", EX)).toEqual({ kind: "one", item: EX[0] });
    expect(matchName("curl", EX)).toEqual({ kind: "choices", items: [EX[0], EX[1]] });
    expect(matchName("pull ups", EX)).toEqual({ kind: "one", item: EX[3] });
    expect(matchName("bulgarian split squat", EX)).toEqual({ kind: "none" });
  });

  it("missing numbers come back as needs, the right questions for weight, bodyweight and timed, never a guess", () => {
    expect(resolveSets({}, ctx())).toEqual({ ok: false, needs: needsFor("weight", "lb") });
    expect(needsFor("weight", "lb").join(" ")).toMatch(/sets[\s\S]*weight \(lb\) and reps/);
    expect(needsFor("bodyweight", "kg").join(" ")).toMatch(/reps in each[\s\S]*weight added \(kg\)/);
    expect(needsFor("timed", "lb").join(" ")).toMatch(/minutes[\s\S]*distance/);
    // Reps but no weight on a weight exercise: asks for the weight.
    const r = resolveSets({ setsCount: 3, reps: 10 }, ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.needs[0]).toMatch(/weight \(lb\)/);
    // A bodyweight exercise needs only reps.
    expect(resolveSets({ setsCount: 2, reps: 8 }, ctx({ kind: "bodyweight" }))).toEqual({ ok: true, sets: [{ weight: null, reps: 8, warmup: false }, { weight: null, reps: 8, warmup: false }] });
    // The help lines: last time, the plan, next time's weight.
    expect(helpLines(ctx())).toEqual(["Last time (2026-10-08): 55×10, 55×9, 50×10.", "Plan: 3×10 at 55."]);
    expect(helpLines(ctx({ plan: null, next: 60 }))).toEqual(["Last time (2026-10-08): 55×10, 55×9, 50×10.", "Next time's weight: 60 lb."]);
  });

  it("accepts \"same as last time\" and \"as planned\", and logs every set once, warm-ups first", () => {
    expect(resolveSets({ same: "last_time" }, ctx())).toEqual({ ok: true, sets: [{ weight: 55, reps: 10, warmup: false }, { weight: 55, reps: 9, warmup: false }, { weight: 50, reps: 10, warmup: false }] });
    expect(resolveSets({ same: "planned" }, ctx())).toEqual({ ok: true, sets: Array.from({ length: 3 }, () => ({ weight: 55, reps: 10, warmup: false })) });
    // A planned range needs the reps said; with no plan, "as planned" says so.
    const range = resolveSets({ same: "planned" }, ctx({ plan: { sets: 3, reps: "8–10", weight: 55 } }));
    expect(range.ok).toBe(false);
    expect(resolveSets({ same: "planned", reps: 9 }, ctx({ plan: { sets: 3, reps: "8–10", weight: 55 } }))).toMatchObject({ ok: true });
    expect(resolveSets({ same: "planned" }, ctx({ plan: null })).ok).toBe(false);
    expect(resolveSets({ same: "last_time" }, ctx({ last: [] })).ok).toBe(false);
    // "2 warm-up sets then 3×10 at 55".
    const warm = resolveSets({ warmups: [{ weight: 25, reps: 10 }, { weight: 35, reps: 8 }], setsCount: 3, reps: 10, weight: 55 }, ctx());
    expect(warm).toEqual({ ok: true, sets: [{ weight: 25, reps: 10, warmup: true }, { weight: 35, reps: 8, warmup: true }, { weight: 55, reps: 10, warmup: false }, { weight: 55, reps: 10, warmup: false }, { weight: 55, reps: 10, warmup: false }] });
    // Each set as said, one weight for all.
    expect(resolveSets({ sets: [{ reps: 10 }, { reps: 9 }], weight: 60 }, ctx())).toEqual({ ok: true, sets: [{ weight: 60, reps: 10, warmup: false }, { weight: 60, reps: 9, warmup: false }] });
  });

  it("warm-ups: an exercise's first set at under 60% of the day's top, and they count toward no PR, volume, tally or next weight", () => {
    const s = (id: string, date: string, ex: string, weight: number | null, warmup = false) => ({ id, date, exerciseId: ex, weight, warmup });
    const found = warmupCandidates([s("a", "2026-10-01", "bench", 95), s("b", "2026-10-01", "bench", 185), s("c", "2026-10-01", "row", 120), s("d", "2026-10-01", "row", 135), s("e", "2026-10-02", "bench", 45, true), s("f", "2026-10-02", "bench", 185), s("g", "2026-10-03", "dip", null), s("h", "2026-10-03", "dip", null)]);
    expect(found.map((x) => x.id)).toEqual(["a"]);
    // Every read behind a PR, last time, next weight, the plan's count, the heatmap and the tallies leaves warm-ups out.
    const q = read("src/lib/queries/body.ts");
    expect(q).toMatch(/async function setsOf[\s\S]{0,300}eq\(schema\.bodySets\.warmup, false\)/);
    expect(q).toMatch(/const plan = sessionPlan\(routine\?\.lines \?\? \[\], daySets\.filter\(\(s\) => !s\.warmup\)\);/);
    expect(q).toMatch(/nextSetDefaults\(working, last, unit\)/);
    expect((q.match(/db\.query\.bodySets\.findMany\(/g) ?? []).length - (q.match(/db\.query\.bodySets\.findMany\(\{[^;]*?eq\(schema\.bodySets\.warmup, false\)/g) ?? []).length).toBe(1); // the day's own sets, shown marked
    expect(read("src/lib/body-goals.ts").match(/eq\(schema\.bodySets\.warmup, false\)/g)?.length).toBe(2);
  });

  it("activities feed the Walk habit by WHOOP's rule", () => {
    const habits = [{ id: "h1", name: "Walk / steps", kind: "done" as const }, { id: "h2", name: "Sauna", kind: "minutes" as const }];
    expect(habitTick("Walking", 30, habits)).toEqual({ habitId: "h1", value: 1 });
    expect(habitTick("Sauna", 18, habits)).toEqual({ habitId: "h2", value: 18 });
    expect(read("src/lib/body-activities.ts")).toMatch(/habitTick\(SPORT\[a\.type\], a\.minutes, habits\)/);
  });

  it("the check-in says back what was saved, kindly, and never gives advice", () => {
    const low = { energy: 2, mood: 3, soreness: "some" as const, sorenessArea: "legs", sleepFeel: 2 };
    expect(feelingLine(low)).toBe("Energy 2 of 5, mood 3 of 5, slept 2 of 5, a bit sore (legs).");
    for (const f of [low, { energy: 5, mood: 5, soreness: "none" as const, sorenessArea: null, sleepFeel: 4 }, { energy: 1, mood: 1, soreness: "sore" as const, sorenessArea: "back", sleepFeel: 1 }]) {
      const r = feelingReply(f);
      expect(r.length).toBeGreaterThan(10);
      expect(r).not.toMatch(/should|try |consider|doctor|recommend|medic|rest up|take it easy|diagnos/i);
    }
  });

  it("the old CSV's notes: found by their headings, matched by date, exercise and set number, and the dry run writes nothing", () => {
    const csv = "Date,Exercise,Set #,Weight,Reps,Notes\n2026-03-21,Incline Dumbbell Press,1,50,10,first DB press post-injury\n2026-03-21,Incline Dumbbell Press,2,55,8,\n3/21/2026,Triceps — Skullcrushers,1,40,12,superset with pushdowns\n2026-03-22,Leg Curl,1,90,10,deload\n";
    const p = parseSetNotesCsv(csv);
    expect("notes" in p && p.notes.map((n) => [n.date, n.exercise, n.set, n.note])).toEqual([
      ["2026-03-21", "Incline Dumbbell Press", 1, "first DB press post-injury"],
      ["2026-03-21", "Triceps — Skullcrushers", 1, "superset with pushdowns"],
      ["2026-03-22", "Leg Curl", 1, "deload"],
    ]);
    expect(parseSetNotesCsv("Date,Lift,Reps\n")).toEqual({ missing: ["set", "notes"] });
    if (!("notes" in p)) throw new Error("parsed");
    const sets = [
      { id: "s1", date: "2026-03-21", exerciseId: "inc", note: null },
      { id: "s2", date: "2026-03-21", exerciseId: "inc", note: null },
      { id: "s3", date: "2026-03-21", exerciseId: "sk", note: null },
      { id: "s4", date: "2026-03-23", exerciseId: "lc", note: null },
    ];
    const names: Record<string, string> = { inc: "Incline Dumbbell Press", sk: "Skullcrushers", lc: "Leg Curl" };
    const before = JSON.stringify(sets);
    const m = matchSetNotes(p.notes, sets, (id) => names[id], (n) => n.split(" — ").pop()!);
    expect(m.matched.map((x) => [x.setId, x.note])).toEqual([["s1", "first DB press post-injury"], ["s3", "superset with pushdowns"]]);
    expect(m.unmatched.map((x) => x.note)).toEqual(["deload"]);
    expect(JSON.stringify(sets)).toBe(before);
  });

  it("the tools: the described food never logs without a pick, the pantry batch adds nothing for an unknown food, an unknown exercise is made only with create", () => {
    const src = read("src/lib/mcp/tools/body.ts");
    const food = src.slice(src.indexOf('name: "body_log_described_food"'), src.indexOf("export const bodyMarkWarmups"));
    expect(food.indexOf("if (!input.pick)")).toBeGreaterThan(0);
    expect(food.indexOf("if (!input.pick)")).toBeLessThan(food.indexOf("saveFoundFood("));
    const pantry = src.slice(src.indexOf('name: "body_pantry_add_many"'), src.indexOf("export const bodyLogDescribedFood"));
    expect(pantry).toMatch(/if \(m\.kind === "none"\) unknown\.push\(it\.food\);\n\s+else if \(m\.kind === "choices"\) unsure\.push/);
    const ex = src.slice(src.indexOf('name: "body_log_exercise"'), src.indexOf("export const bodyNoteAdd"));
    expect(ex.indexOf('if (m.kind === "choices") return')).toBeLessThan(ex.indexOf("logSets("));
    expect(ex.indexOf("if (!input.create) return")).toBeLessThan(ex.indexOf("insert(schema.bodyExercises)"));
    expect(ex.indexOf("if (!r.ok)")).toBeLessThan(ex.indexOf("logSets("));
    // One set write: the page, body_log_set and body_log_exercise all go through logSets.
    expect(read("src/lib/actions/body.ts")).toMatch(/await logSets\(workspaceId, userId, date, exercise!\.id,/);
    expect(src.match(/await logSets\(v\.workspace\.id, v\.user\.id, date, exercise\.id,/g)?.length).toBe(2);
    expect(src).not.toMatch(/insert\(schema\.bodySets\)/);
  });
});
