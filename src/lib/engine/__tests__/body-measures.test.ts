import { describe, expect, it } from "vitest";
import { fmtDistanceIn, habitShown, measuresFromZone, measuresOf, shownValue, storedFromShown, unitsFor, weightUnitWord } from "@/lib/engine/body-measures";

describe("Metric or US (Danno, rev 424)", () => {
  it("defaults from the time zone: the US zones, Liberia and Myanmar weigh in pounds; Toronto, Mexico City, London and Sydney don't", () => {
    for (const tz of ["America/Los_Angeles", "America/New_York", "America/Indiana/Indianapolis", "America/Kentucky/Louisville", "Pacific/Honolulu", "America/Anchorage", "Africa/Monrovia", "Asia/Yangon"]) expect(measuresFromZone(tz), tz).toBe("us");
    for (const tz of ["America/Toronto", "America/Mexico_City", "America/Sao_Paulo", "Europe/London", "Australia/Sydney", "Asia/Tokyo"]) expect(measuresFromZone(tz), tz).toBe("metric");
    expect(measuresFromZone(null)).toBe("metric");
  });
  it("a chosen setting wins; an earlier kg or g reads as metric; otherwise the zone; the two older units follow", () => {
    expect(measuresOf({ measures: "us", weightUnit: "kg", foodUnit: "g" }, "Europe/London")).toBe("us");
    expect(measuresOf({ measures: null, weightUnit: "kg", foodUnit: "oz" }, "America/Chicago")).toBe("metric");
    expect(measuresOf({ measures: null, weightUnit: "lb", foodUnit: "oz" }, "Europe/London")).toBe("metric");
    expect(measuresOf({ measures: null, weightUnit: "lb", foodUnit: "oz" }, "America/Chicago")).toBe("us");
    expect(unitsFor("metric")).toEqual({ weightUnit: "kg", foodUnit: "g" });
    expect(unitsFor("us")).toEqual({ weightUnit: "lb", foodUnit: "oz" });
  });
  it("an amount habit shows in the member's system and is stored in its own unit: Water 130 oz is 3.8 L, and 500 ml typed stores as 16.91 oz", () => {
    const water = habitShown("oz", 130, "metric");
    expect(water.unit).toBe("L");
    expect(shownValue(130, water)).toBe(3.8);
    const small = habitShown("oz", 16, "metric");
    expect([small.unit, shownValue(16, small)]).toEqual(["ml", 473]);
    expect(storedFromShown(500, small)).toBe(16.91);
    expect(habitShown("oz", 130, "us")).toEqual({ unit: "oz", factor: 1, decimals: 1 });
    const ml = habitShown("ml", 2000, "us");
    expect([ml.unit, shownValue(2000, ml)]).toEqual(["fl oz", 67.6]);
    expect(habitShown("steps", 10000, "metric")).toEqual({ unit: "steps", factor: 1, decimals: 1 });
    expect(habitShown("g", 5, "us")).toEqual({ unit: "g", factor: 1, decimals: 1 });
    const kg = habitShown("kg", 2, "us");
    expect([kg.unit, shownValue(2, kg)]).toEqual(["lb", 4.4]);
    const lb = habitShown("lb", 1, "metric");
    expect([lb.unit, shownValue(1, lb)]).toEqual(["g", 454]);
    // A round trip never drifts more than the rounding.
    expect(Math.abs(storedFromShown(shownValue(130, water), water) - 130)).toBeLessThan(2);
  });
  it("distance in km or mi, and the weight words a tool accepts", () => {
    expect(fmtDistanceIn(4200, "metric")).toBe("4.2 km");
    expect(fmtDistanceIn(4200, "us")).toBe("2.6 mi");
    expect(fmtDistanceIn(20, "us")).toBe("");
    expect([weightUnitWord("KG"), weightUnitWord("pounds"), weightUnitWord("stone"), weightUnitWord(undefined)]).toEqual(["kg", "lb", null, null]);
  });
});
