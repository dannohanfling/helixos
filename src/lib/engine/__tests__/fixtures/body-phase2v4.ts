/**
 * Test fixture only: Danno's Phase 2 V4 protocol, exactly as in the handoff (rev 179 for the bands, rev 184 for the seed foods,
 * meals and the cheese cap). The unit tests and the body walk use it as real-world data to check the math against; nothing in
 * the app imports it (rev 192: every member, Danno included, starts blank and enters their own through the app). A unit test
 * holds that no app module imports this file or carries these numbers.
 */
import type { Cap, Macros } from "@/lib/engine/body";

export type FixtureDayType = { key: string; name: string; cal: [number, number]; p: [number, number]; f: [number, number]; c: [number, number] };
export type FixtureFood = { key: string; name: string; unit: string; capTag?: string } & Macros;
export type FixtureMeal = { name: string; slot: string | null; items: { food: string; qty: number }[] };

export const PHASE2_V4 = {
  dayTypes: [
    { key: "lift", name: "Lift day", cal: [1400, 1500], p: [180, 200], f: [55, 65], c: [0, 5] },
    { key: "off", name: "Off day", cal: [1400, 1500], p: [150, 180], f: [50, 60], c: [0, 5] },
    { key: "refeed", name: "Refeed", cal: [2200, 2500], p: [180, 200], f: [50, 70], c: [200, 300] },
  ] as FixtureDayType[],
  /** 0 = Sunday … 6 = Saturday, by day type key. */
  pattern: { 0: "lift", 1: "lift", 2: "off", 3: "lift", 4: "off", 5: "lift", 6: "lift" } as Record<number, string>,
  refeedDayType: "refeed",
  refeedEveryDays: 14,
  floors: { cal: 1400, f: 46 },
  mealSlots: ["Lunch", "Dinner"],
  caps: [{ tag: "cheese", label: "Cheese", unit: "oz", soft: 1, hard: 2 }] as Cap[],
  foods: [
    { key: "lean-steak", name: "Lean steak, cooked", unit: "oz", cal: 50, p: 8.7, f: 1.4, c: 0 },
    { key: "sirloin", name: "Sirloin, cooked", unit: "oz", cal: 60, p: 8.3, f: 3, c: 0 },
    { key: "tenderloin", name: "Tenderloin, cooked", unit: "oz", cal: 40, p: 6.2, f: 1.6, c: 0 },
    { key: "eye-of-round", name: "Eye of round, cooked", unit: "oz", cal: 46, p: 8, f: 1.4, c: 0 },
    { key: "chicken-breast", name: "Chicken breast, cooked", unit: "oz", cal: 46, p: 8.7, f: 1, c: 0 },
    { key: "turkey-breast", name: "Turkey breast (98/2), cooked", unit: "oz", cal: 44, p: 9.8, f: 0.7, c: 0 },
    { key: "ground-beef", name: "Ground beef (96/4), cooked", unit: "oz", cal: 50, p: 8, f: 2, c: 0 },
    { key: "carne-asada", name: "Carne asada (restaurant), cooked", unit: "oz", cal: 66, p: 8.5, f: 3.5, c: 0 },
    { key: "restaurant-steak", name: "Restaurant steak (butter/oil)", unit: "oz", cal: 60, p: 8, f: 3, c: 0 },
    { key: "tuna", name: "Tuna in water, drained", unit: "can", cal: 310, p: 69, f: 4, c: 0 },
    { key: "egg", name: "Whole egg", unit: "egg", cal: 70, p: 6, f: 5, c: 0.5 },
    { key: "egg-white", name: "Egg white", unit: "egg white", cal: 17, p: 3.4, f: 0, c: 0.3 },
    { key: "egg-whites-cup", name: "Egg whites (~8)", unit: "cup", cal: 125, p: 26, f: 0, c: 2 },
    { key: "blue-cheese", name: "Blue cheese", unit: "oz", cal: 100, p: 6, f: 8, c: 0.5, capTag: "cheese" },
    { key: "white-cheddar", name: "Aged white cheddar", unit: "oz", cal: 115, p: 7, f: 9, c: 0, capTag: "cheese" },
    { key: "kerrygold", name: "Kerrygold (21 g piece)", unit: "oz", cal: 85, p: 5, f: 7, c: 0, capTag: "cheese" },
    { key: "nectar", name: "Nectar protein", unit: "scoop", cal: 100, p: 23, f: 0, c: 1 },
    { key: "avocado-mayo", name: "Avocado mayo", unit: "tbsp", cal: 90, p: 0, f: 10, c: 0 },
    { key: "ranch-dip", name: "Protein ranch dip", unit: "2 tbsp", cal: 76, p: 5, f: 6, c: 1 },
    { key: "lmnt", name: "LMNT", unit: "packet", cal: 10, p: 0, f: 0, c: 1 },
    { key: "pizza-v4", name: "Pizza V4", unit: "slice", cal: 307, p: 47, f: 13, c: 1 },
  ] as FixtureFood[],
  meals: [
    { name: "Lean Recovery Dinner", slot: "Dinner", items: [{ food: "tenderloin", qty: 5 }, { food: "egg", qty: 1 }, { food: "egg-whites-cup", qty: 1 }] },
    { name: "Eye of Round Office Lunch", slot: "Lunch", items: [{ food: "eye-of-round", qty: 5 }, { food: "white-cheddar", qty: 1 }, { food: "egg", qty: 2 }] },
    { name: "Steak + Eggs Dinner", slot: "Dinner", items: [{ food: "lean-steak", qty: 7 }, { food: "egg", qty: 2 }, { food: "egg-whites-cup", qty: 1 }] },
    { name: "Office Carne Asada Power Lunch", slot: "Lunch", items: [{ food: "carne-asada", qty: 8 }, { food: "egg", qty: 2 }, { food: "white-cheddar", qty: 1 }] },
    { name: "Pizza V4 3-slice", slot: null, items: [{ food: "pizza-v4", qty: 3 }] },
  ] as FixtureMeal[],
};
