/**
 * Body's units (rev 229): the "per" unit on a food is picked from a list, grouped, with "Other…" for anything else. Within weight
 * or volume a quantity converts; count units and Other never do. Free-text units saved before the list existed are read onto it
 * when they match, and kept as Other when they don't: nothing saved is lost.
 */
export type UnitGroup = "weight" | "volume" | "count";

/** Each unit's size in the group's base: grams for weight, millilitres for volume. Count units have no size. */
export const UNITS: { group: UnitGroup; label: string; units: { unit: string; base?: number }[] }[] = [
  { group: "weight", label: "Weight", units: [{ unit: "oz", base: 28.349523125 }, { unit: "g", base: 1 }, { unit: "lb", base: 453.59237 }, { unit: "kg", base: 1000 }] },
  { group: "volume", label: "Volume", units: [{ unit: "fl oz", base: 29.5735295625 }, { unit: "ml", base: 1 }, { unit: "cup", base: 236.5882365 }, { unit: "tbsp", base: 14.78676478125 }, { unit: "tsp", base: 4.92892159375 }] },
  { group: "count", label: "Count", units: [{ unit: "each" }, { unit: "slice" }, { unit: "piece" }, { unit: "scoop" }, { unit: "serving" }] },
];

const ALIASES: Record<string, string> = {
  oz: "oz", ounce: "oz", ounces: "oz",
  g: "g", gram: "g", grams: "g", gr: "g",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  kg: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  "fl oz": "fl oz", floz: "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  cup: "cup", cups: "cup",
  tbsp: "tbsp", tbs: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  each: "each", ea: "each",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece",
  scoop: "scoop", scoops: "scoop",
  serving: "serving", servings: "serving",
};

const byUnit = new Map(UNITS.flatMap((g) => g.units.map((u) => [u.unit, { group: g.group, base: u.base }] as const)));

/** A saved or typed unit, read onto the list: `{ unit }` when it matches (case and plurals aside), else `{ unit: null, other }`. */
export function readUnit(text: string): { unit: string; other?: undefined } | { unit: null; other: string } {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  const hit = ALIASES[t];
  return hit ? { unit: hit } : { unit: null, other: text.trim() };
}

/** The stored form of a unit: the list's own spelling when it matches, the member's words otherwise. */
export const storedUnit = (text: string): string => readUnit(text).unit ?? text.trim();

export function unitGroup(text: string): UnitGroup | null {
  const u = readUnit(text).unit;
  return u ? byUnit.get(u)!.group : null;
}

/** The units a quantity of this food may be logged in: its own group when it converts (weight, volume), else only its own unit. */
export function loggableUnits(foodUnit: string): string[] {
  const u = readUnit(foodUnit).unit;
  const group = u ? byUnit.get(u)!.group : null;
  if (!u || group === "count" || !group) return [storedUnit(foodUnit)];
  return UNITS.find((g) => g.group === group)!.units.map((x) => x.unit);
}

/**
 * A quantity in `from` expressed in the food's own unit, or null when the two don't convert (different groups, a count unit or
 * Other). Same unit is always itself.
 */
export function convertQty(qty: number, from: string, to: string): number | null {
  const a = readUnit(from).unit ?? from.trim();
  const b = readUnit(to).unit ?? to.trim();
  if (a === b) return qty;
  const fa = byUnit.get(a);
  const fb = byUnit.get(b);
  if (!fa?.base || !fb?.base || fa.group !== fb.group) return null;
  return (qty * fa.base) / fb.base;
}
