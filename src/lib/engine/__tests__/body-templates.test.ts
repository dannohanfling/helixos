import { describe, expect, it } from "vitest";
import { checkinNote, checkinWeekOk, copyName, dayTypeTemplate, isTemplateKind, mealTemplate, routineTemplate, sameName, templateName, templateSummary } from "@/lib/engine/body-templates";

const monday = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  const back = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
};

describe("B9: coach templates and the weekly check-in", () => {
  it("a day type, a meal with its foods by value, and a routine with its exercises by value; a line whose food is gone is left out", () => {
    const dt = dayTypeTemplate({ name: "Cut day", calMin: 1600, calMax: 1800, pMin: 170, pMax: 200, fMin: null, fMax: null, cMin: null, cMax: null, reminder: "Water first." });
    expect(dt.kind).toBe("day_type");
    expect(templateName(dt)).toBe("Cut day");
    expect(templateSummary(dt)).toBe('cal 1600–1800 · P 170–200 · "Water first."');
    const foods = [{ id: "f1", name: "Oats", unit: "g", cal: 3.8, p: 0.13, f: 0.07, c: 0.66, sodium: 0, capTag: null, basis: "cooked" as const, section: "pantry" as const }];
    const meal = mealTemplate({ name: "Breakfast", slot: "Breakfast", items: [{ foodId: "f1", qty: 80 }, { foodId: "gone", qty: 1 }] }, foods)!;
    expect(meal.kind === "meal" && meal.meal.items).toEqual([{ qty: 80, food: { name: "Oats", unit: "g", cal: 3.8, p: 0.13, f: 0.07, c: 0.66, sodium: 0, capTag: null, basis: "cooked", section: "pantry" } }]);
    expect(JSON.stringify(meal)).not.toContain("f1"); // ids never travel: the client gets foods by name and value
    expect(templateSummary(meal)).toBe("1 food · about 304 cal · Breakfast");
    expect(mealTemplate({ name: "Empty", slot: null, items: [{ foodId: "gone", qty: 1 }] }, foods)).toBeNull();
    const routine = routineTemplate({ name: "Push", items: [{ exerciseId: "e1", sets: 3, reps: "8" }, { exerciseId: "e2", sets: 3, reps: "10" }] }, [{ id: "e1", name: "Bench press", kind: "weight" }, { id: "e2", name: "Row", kind: "weight" }])!;
    expect(routine.kind === "routine" && routine.routine.items.map((i) => i.exercise.name)).toEqual(["Bench press", "Row"]);
    expect(templateSummary(routine)).toBe("2 exercises: Bench press 3×8, Row 3×10");
    expect(isTemplateKind("meal")).toBe(true);
    expect(isTemplateKind("photo")).toBe(false);
  });
  it("a copy keeps its name unless the client already has one by that name (case aside), then it says who it is from", () => {
    const mine = [{ name: "cut day" }, { name: "Rest" }];
    expect(copyName("Cut day", mine, "Danno Hanfling")).toBe("Cut day (from Danno)");
    expect(copyName("Push", mine, "Danno")).toBe("Push");
    expect(sameName("REST", mine)?.name).toBe("Rest");
    expect(sameName("Push", mine)).toBeNull();
  });
  it("a check-in's note is one trimmed paragraph of 500 at most, and its week is a Monday on or before this week's", () => {
    expect(checkinNote("  a\n\n long   week ")).toBe("a long week");
    expect(checkinNote("x".repeat(600))).toHaveLength(500);
    expect(checkinWeekOk("2026-09-28", "2026-10-02", monday)).toBe(true);
    expect(checkinWeekOk("2026-09-29", "2026-10-02", monday)).toBe(false); // a Tuesday
    expect(checkinWeekOk("2026-10-05", "2026-10-02", monday)).toBe(false); // next week
    expect(checkinWeekOk("nope", "2026-10-02", monday)).toBe(false);
  });
});
