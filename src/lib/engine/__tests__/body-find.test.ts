import { describe, expect, it } from "vitest";
import { decodeFound, encodeFound, fmtPer100, foodFromFound, fromOff, fromUsda, perUnit, readBarcode, sectionGuess, titleCase } from "@/lib/engine/body-find";
import { records } from "../../../../scripts/fixtures/foods";

describe("food search and barcode (rev 237 phase 13, B8): the two services' records", () => {
  it("reads a USDA hit by nutrient number, per 100 g, the shouted name in sentence case, the brand beside it", () => {
    const f = fromUsda(records.usda[0])!;
    expect(f).toMatchObject({ source: "usda", ref: "171077", name: "Chicken, broilers or fryers, breast, meat only, raw", brand: null, category: "Poultry Products", per100: { cal: 120, p: 22.5, f: 2.6, c: 0, sodium: 45 } });
    expect(fromUsda(records.usda[2])!.brand).toBe("Demo Foods Co.");
    expect(fromUsda({ fdcId: 1, description: "Thing", foodNutrients: [{ nutrientNumber: "208", unitName: "kJ", value: 418.4 }, { nutrientId: 1008, unitName: "kJ", value: 418.4 }, { nutrientId: 1093, unitName: "g", value: 0.1 }] })!.per100).toEqual({ cal: 100, p: 0, f: 0, c: 0, sodium: 100 });
    expect(fromUsda({ description: "No id" })).toBeNull();
    expect(fromUsda({ fdcId: 2 })).toBeNull();
  });
  it("reads an Open Food Facts product: sodium from grams to mg, the first brand, the last category", () => {
    const f = fromOff(records.off[0], "0012345678905")!;
    expect(f).toEqual({ source: "off", ref: "0012345678905", name: "Greek Yogurt, plain", brand: "Demo Dairy", category: "Yogurts", per100: { cal: 59, p: 10.2, f: 0.4, c: 3.6, sodium: 36 } });
    expect(fromOff({ nutriments: {} }, "1")).toBeNull();
    expect(fromOff({ product_name: "X", nutriments: { energy_100g: 418.4 } }, "123")!.per100.cal).toBe(100);
  });
  it("title-cases only a shouted name", () => {
    expect(titleCase("GRILLED CHICKEN")).toBe("Grilled chicken");
    expect(titleCase("Chicken, roasted")).toBe("Chicken, roasted");
  });
});

describe("what a found food becomes", () => {
  const found = fromUsda(records.usda[0])!;
  it("scales per 100 g to per oz or per g, to a tenth", () => {
    expect(perUnit(found.per100, "g")).toEqual({ cal: 1.2, p: 0.2, f: 0, c: 0, sodium: 0.5 });
    expect(perUnit(found.per100, "oz")).toEqual({ cal: 34, p: 6.4, f: 0.7, c: 0, sodium: 12.8 });
  });
  it("guesses the section and the basis, folds the brand into the name", () => {
    expect(foodFromFound(found, "oz")).toMatchObject({ name: "Chicken, broilers or fryers, breast, meat only, raw", unit: "oz", basis: "raw", section: "meat", capTag: null, cal: 34 });
    expect(foodFromFound(fromUsda(records.usda[2])!, "g")).toMatchObject({ name: "Grilled chicken breast strips (Demo Foods Co.)", basis: "cooked", section: "meat" });
    expect(foodFromFound(fromOff(records.off[0], "0012345678905")!, "g").section).toBe("dairy");
    expect(sectionGuess("Apples, raw, with skin", "Fruits and Fruit Juices")).toBe("produce");
    expect(sectionGuess("Frozen peas", null)).toBe("frozen");
    expect(sectionGuess("Rolled oats", null)).toBe("pantry");
    expect(sectionGuess("Mystery", null)).toBe("other");
  });
  it("survives the form whole, and refuses a tampered or foreign string", () => {
    const back = decodeFound(encodeFound(found));
    expect(back).toEqual(found);
    expect(decodeFound(encodeFound({ ...found, per100: { ...found.per100, cal: -5 } }))!.per100.cal).toBe(0);
    expect(decodeFound("not json")).toBeNull();
    expect(decodeFound(JSON.stringify({ source: "else", ref: "1", name: "x", per100: found.per100 }))).toBeNull();
  });
  it("reads a barcode as digits, 8 to 14 of them", () => {
    expect(readBarcode(" 0012345678905 ")).toBe("0012345678905");
    expect(readBarcode("0012-3456-7890-5")).toBe("0012345678905");
    expect(readBarcode("1234567")).toBeNull();
    expect(readBarcode("chicken")).toBeNull();
  });
  it("prints a results line", () => {
    expect(fmtPer100(found.per100)).toBe("120 cal · 22.5 P · 2.6 F · 0 C · 45 mg sodium per 100 g");
    expect(fmtPer100({ cal: 52, p: 0.3, f: 0.2, c: 13.8, sodium: 0 })).toBe("52 cal · 0.3 P · 0.2 F · 13.8 C per 100 g");
  });
});

describe("the services' client", () => {
  it("without USDA_API_KEY a search says so before any request; the scanner is loaded only on press", async () => {
    const had = process.env.USDA_API_KEY;
    delete process.env.USDA_API_KEY;
    try {
      const { searchFoods, FoodSearchError, foodSearchProblem } = await import("@/lib/food-search");
      await expect(searchFoods("chicken")).rejects.toMatchObject({ problem: "no_key" });
      expect(foodSearchProblem(new FoodSearchError("no_key"))).toMatch(/isn't set up/);
    } finally {
      if (had !== undefined) process.env.USDA_API_KEY = had;
    }
    const { readFileSync } = await import("node:fs");
    const scan = readFileSync("src/components/body/scan-code.tsx", "utf8");
    expect(scan).toMatch(/await import\("@zxing\/browser"\)/);
    expect(scan).not.toMatch(/^import .*@zxing/m);
    const page = readFileSync("src/app/(app)/body/foods/find/page.tsx", "utf8");
    expect(page).not.toMatch(/zxing/);
  });
});
