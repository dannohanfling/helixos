import { describe, expect, it } from "vitest";
import { instacartLines, listSummary, shoppingList, type ShopFood } from "@/lib/engine/body-shopping";

const foods: ShopFood[] = [
  { id: "steak", name: "Lean steak", unit: "oz", basis: "cooked", par: 24, cookedYield: null, section: "meat" },
  { id: "eggs", name: "Eggs", unit: "egg", basis: "cooked", par: null, cookedYield: null, section: "dairy" },
  { id: "spinach", name: "Spinach", unit: "cup", basis: "raw", par: null, cookedYield: null, section: "produce" },
  { id: "rice", name: "Rice", unit: "g", basis: "cooked", par: 500, cookedYield: null, section: null },
];
const plan = [
  { times: 3, lines: [{ foodId: "steak", qty: 6 }, { foodId: "spinach", qty: 2 }] },
  { times: 2, lines: [{ foodId: "eggs", qty: 3 }] },
];
const shelf = [
  { id: "i1", foodId: "steak", qty: 8, unit: "oz", state: "cooked" as const, useBy: null, boughtOn: null },
  { id: "i2", foodId: "rice", qty: 900, unit: "g", state: "cooked" as const, useBy: null, boughtOn: null },
];

describe("the shopping list (rev 237 phase 10)", () => {
  it("the plan minus the shelf, plus staples below par, grouped by section in store order; nothing for a food that's covered", () => {
    const list = shoppingList(foods, plan, shelf);
    expect(list.sections.map((s) => s.label)).toEqual(["Produce", "Meat and fish", "Dairy and eggs"]);
    expect(list.lines.map((l) => [l.name, l.toBuy, l.why])).toEqual([
      ["Spinach", 6, "plan"],
      ["Lean steak", 16, "both"],
      ["Eggs", 6, "plan"],
    ]);
    // Steak: the plan needs 18 with 8 on hand (10 short); par 24 wants 16 more; the larger wins.
    expect(list.lines[1]).toMatchObject({ needed: 18, onHand: 8, par: 24, section: "meat" });
    // Rice: 900 g on hand against par 500 and no plan: not on the list.
    expect(list.lines.some((l) => l.foodId === "rice")).toBe(false);
    expect(listSummary(list)).toBe("3 lines in 3 sections");
  });
  it("a line below par alone says par; a dropped food leaves the list; a section-less food reads as other; an empty list says so", () => {
    const list = shoppingList(foods, [], []);
    expect(list.lines.map((l) => [l.name, l.toBuy, l.why, l.section])).toEqual([
      ["Lean steak", 24, "par", "meat"],
      ["Rice", 500, "par", "other"],
    ]);
    expect(shoppingList(foods, [], [], new Set(["steak"])).lines.map((l) => l.name)).toEqual(["Rice"]);
    expect(listSummary(shoppingList(foods, [], shelf, new Set(["steak"])))).toBe("nothing to buy");
  });
  it("Instacart lines: the food's unit mapped, pieces rounded up to whole, others to a tenth, never zero", () => {
    const list = shoppingList(foods, plan, shelf);
    expect(instacartLines(list.lines)).toEqual([
      { name: "Spinach", quantity: 6, unit: "cup" },
      { name: "Lean steak", quantity: 16, unit: "oz" },
      { name: "Eggs", quantity: 6, unit: "each" },
    ]);
    expect(instacartLines([{ ...list.lines[2], toBuy: 0.2, unit: "scoop" }])).toEqual([{ name: "Eggs", quantity: 1, unit: "each" }]);
    expect(instacartLines([{ ...list.lines[1], toBuy: 0.04 }])[0].quantity).toBe(0.1);
  });
});
