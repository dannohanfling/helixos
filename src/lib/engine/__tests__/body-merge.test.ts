import { describe, expect, it } from "vitest";
import { mergePreview, mergeRoutineItems, undoOpen } from "@/lib/engine/body-merge";

const s = (date: string, weight: number, reps: number) => ({ date, weight, unit: "lb" as const, reps });

describe("merging exercises (rev 507)", () => {
  it("turns the merged exercise into the kept one in a routine, keeping one line when it holds both", () => {
    const items = [
      { exerciseId: "a", sets: 3, reps: "10" },
      { exerciseId: "b", sets: 3, reps: "8-12", weight: 90 },
    ];
    expect(mergeRoutineItems(items, "b", "k")).toEqual([{ exerciseId: "a", sets: 3, reps: "10" }, { exerciseId: "k", sets: 3, reps: "8-12", weight: 90 }]);
    expect(mergeRoutineItems([...items, { exerciseId: "k", sets: 4, reps: "6" }], "b", "k")).toEqual([{ exerciseId: "a", sets: 3, reps: "10" }, { exerciseId: "k", sets: 4, reps: "6" }]);
    expect(mergeRoutineItems(items, "z", "k")).toBeNull();
  });
  it("previews what moves and the PR after", () => {
    const merged = [s("2026-03-21", 100, 10), s("2026-04-12", 105, 10), s("2026-04-01", 100, 12)];
    const kept = [s("2026-09-01", 95, 10)];
    const p = mergePreview(merged, kept, { mergedName: "Leg Curl", keptName: "Seated Leg Curl", unit: "lb", kind: "weight" });
    expect(p.text).toBe("Move 3 sets (Mar 21 to Apr 12) from Leg Curl into Seated Leg Curl; PR becomes 105 × 10.");
    expect(mergePreview([s("2026-03-21", 90, 10)], kept, { mergedName: "A", keptName: "B", unit: "lb", kind: "weight" }).text).toBe("Move 1 set (Mar 21) from A into B; PR stays 95 × 10.");
  });
  it("keeps Undo open for 7 days", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(undoOpen("2026-10-05 12:00:00", now)).toBe(true);
    expect(undoOpen("2026-10-02 12:00:00", now)).toBe(false);
  });
});
