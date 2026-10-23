import { describe, expect, it } from "vitest";
import { lastSameWorkout, sameAsLast, type LoggedSet, type SessionLike } from "@/lib/engine/body-training";

const sess = (id: string, date: string, routineId: string | null, routineName: string | null, done = true): SessionLike => ({ id, date, routineId, routineName, completedAt: done ? `${date}T20:00:00Z` : null });
const set = (sessionId: string, date: string, exerciseId: string, weight: number, reps: number, warmup = false): LoggedSet => ({ sessionId, date, exerciseId, weight, reps, unit: "lb", warmup });

describe("H-1790: last time is the last finished session of the same workout, warm-ups first", () => {
  const sessions = [sess("s1", "2026-10-07", "shoulder", "Shoulder Day"), sess("s2", "2026-10-09", "arms", "Arm Day"), sess("s3", "2026-10-14", "shoulder", "Shoulder Day"), sess("s4", "2026-10-20", "shoulder", "Shoulder Day", false)];
  const sets = [
    set("s1", "2026-10-07", "press", 120, 10),
    set("s2", "2026-10-09", "cable", 20, 15),
    set("s3", "2026-10-14", "press", 70, 10, true),
    set("s3", "2026-10-14", "press", 90, 8, true),
    set("s3", "2026-10-14", "press", 130, 10),
    set("s3", "2026-10-14", "press", 130, 10),
    set("s3", "2026-10-14", "fly", 15, 12, true),
    set("s4", "2026-10-20", "press", 135, 8),
  ];
  const l = lastSameWorkout(sessions, sets, "shoulder", "2026-10-23");

  it("picks the routine's last finished session, skipping an unfinished one", () => {
    expect(l.session).toEqual({ id: "s3", date: "2026-10-14", routineName: "Shoulder Day" });
  });
  it("shows every set from it, warm-ups first, working sets apart", () => {
    const p = l.forExercise("press")!;
    expect(p.from).toBe("same");
    expect(p.warmups.map((s) => s.weight)).toEqual([70, 90]);
    expect(p.working.map((s) => `${s.weight}×${s.reps}`)).toEqual(["130×10", "130×10"]);
  });
  it("falls back to the exercise's own last working day, labelled by its routine", () => {
    const c = l.forExercise("cable")!;
    expect(c).toMatchObject({ from: "other", date: "2026-10-09", routineName: "Arm Day" });
    expect(c.working).toHaveLength(1);
  });
  it("an exercise with only warm-ups in that session falls back too, and none at all is null", () => {
    expect(l.forExercise("fly")).toBeNull();
    expect(l.forExercise("nothing")).toBeNull();
  });
  it("never looks at the day itself or later", () => {
    expect(lastSameWorkout(sessions, sets, "shoulder", "2026-10-14").session?.id).toBe("s1");
  });
  it("with no routine it is each exercise's own last day", () => {
    const n = lastSameWorkout(sessions, sets, null, "2026-10-23");
    expect(n.session).toBeNull();
    expect(n.forExercise("press")).toMatchObject({ from: "other", date: "2026-10-20" });
  });
  it("Same as last matches today's next set by position, warm-ups first", () => {
    const p = l.forExercise("press");
    expect(sameAsLast(p, 0)).toMatchObject({ weight: 70, warmup: true });
    expect(sameAsLast(p, 2)).toMatchObject({ weight: 130, warmup: false });
    expect(sameAsLast(p, 4)).toBeNull();
    expect(sameAsLast(null, 0)).toBeNull();
  });
});
