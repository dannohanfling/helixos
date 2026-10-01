import { describe, expect, it } from "vitest";
import { addDays, startOfWeek } from "@/lib/dates";
import { EARLY_PAIRS, MIN_PAIRS, PRESETS, R_THRESHOLD, foldWeekly, pairUp, pearson, verdict, type Pair, type Point } from "@/lib/engine/body-correlate";

const day = (i: number) => addDays("2026-08-03", i); // a Monday
const series = (n: number, f: (i: number) => number): Point[] => Array.from({ length: n }, (_, i) => ({ date: day(i), value: f(i) }));
const dates = { addDays, startOfWeek };

describe("the correlation explorer (B10, rev 231)", () => {
  it("Pearson's r: a perfect line, its mirror, no link, and nothing when a side doesn't vary", () => {
    const line = [1, 2, 3, 4, 5].map((x) => ({ x, y: 2 * x + 1 }));
    expect(pearson(line)).toBe(1);
    expect(pearson(line.map((p) => ({ x: p.x, y: -p.y })))).toBe(-1);
    expect(pearson([{ x: 1, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 1 }])).toBe(-0.45);
    expect(pearson([{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }])).toBeNull();
    expect(pearson([{ x: 1, y: 1 }])).toBeNull();
  });
  it("pairing: B on a date with A a lag earlier; days left out; weekly folds sums and means by week after the lag", () => {
    const a = series(5, (i) => i); // 0..4 on Mon..Fri
    const b = series(5, (i) => 10 + i);
    const daily = pairUp(a, b, { lag: 1, grain: "daily", foldA: "mean", foldB: "sum", ...dates });
    // B on Tue pairs with A on Mon, and so on: four pairs.
    expect(daily.map((p) => [p.date, p.x, p.y])).toEqual([[day(1), 0, 11], [day(2), 1, 12], [day(3), 2, 13], [day(4), 3, 14]]);
    expect(pairUp(a, b, { lag: 0, grain: "daily", foldA: "mean", foldB: "sum", exclude: new Set([day(2)]), ...dates })).toHaveLength(4);
    const twoWeeks = series(14, (i) => (i < 7 ? 1 : 2));
    const sums = series(14, (i) => i);
    const weekly = pairUp(twoWeeks, sums, { lag: 0, grain: "weekly", foldA: "mean", foldB: "sum", ...dates });
    expect(weekly).toEqual([{ date: "2026-08-03", x: 1, y: 21 }, { date: "2026-08-10", x: 2, y: 70 }]);
    expect(foldWeekly(series(3, () => 4), "mean", startOfWeek)).toEqual([{ date: "2026-08-03", value: 4 }]);
  });
  it("the readout: under 21 pairs no r; 21 to 41 an early signal; named only above the threshold and in both halves; worded as moving together, never caused", () => {
    const pairs = (n: number, f: (i: number) => number): Pair[] => Array.from({ length: n }, (_, i) => ({ date: day(i), x: i, y: f(i) }));
    const few = verdict(pairs(MIN_PAIRS - 1, (i) => i), "Sleep", "Calls", "days");
    expect(few.kind).toBe("none");
    expect(few.r).toBeNull();
    expect(few.words).toMatch(/Not enough data yet: 20 paired days/);
    const early = verdict(pairs(30, (i) => i + (i % 2)), "Sleep", "Calls", "days");
    expect(early.kind).toBe("steady");
    expect(early.early).toBe(true);
    expect(early.words).toMatch(/moved together across this range, in both halves of it \(r 1(\.00)?, 30 paired days, early signal\)/);
    const settled = verdict(pairs(EARLY_PAIRS + 1, (i) => -i), "Sleep", "Calls", "days");
    expect(settled.kind).toBe("steady");
    expect(settled.early).toBe(false);
    expect(settled.words).toMatch(/moved apart/);
    expect(settled.words).not.toMatch(/caus/i);
    // Up in the first half, down in the second: a whole-range r may still clear the line, but the halves disagree.
    const flip = verdict(pairs(40, (i) => (i < 20 ? i : 60 - i)), "A", "B", "days");
    expect(flip.kind).toBe("unsteady");
    expect(flip.words).toMatch(/No steady pattern/);
    // Noise: r below the threshold.
    const noise = verdict(pairs(40, (i) => [3, 1, 4, 1, 5, 9, 2, 6][i % 8]), "A", "B", "days");
    expect(noise.kind).toBe("unsteady");
    expect(Math.abs(noise.r!)).toBeLessThan(R_THRESHOLD);
    expect(noise.words).toMatch(/the link is small/);
    const flat = verdict(pairs(25, () => 7), "A", "B", "weeks");
    expect(flat.kind).toBe("flat");
  });
  it("the seven presets of rev 231, with their lags and grains", () => {
    expect(PRESETS).toHaveLength(7);
    expect(PRESETS[0]).toEqual({ a: "sleep_h", b: "callsBooked", lag: 1, grain: "daily", label: "Sleep hours → calls booked the next day" });
    expect(PRESETS.filter((p) => p.grain === "weekly").map((p) => p.a)).toEqual(["session", "offPlan"]);
  });
});
