/**
 * Food search and barcode lookup (rev 237 phase 13, B8): what a USDA FoodData Central result or an Open Food Facts product
 * becomes in HelixOS. Everything here is pure: the two services' records in, a found food per 100 g out, and from that the
 * member's own food per their unit (oz or g), with a guessed store section and raw/cooked basis they can change afterwards.
 * Nothing is saved by this module; the page saves one found food when the member presses Save.
 */
import type { FoodSection } from "@/db/schema";

export type Per100 = { cal: number; p: number; f: number; c: number; sodium: number };
export type FoundFood = { source: "usda" | "off"; ref: string; name: string; brand: string | null; category: string | null; per100: Per100 };

const r1 = (n: number) => Math.round(n * 10) / 10;
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const numOr0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);

/** USDA's nutrient numbers: energy in kcal, protein, total fat, carbohydrate by difference, sodium (mg); all per 100 g. */
const USDA_NUTRIENT: Record<number, keyof Per100> = { 1008: "cal", 1003: "p", 1004: "f", 1005: "c", 1093: "sodium" };
export type UsdaFood = { fdcId?: number | string; description?: string; dataType?: string; brandOwner?: string; brandName?: string; foodCategory?: string; foodNutrients?: { nutrientId?: number; nutrientNumber?: string; nutrientName?: string; unitName?: string; value?: number }[] };

/** A search hit from FoodData Central; null without an id or a name. Energy in kJ is converted; a missing nutrient is 0. */
export function fromUsda(food: UsdaFood): FoundFood | null {
  const name = clean(food.description);
  if (!food.fdcId || !name) return null;
  const per100: Per100 = { cal: 0, p: 0, f: 0, c: 0, sodium: 0 };
  for (const n of food.foodNutrients ?? []) {
    const id = n.nutrientId ?? (n.nutrientNumber ? Number(n.nutrientNumber) : NaN);
    const key = USDA_NUTRIENT[id];
    if (!key) continue;
    let v = numOr0(n.value);
    if (key === "cal" && /kj/i.test(n.unitName ?? "")) v = v / 4.184;
    if (key === "sodium" && /^g$/i.test(n.unitName ?? "")) v = v * 1000;
    per100[key] = r1(v);
  }
  const brand = clean(food.brandOwner || food.brandName) || null;
  return { source: "usda", ref: String(food.fdcId), name: titleCase(name), brand, category: clean(food.foodCategory) || null, per100 };
}

export type OffProduct = { code?: string; product_name?: string; product_name_en?: string; brands?: string; categories?: string; nutriments?: Record<string, unknown> };

/** An Open Food Facts product; null without a name. Its sodium is in grams per 100 g, so it becomes mg. */
export function fromOff(product: OffProduct, code: string): FoundFood | null {
  const name = clean(product.product_name || product.product_name_en);
  if (!name) return null;
  const n = product.nutriments ?? {};
  const kcal = numOr0(n["energy-kcal_100g"]) || numOr0(n["energy_100g"]) / 4.184;
  const per100: Per100 = { cal: r1(kcal), p: r1(numOr0(n["proteins_100g"])), f: r1(numOr0(n["fat_100g"])), c: r1(numOr0(n["carbohydrates_100g"])), sodium: r1(numOr0(n["sodium_100g"]) * 1000) };
  const category = clean(product.categories).split(",").map((s) => s.trim()).filter(Boolean).pop() ?? null;
  return { source: "off", ref: clean(product.code) || code, name, brand: clean(product.brands).split(",")[0]?.trim() || null, category, per100 };
}

/** "CHICKEN, BROILERS OR FRYERS, BREAST, MEAT ONLY, RAW" → "Chicken, broilers or fryers, breast, meat only, raw". Mixed case stays. */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The store section a found food most likely sits in, from its words and its category; "other" when nothing fits. */
export function sectionGuess(name: string, category: string | null): FoodSection {
  const t = `${name} ${category ?? ""}`.toLowerCase();
  if (/frozen|ice cream/.test(t)) return "frozen";
  if (/beef|chicken|turkey|pork|lamb|fish|salmon|tuna|shrimp|steak|sausage|bacon|meat|poultry|seafood|egg/.test(t)) return "meat";
  if (/milk|cheese|yogurt|yoghurt|butter|cream|dairy|kefir/.test(t)) return "dairy";
  if (/apple|banana|berry|berries|orange|grape|lettuce|spinach|kale|broccoli|carrot|onion|pepper|tomato|potato|avocado|fruit|vegetable|produce|salad|herb/.test(t)) return "produce";
  if (/rice|oat|bread|pasta|flour|cereal|bean|lentil|nut|seed|oil|sauce|spice|snack|bar|canned|soup|sugar|coffee|tea|pantry|grain/.test(t)) return "pantry";
  return "other";
}

/** USDA's raw foods say so in the name ("…, raw"); everything else is taken as eaten. */
export const rawGuess = (name: string): "raw" | "cooked" => (/\braw\b/i.test(name) ? "raw" : "cooked");

const GRAMS: Record<"oz" | "g", number> = { oz: 28.349523125, g: 1 };

/** The found food's figures per one of the member's unit, from its per-100 g figures. */
export function perUnit(per100: Per100, unit: "oz" | "g"): Per100 {
  const k = GRAMS[unit] / 100;
  return { cal: r1(per100.cal * k), p: r1(per100.p * k), f: r1(per100.f * k), c: r1(per100.c * k), sodium: r1(per100.sodium * k) };
}

/** The member's own food from a found one: per their unit, basis and section guessed, the brand folded into the name. */
export function foodFromFound(found: FoundFood, unit: "oz" | "g"): { name: string; unit: "oz" | "g"; basis: "raw" | "cooked"; section: FoodSection; capTag: null } & Per100 {
  const name = (found.brand && !found.name.toLowerCase().includes(found.brand.toLowerCase()) ? `${found.name} (${found.brand})` : found.name).slice(0, 80);
  return { name, unit, basis: rawGuess(found.name), section: sectionGuess(found.name, found.category), capTag: null, ...perUnit(found.per100, unit) };
}

/** A found food carried through a form as one string, and read back whole: the per-100 figures are checked, never trusted. */
export const encodeFound = (f: FoundFood): string => JSON.stringify(f);
export function decodeFound(s: string): FoundFood | null {
  try {
    const x = JSON.parse(s) as Partial<FoundFood>;
    if ((x.source !== "usda" && x.source !== "off") || !x.ref || !x.name || !x.per100) return null;
    const per100 = { cal: numOr0(x.per100.cal), p: numOr0(x.per100.p), f: numOr0(x.per100.f), c: numOr0(x.per100.c), sodium: numOr0(x.per100.sodium) };
    return { source: x.source, ref: clean(x.ref).slice(0, 40), name: clean(x.name).slice(0, 120), brand: clean(x.brand) || null, category: clean(x.category) || null, per100 };
  } catch {
    return null;
  }
}

/** A barcode as typed or scanned: digits only, 8 to 14 of them; null otherwise. */
export function readBarcode(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

/** "120 cal · 22 P · 3 F · 0 C per 100 g" for a results list. */
export const fmtPer100 = (p: Per100): string => `${Math.round(p.cal)} cal · ${r1(p.p)} P · ${r1(p.f)} F · ${r1(p.c)} C${p.sodium ? ` · ${Math.round(p.sodium)} mg sodium` : ""} per 100 g`;
