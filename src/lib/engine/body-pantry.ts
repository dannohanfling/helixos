/**
 * Pantry (rev 237 phase 5, rev 231's "Pantry and shopping", rev 251's cooked-weight rules). Pure: what's on hand, what to use
 * soon, what's below par, how a cooked yield is known, how a weighed quantity converts to the food's nutrition basis, and how a
 * logged quantity comes off the shelf.
 */
import { convertQty } from "@/lib/engine/body-units";

export type PantryState = "raw" | "cooked";
export type PantryLocation = "fridge" | "freezer" | "pantry";
export const PANTRY_LOCATIONS: PantryLocation[] = ["fridge", "freezer", "pantry"];

export type PantryItemLike = { id: string; foodId: string; qty: number; unit: string; state: PantryState; useBy: string | null; boughtOn: string | null };
export type FoodLike = { id: string; name: string; unit: string; basis: PantryState; par: number | null; cookedYield: number | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ───────── Cooked yield ───────── */

export type YieldSource = "entered" | "weighings" | "none";

/**
 * The cooked yield of a food (cooked weight ÷ raw weight): the member's entered figure first, else the median of their own
 * raw → cooked weighings, else none (rev 251). A yield outside 0.1–1.5 is a typo, never a factor.
 */
export function yieldFor(food: { cookedYield: number | null }, weighings: { raw: number; cooked: number }[]): { factor: number | null; source: YieldSource } {
  if (food.cookedYield != null && food.cookedYield >= 0.1 && food.cookedYield <= 1.5) return { factor: food.cookedYield, source: "entered" };
  const ratios = weighings.filter((w) => w.raw > 0 && w.cooked > 0).map((w) => w.cooked / w.raw).filter((x) => x >= 0.1 && x <= 1.5).sort((a, b) => a - b);
  if (!ratios.length) return { factor: null, source: "none" };
  const mid = Math.floor(ratios.length / 2);
  return { factor: r2(ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2), source: "weighings" };
}

/**
 * A weighed quantity as the food's nutrition basis: weighed as the basis, it's the quantity; across (raw → cooked or back), it
 * converts by the yield; with no yield, it stays as typed and is flagged "check", never dropped and never silently wrong.
 */
export function toBasis(qty: number, weighed: PantryState, basis: PantryState, factor: number | null): { qty: number; converted: boolean; check: boolean } {
  if (weighed === basis) return { qty, converted: false, check: false };
  if (factor == null) return { qty, converted: false, check: true };
  return { qty: r2(weighed === "raw" ? qty * factor : qty / factor), converted: true, check: false };
}

/* ───────── On hand, use soon, below par ───────── */

/** An item's quantity in the food's own unit, or null when the units don't convert (a "bag" of a food counted per oz). */
export function inFoodUnit(item: { qty: number; unit: string }, food: { unit: string }): number | null {
  return item.unit === food.unit ? item.qty : convertQty(item.qty, item.unit, food.unit);
}

/** Days until an item's use-by: negative when past, null without a date. */
export function daysLeft(item: { useBy: string | null }, today: string, daysBetween: (a: string, b: string) => number): number | null {
  return item.useBy ? daysBetween(today, item.useBy) : null;
}

/** Items to use soon: use-by within `days` (two, per rev 231) or already past, soonest first. */
export function dueSoon<T extends { useBy: string | null }>(items: T[], today: string, daysBetween: (a: string, b: string) => number, days = 2): (T & { days: number })[] {
  return items
    .flatMap((it) => {
      const d = daysLeft(it, today, daysBetween);
      return d != null && d <= days ? [{ ...it, days: d }] : [];
    })
    .sort((a, b) => a.days - b.days);
}

export type ParGap = { foodId: string; name: string; unit: string; par: number; onHand: number; short: number };

/** Foods with a par level whose shelf holds less: what to buy, in the food's unit. Items that don't convert count as nothing. */
export function belowPar(foods: FoodLike[], items: PantryItemLike[]): ParGap[] {
  return foods.flatMap((f) => {
    if (f.par == null || f.par <= 0) return [];
    const onHand = r2(items.filter((it) => it.foodId === f.id).reduce((a, it) => a + (inFoodUnit(it, f) ?? 0), 0));
    return onHand < f.par ? [{ foodId: f.id, name: f.name, unit: f.unit, par: f.par, onHand, short: r2(f.par - onHand) }] : [];
  });
}

/* ───────── Coming off the shelf ───────── */

/**
 * A logged quantity (in the food's unit, as the food's basis) comes off the shelf soonest-use-by first (undated last, then
 * oldest bought). A raw item feeding a cooked-basis food shrinks by the yield, so 3.5 oz cooked takes about 5.7 oz raw at
 * 61%; with no yield, one for one. Items that don't convert are left alone. Returns each touched item's new quantity, with
 * zero meaning gone.
 */
export function takeFromPantry(items: PantryItemLike[], food: { unit: string; basis: PantryState }, qty: number, factor: number | null): { id: string; qty: number }[] {
  const order = [...items].sort((a, b) => (a.useBy ?? "9999").localeCompare(b.useBy ?? "9999") || (a.boughtOn ?? "9999").localeCompare(b.boughtOn ?? "9999"));
  let left = qty;
  const out: { id: string; qty: number }[] = [];
  for (const it of order) {
    if (left <= 0) break;
    const have = inFoodUnit(it, food);
    if (have == null || have <= 0) continue;
    // What one unit on the shelf is worth in the food's basis.
    const worth = it.state === food.basis || factor == null ? 1 : it.state === "raw" ? factor : 1 / factor;
    const haveInBasis = have * worth;
    const take = Math.min(haveInBasis, left);
    left = r2(left - take);
    const remainInBasis = haveInBasis - take;
    const remainInFoodUnit = remainInBasis / worth;
    const remain = it.unit === food.unit ? remainInFoodUnit : (convertQty(remainInFoodUnit, food.unit, it.unit) ?? 0);
    out.push({ id: it.id, qty: remain < 0.005 ? 0 : r2(remain) });
  }
  return out;
}
