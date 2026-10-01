/**
 * The shopping list (rev 231; rev 237 phase 10): the week's plan (saved meals × times) minus what's on the shelf, plus staples
 * below par, grouped by store section, each line in the food's unit. And the lines as Instacart's shopping-list page takes them.
 * Pure; the page and the tool read the same list.
 */
import type { FoodSection } from "@/db/schema";
import { inFoodUnit, type FoodLike, type PantryItemLike } from "@/lib/engine/body-pantry";

export const SECTION_LABEL: Record<FoodSection, string> = { produce: "Produce", meat: "Meat and fish", dairy: "Dairy and eggs", pantry: "Pantry", frozen: "Frozen", other: "Other" };
export const SECTION_ORDER: FoodSection[] = ["produce", "meat", "dairy", "pantry", "frozen", "other"];

export type ShopFood = FoodLike & { section: FoodSection | null };
export type PlanLine = { times: number; lines: { foodId: string; qty: number }[] };
export type ShopLine = { foodId: string; name: string; unit: string; section: FoodSection; needed: number; onHand: number; par: number | null; toBuy: number; why: "plan" | "par" | "both" };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Each food the week needs or the shelf is short of, with how much to buy, grouped by section in store order. */
export function shoppingList(foods: ShopFood[], plan: PlanLine[], items: PantryItemLike[], skip: Set<string> = new Set()): { sections: { section: FoodSection; label: string; lines: ShopLine[] }[]; lines: ShopLine[] } {
  const needed = new Map<string, number>();
  for (const p of plan) for (const l of p.lines) needed.set(l.foodId, (needed.get(l.foodId) ?? 0) + l.qty * Math.max(0, p.times));
  const lines: ShopLine[] = [];
  for (const f of foods) {
    const need = r2(needed.get(f.id) ?? 0);
    const onHand = r2(items.filter((it) => it.foodId === f.id).reduce((a, it) => a + (inFoodUnit(it, f) ?? 0), 0));
    const fromPlan = Math.max(0, need - onHand);
    const fromPar = f.par != null && f.par > 0 ? Math.max(0, f.par - onHand) : 0;
    const toBuy = r2(Math.max(fromPlan, fromPar));
    if (toBuy <= 0 || skip.has(f.id)) continue;
    lines.push({ foodId: f.id, name: f.name, unit: f.unit, section: f.section ?? "other", needed: need, onHand, par: f.par, toBuy, why: fromPlan > 0 && fromPar > 0 ? "both" : fromPlan > 0 ? "plan" : "par" });
  }
  lines.sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || a.name.localeCompare(b.name));
  const sections = SECTION_ORDER.map((section) => ({ section, label: SECTION_LABEL[section], lines: lines.filter((l) => l.section === section) })).filter((s) => s.lines.length);
  return { sections, lines };
}

/** Instacart's measurement units, from the food's; anything it doesn't know is "each". From memory of the docs (1 Oct): checked on the first real push. */
const UNIT_MAP: Record<string, string> = { oz: "oz", g: "g", lb: "lb", kg: "kg", cup: "cup", tbsp: "tablespoon", tsp: "teaspoon", "fl oz": "fl oz", ml: "ml", l: "liter", each: "each", slice: "each", scoop: "each", egg: "each" };
export type InstacartLine = { name: string; quantity: number; unit: string };
export function instacartLines(lines: ShopLine[]): InstacartLine[] {
  return lines.map((l) => {
    const unit = UNIT_MAP[l.unit.toLowerCase().trim()] ?? "each";
    // Whole units for things counted by the piece; a tenth otherwise, never zero.
    const quantity = unit === "each" ? Math.max(1, Math.ceil(l.toBuy)) : Math.max(0.1, Math.round(l.toBuy * 10) / 10);
    return { name: l.name.slice(0, 80), quantity, unit };
  });
}

/** "6 lines, 3 sections" for the summary. */
export const listSummary = (list: ReturnType<typeof shoppingList>): string => (list.lines.length ? `${list.lines.length} line${list.lines.length === 1 ? "" : "s"} in ${list.sections.length} section${list.sections.length === 1 ? "" : "s"}` : "nothing to buy");
