import { describe, expect, it } from "vitest";
import { parseAmount, parseNumber } from "@/lib/engine/amount";
import { amountIn } from "@/lib/engine/body-units";

describe("parseAmount (rev 444)", () => {
  it("reads amounts the way people write them", () => {
    expect(parseAmount("3.5k")).toEqual({ value: 3500, unit: null });
    expect(parseAmount("1.2m")).toEqual({ value: 1200000, unit: null });
    expect(parseAmount("$3,500")).toEqual({ value: 3500, unit: null });
    expect(parseAmount("3,500.00")).toEqual({ value: 3500, unit: null });
    expect(parseAmount("A$1,250")).toEqual({ value: 1250, unit: null });
    expect(parseAmount("2 million")).toEqual({ value: 2000000, unit: null });
    expect(parseAmount("3 500")).toEqual({ value: 3500, unit: null });
    expect(parseAmount(".5")).toEqual({ value: 0.5, unit: null });
    expect(parseAmount("-2")).toEqual({ value: -2, unit: null });
  });
  it("keeps the unit for the caller", () => {
    expect(parseAmount("70 kg")).toEqual({ value: 70, unit: "kg" });
    expect(parseAmount("154lb")).toEqual({ value: 154, unit: "lb" });
    expect(parseAmount("500 ml")).toEqual({ value: 500, unit: "ml" });
    expect(parseAmount("8 fl oz")).toEqual({ value: 8, unit: "fl oz" });
    expect(parseAmount("21%")).toEqual({ value: 21, unit: "%" });
    expect(parseAmount("1.2k kcal")).toEqual({ value: 1200, unit: "kcal" });
    expect(parseAmount("5 mi")).toEqual({ value: 5, unit: "mi" });
  });
  it("reads a decimal comma", () => {
    expect(parseAmount("2,5 kg")).toEqual({ value: 2.5, unit: "kg" });
    expect(parseAmount("70,25")).toEqual({ value: 70.25, unit: null });
    expect(parseAmount("1,000")).toEqual({ value: 1000, unit: null });
  });
  it("blank is not zero, and nothing is guessed", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("abc")).toHaveProperty("error");
    expect(parseAmount("1.2.3")).toHaveProperty("error");
    expect(parseAmount("1 2")).toHaveProperty("error");
    expect(parseAmount("kg")).toHaveProperty("error");
  });
  it("a plain-number box refuses a unit", () => {
    expect(parseNumber("$3,500")).toBe(3500);
    expect(parseNumber("3.5k")).toBe(3500);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("70 kg")).toHaveProperty("error");
  });
});

describe("amountIn: a typed amount for a box in a unit (rev 444)", () => {
  it("converts a weight or volume typed in another unit", () => {
    expect(amountIn("154 lb", "kg")).toBe(69.85);
    expect(amountIn("70 kg", "lb")).toBe(154.32);
    expect(amountIn("8 oz", "g")).toBe(226.8);
    expect(amountIn("500 ml", "fl oz")).toBe(16.91);
    expect(amountIn("70", "kg")).toBe(70);
    expect(amountIn("2,5 kg", "kg")).toBe(2.5);
  });
  it("refuses a unit that doesn't convert, or one where none belongs", () => {
    expect(amountIn("500 ml", "kg")).toHaveProperty("error");
    expect(amountIn("70 kg", null)).toHaveProperty("error");
    expect(amountIn("abc", "kg")).toHaveProperty("error");
    expect(amountIn("2 slices", "g")).toHaveProperty("error");
  });
  it("reads past words that aren't a measure", () => {
    expect(amountIn("30 tablets")).toBe(30);
    expect(amountIn("12 reps")).toBe(12);
    expect(amountIn("21%")).toBe(21);
    expect(amountIn("2 slices", "slice")).toBe(2);
    expect(amountIn("2 slices")).toBe(2);
    expect(amountIn("2.2k")).toBe(2200);
    expect(amountIn("")).toBeNull();
  });
});
