import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { METRICS, avg7, dayFigure, displayValue, fmtMetric, parseCsvRows, parseScaleCsv, readDate, readHeader, readingKey, storedValue, trendStats, withDerived, type Reading } from "@/lib/engine/body-scale";

const fixture = (n: string) => readFileSync(join(process.cwd(), "scripts/fixtures", n), "utf8");

describe("the RENPHO CSV: both header sets, kg files, bad rows", () => {
  it("the older format: M/D/YY dates, the eight metrics, a bad row listed by line, a duplicate day kept as two readings", () => {
    const p = parseScaleCsv(fixture("renpho-older.csv"));
    expect(p.format).toBe("older");
    expect(p.unit).toBe("lb");
    expect(p.readings).toHaveLength(7);
    expect(p.skipped).toEqual([{ line: 8, why: 'no date in "not a date"' }]);
    expect(p.readings[0]).toEqual({ date: "2026-09-01", time: null, values: { weight: 182.4, bf: 23.1, smm_pct: 43.8, ffm: 140.3, visceral: 10, water: 54.6, bmr: 1762, met_age: 39 } });
    expect(p.readings.filter((x) => x.date === "2026-09-02")).toHaveLength(2);
  });
  it("the newer format: No. and Time columns, YYYY.MM.DD dates, the extra metrics", () => {
    const p = parseScaleCsv(fixture("renpho-newer.csv"));
    expect(p.format).toBe("newer");
    expect(p.readings).toHaveLength(8);
    expect(p.skipped).toEqual([]);
    expect(p.readings[0]).toEqual({ date: "2026-09-10", time: "07:02", values: { weight: 178.8, bf: 21.9, fat_mass: 39.2, ffm: 139.6, muscle_pct: 74.3, smm_mass: 64.0, water: 55.4, visceral: 9, bmr: 1742, met_age: 37, whr: 0.91 } });
    expect(p.columns).toContain("whr");
  });
  it("a kg file is stored in lb, and a time inside the Date cell is read", () => {
    const p = parseScaleCsv(fixture("renpho-kg.csv"));
    expect(p.unit).toBe("kg");
    expect(p.readings[0].time).toBe("07:12");
    expect(p.readings[0].values.weight).toBe(176.4);
    expect(p.readings[0].values.ffm).toBe(135.6);
    expect(p.readings[0].values.bf).toBe(23.1);
  });
  it("not a scale export, or empty: nothing read, the reason given", () => {
    expect(parseScaleCsv("a,b\n1,2").skipped[0].why).toMatch(/no Date and Weight/);
    expect(parseScaleCsv("").skipped[0].why).toMatch(/empty/);
    expect(parseScaleCsv("Date,Weight(lb)\n9/1/26,\n9/2/26,abc").skipped.map((s) => s.why)).toEqual(["no weight", "no weight"]);
  });
  it("headers read case- and space-blind; unknown columns are ignored; masses know their unit", () => {
    expect(readHeader("Body Fat Percentage(%)")).toEqual({ key: "bf" });
    expect(readHeader("body fat(%)")).toEqual({ key: "bf" });
    expect(readHeader("Weight(kg)")).toEqual({ key: "weight", unit: "kg" });
    expect(readHeader("Skeletal Muscle Mass(lb)")).toEqual({ key: "smm_mass", unit: "lb" });
    expect(readHeader("Heart Rate")).toBeNull();
  });
  it("dates in every shape RENPHO writes; times with seconds and AM/PM", () => {
    expect(readDate("9/1/26")).toEqual({ date: "2026-09-01", time: null });
    expect(readDate("12/31/2026")).toEqual({ date: "2026-12-31", time: null });
    expect(readDate("2026.09.10")).toEqual({ date: "2026-09-10", time: null });
    expect(readDate("2026-09-10 7:05:09 PM")).toEqual({ date: "2026-09-10", time: "19:05" });
    expect(readDate("13/1/26")).toBeNull();
    expect(readDate("yesterday")).toBeNull();
  });
  it("the CSV reader: quotes, doubled quotes, CR LF and a BOM", () => {
    expect(parseCsvRows('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
  it("a reading's identity for re-imports: date and time, or date and weight without a time", () => {
    expect(readingKey({ date: "2026-09-10", time: "07:02", values: { weight: 178.8 } })).toBe("2026-09-10|07:02");
    expect(readingKey({ date: "2026-09-10", time: null, values: { weight: 178.8 } })).toBe("2026-09-10|w178.8");
  });
});

describe("the day's figure and derived numbers (rev 251)", () => {
  const rd = (date: string, time: string | null, weight: number, bf: number): Reading => ({ date, time, values: { weight, bf } });
  it("the lowest weight of the day, whole: its body fat comes with it", () => {
    const f = dayFigure([rd("d", "07:00", 181.6, 22.9), rd("d", "21:30", 183.0, 23.3)]);
    expect(f).toEqual(rd("d", "07:00", 181.6, 22.9));
    // Equal weights: the earliest.
    expect(dayFigure([rd("d", "21:00", 180, 22.5), rd("d", "07:00", 180, 22.1)])!.time).toBe("07:00");
    // No weight anywhere: the latest reading.
    expect(dayFigure([{ date: "d", time: "07:00", values: { bf: 22 } }, { date: "d", time: "08:00", values: { bf: 21 } }])!.values.bf).toBe(21);
    expect(dayFigure([])).toBeNull();
  });
  it("fat-free mass and fat mass are derived when missing, never overwritten", () => {
    expect(withDerived({ weight: 180, bf: 25 })).toEqual({ weight: 180, bf: 25, ffm: 135, fat_mass: 45 });
    expect(withDerived({ weight: 180, bf: 25, ffm: 134.2 }).ffm).toBe(134.2);
    expect(withDerived({ weight: 180 })).toEqual({ weight: 180 });
  });
  it("masses convert for display and storage; the words per unit", () => {
    expect(displayValue("weight", 176.4, "kg")).toBe(80);
    expect(storedValue("weight", 80, "kg")).toBe(176.4);
    expect(storedValue("bf", 23.14, "kg")).toBe(23.1);
    expect(fmtMetric("weight", 146.8, "lb")).toBe("146.8 lb");
    expect(fmtMetric("bf", 17.9, "lb")).toBe("17.9%");
    expect(fmtMetric("bmr", 1620, "lb")).toBe("1,620 kcal");
    expect(fmtMetric("met_age", 34, "lb")).toBe("34 y");
    expect(fmtMetric("whr", 0.9, "lb")).toBe("0.90");
    expect(METRICS.filter((m) => m.primary)).toHaveLength(8);
  });
  it("the 7-day average and the card's numbers", () => {
    const pts = [1, 2, 3, 5, 8, 9, 10, 12, 14].map((n) => ({ date: `2026-09-${String(n).padStart(2, "0")}`, value: 190 - n }));
    expect(avg7(pts, "2026-09-14", addDays)).toBe((182 + 181 + 180 + 178 + 176) / 5);
    expect(avg7(pts, "2026-08-20", addDays)).toBeNull();
    const t = trendStats(pts, "2026-09-14", addDays);
    expect(t.latest).toEqual({ date: "2026-09-14", value: 176 });
    expect(t.change7).toBeCloseTo(179.4 - (189 + 188 + 187 + 185) / 4, 6);
    expect(t.changeAll).toBe(176 - 189);
    expect(trendStats([], "2026-09-14", addDays)).toEqual({ latest: null, avg7: null, change7: null, changeAll: null });
  });
});
