import { describe, expect, it } from "vitest";
import { daysBetween } from "@/lib/dates";
import { belowPar, inFoodUnit, takeFromPantry, toBasis, dueSoon, yieldFor, type PantryItemLike } from "@/lib/engine/body-pantry";
import { whatFits } from "@/lib/engine/body";

const beef = { id: "beef", name: "80/20 beef, cooked", unit: "oz", basis: "cooked" as const, par: 16, cookedYield: null };
const item = (id: string, foodId: string, qty: number, unit: string, state: "raw" | "cooked", useBy: string | null, boughtOn: string | null = null): PantryItemLike => ({ id, foodId, qty, unit, state, useBy, boughtOn });

describe("pantry: cooked yield (rev 251's order)", () => {
  it("the entered figure first, else the median of the weighings, else none; typos are never a factor", () => {
    expect(yieldFor({ cookedYield: 0.61 }, [{ raw: 16, cooked: 12 }])).toEqual({ factor: 0.61, source: "entered" });
    expect(yieldFor({ cookedYield: null }, [{ raw: 16, cooked: 9.8 }, { raw: 16, cooked: 10.4 }, { raw: 8, cooked: 5.2 }])).toEqual({ factor: 0.65, source: "weighings" });
    expect(yieldFor({ cookedYield: null }, [{ raw: 16, cooked: 9.8 }, { raw: 16, cooked: 10.4 }])).toEqual({ factor: 0.63, source: "weighings" });
    expect(yieldFor({ cookedYield: null }, [])).toEqual({ factor: null, source: "none" });
    expect(yieldFor({ cookedYield: 61 }, [{ raw: 16, cooked: 9.8 }])).toEqual({ factor: 0.61, source: "weighings" });
    expect(yieldFor({ cookedYield: null }, [{ raw: 0, cooked: 5 }, { raw: 16, cooked: 40 }])).toEqual({ factor: null, source: "none" });
  });
  it("a weighed quantity to the food's basis: as is when the same, by the yield across, flagged with none", () => {
    expect(toBasis(8, "cooked", "cooked", 0.61)).toEqual({ qty: 8, converted: false, check: false });
    expect(toBasis(16, "raw", "cooked", 0.61)).toEqual({ qty: 9.76, converted: true, check: false });
    expect(toBasis(9.76, "cooked", "raw", 0.61)).toEqual({ qty: 16, converted: true, check: false });
    expect(toBasis(16, "raw", "cooked", null)).toEqual({ qty: 16, converted: false, check: true });
  });
});

describe("pantry: on hand, use soon, below par", () => {
  const today = "2026-09-30";
  it("an item in the food's unit, or null when it doesn't convert", () => {
    expect(inFoodUnit({ qty: 1, unit: "lb" }, { unit: "oz" })).toBe(16);
    expect(inFoodUnit({ qty: 2, unit: "bag" }, { unit: "oz" })).toBeNull();
  });
  it("use soon: within two days or past, soonest first", () => {
    const items = [item("a", "beef", 8, "oz", "raw", "2026-10-05"), item("b", "beef", 8, "oz", "raw", "2026-10-02"), item("c", "eggs", 6, "egg", "raw", "2026-09-29"), item("d", "x", 1, "oz", "raw", null)];
    expect(dueSoon(items, today, daysBetween).map((x) => [x.id, x.days])).toEqual([["c", -1], ["b", 2]]);
  });
  it("below par: what to buy in the food's unit, items that don't convert counting as nothing", () => {
    const items = [item("a", "beef", 0.5, "lb", "raw", null), item("b", "beef", 2, "oz", "cooked", null), item("c", "beef", 1, "bag", "raw", null)];
    expect(belowPar([beef], items)).toEqual([{ foodId: "beef", name: beef.name, unit: "oz", par: 16, onHand: 10, short: 6 }]);
    expect(belowPar([beef], [item("a", "beef", 1, "lb", "raw", null)])).toEqual([]);
    expect(belowPar([{ ...beef, par: null }], [])).toEqual([]);
  });
});

describe("pantry: a logged quantity comes off the shelf", () => {
  it("soonest use-by first, then undated by bought date; a raw item shrinks by the yield for a cooked-basis food", () => {
    const items = [item("late", "beef", 16, "oz", "raw", "2026-10-09"), item("soon", "beef", 8, "oz", "raw", "2026-10-02")];
    // 6 oz cooked at 61% takes 9.84 oz raw: all 8 of "soon" (4.88 cooked), then 1.12 cooked = 1.84 raw from "late".
    expect(takeFromPantry(items, beef, 6, 0.61)).toEqual([{ id: "soon", qty: 0 }, { id: "late", qty: 14.16 }]);
    // No yield known: one for one.
    expect(takeFromPantry(items, beef, 6, null)).toEqual([{ id: "soon", qty: 2 }]);
    // A cooked item for a cooked-basis food: one for one, in its own unit (a pound shelf, an ounce food).
    expect(takeFromPantry([item("lb", "beef", 1, "lb", "cooked", null)], beef, 4, 0.61)).toEqual([{ id: "lb", qty: 0.75 }]);
    // Undated items go last, oldest bought first; more than the shelf holds empties it.
    const undated = [item("new", "beef", 4, "oz", "cooked", null, "2026-09-28"), item("old", "beef", 4, "oz", "cooked", null, "2026-09-20")];
    expect(takeFromPantry(undated, beef, 10, null)).toEqual([{ id: "old", qty: 0 }, { id: "new", qty: 0 }]);
    // Items that don't convert are left alone.
    expect(takeFromPantry([item("bag", "beef", 1, "bag", "raw", null)], beef, 4, null)).toEqual([]);
  });
});

describe("pantry: what fits puts a meal with something to use soon first", () => {
  it("ties aside, the meal holding a use-soon food sorts first; without a preference the usual order holds", () => {
    const bands = { cal: { min: 1400, max: 1500 }, p: { min: 180, max: 200 }, f: { min: 55, max: 65 }, c: { min: 0, max: 5 } };
    const eaten = { cal: 780, p: 90, f: 30, c: 1 };
    const meals = [
      { id: "a", name: "A", totals: { cal: 650, p: 95, f: 30, c: 2 }, foodIds: ["chicken"] },
      { id: "b", name: "B", totals: { cal: 650, p: 95, f: 30, c: 2 }, foodIds: ["steak"] },
    ];
    const opts = { floors: { cal: null, f: null }, overOk: [] as ("cal" | "p" | "f" | "c")[] };
    expect(whatFits(eaten, bands, meals, opts).map((f) => f.id)).toEqual(["a", "b"]);
    expect(whatFits(eaten, bands, meals, { ...opts, prefer: new Set(["steak"]) }).map((f) => f.id)).toEqual(["b", "a"]);
  });
});
