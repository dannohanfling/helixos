import { describe, expect, it } from "vitest";
import { cappedDpr, CLOSE_HREF, flameLabel, flameStateOf, flameTier, flameUniforms, nextTierLine, sheetAction, surgeDue, surgeEnvelope, SURGE_SECONDS, tierName } from "@/lib/engine/streak-flame";

const base = { running: 12, asOf: "2026-10-17", today: "2026-10-17", hour: 10, active: new Set(["2026-10-16", "2026-10-17"]), closed: new Set(["2026-10-16"]), seenOn: "2026-10-17" };

describe("streak flame (H-558)", () => {
  it("tiers at the edges: Ember 1 to 6, Torch 7 to 29, Gold flame 30 and up", () => {
    expect([1, 6, 7, 29, 30, 120].map(flameTier)).toEqual(["ember", "ember", "torch", "torch", "gold", "gold"]);
    expect(tierName("gold")).toBe("Gold flame");
  });

  it("names the days to the next tier", () => {
    expect(nextTierLine(1)).toBe("6 days to Torch");
    expect(nextTierLine(6)).toBe("1 day to Torch");
    expect(nextTierLine(29)).toBe("1 day to Gold flame");
    expect(nextTierLine(30)).toBe("Top tier");
  });

  it("the pill's accessible name", () => {
    expect(flameLabel(12)).toBe("12-day streak. Open streak details");
  });

  it("today closed: the normal tier, not waiting", () => {
    const s = flameStateOf({ ...base, hour: 20, closed: new Set(["2026-10-16", "2026-10-17"]) });
    expect(s).toMatchObject({ days: 12, tier: "torch", waiting: false });
  });

  it("not closed yet: waiting from 4 pm in the member's zone, not before", () => {
    expect(flameStateOf({ ...base, hour: 15 }).waiting).toBe(false);
    expect(flameStateOf({ ...base, hour: 16 }).waiting).toBe(true);
    expect(flameStateOf({ ...base, hour: 23 }).waiting).toBe(true);
  });

  it("inside the late close-out window, yesterday not closed is waiting", () => {
    expect(flameStateOf({ ...base, hour: 1, asOf: "2026-10-16", closed: new Set() }).waiting).toBe(true);
    expect(flameStateOf({ ...base, hour: 1, asOf: "2026-10-16", closed: new Set(["2026-10-16"]) }).waiting).toBe(false);
  });

  it("the sheet's button goes to the close while the day waits, named for the day (H-927)", () => {
    const evening = flameStateOf({ ...base, hour: 20 });
    expect(evening).toMatchObject({ waiting: true, late: false });
    expect(sheetAction(evening)).toEqual({ label: "Close the day", href: "/today#close" });
    const lateNight = flameStateOf({ ...base, hour: 1, asOf: "2026-10-16", closed: new Set() });
    expect(lateNight).toMatchObject({ waiting: true, late: true });
    expect(sheetAction(lateNight)).toEqual({ label: "Close yesterday", href: CLOSE_HREF });
    // Nothing waiting: no button to the close, and yesterday closed isn't late.
    expect(sheetAction(flameStateOf({ ...base, hour: 10 }))).toBeNull();
    expect(flameStateOf({ ...base, hour: 1, asOf: "2026-10-16", closed: new Set(["2026-10-16"]) })).toMatchObject({ waiting: false, late: false });
  });

  it("after a missed day: a fresh Ember at Day 1", () => {
    expect(flameStateOf({ ...base, running: 0 })).toMatchObject({ days: 1, tier: "ember" });
    expect(flameStateOf({ ...base, running: 1 })).toMatchObject({ days: 1, tier: "ember" });
  });

  it("the surge is due once per streak day, only once the day has counted", () => {
    expect(surgeDue({ ...base, seenOn: "2026-10-16" })).toBe(true);
    expect(surgeDue({ ...base, seenOn: "2026-10-17" })).toBe(false);
    expect(surgeDue({ ...base, seenOn: null })).toBe(true);
    // Not shown up today yet: nothing to celebrate.
    expect(surgeDue({ ...base, seenOn: "2026-10-16", active: new Set(["2026-10-16"]) })).toBe(false);
    expect(surgeDue({ ...base, running: 0, seenOn: null })).toBe(false);
    expect(flameStateOf({ ...base, seenOn: "2026-10-16" })).toMatchObject({ surge: true, day: "2026-10-17" });
  });

  it("the envelope swells and settles inside 2.2 s, and is zero outside it", () => {
    expect(surgeEnvelope(-0.1)).toBe(0);
    expect(surgeEnvelope(0)).toBe(0);
    expect(surgeEnvelope(SURGE_SECONDS)).toBe(0);
    expect(surgeEnvelope(Number.NaN)).toBe(0);
    const peak = Math.max(...Array.from({ length: 22 }, (_, i) => surgeEnvelope(i / 10)));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(1);
    expect(surgeEnvelope(0.5)).toBeGreaterThan(surgeEnvelope(2));
  });

  it("uniforms: about 30% taller and hotter at the peak, bar width 1.7 with no sparks, the waiting ember never swells", () => {
    const calm = flameUniforms("torch", 0, "stage");
    expect(calm).toEqual({ uH: 0.84, uHeat: 1, uGold: 0, uSparks: 1, uW: 1 });
    const swell = flameUniforms("ember", 1, "stage");
    expect(swell.uH).toBeCloseTo(0.52 * 1.32);
    expect(swell.uHeat).toBeCloseTo(0.85 * 1.35);
    expect(flameUniforms("gold", 1, "stage").uH).toBe(1);
    expect(flameUniforms("gold", 0, "bar")).toMatchObject({ uSparks: 0, uW: 1.7, uGold: 1 });
    expect(flameUniforms("risk", 1, "bar")).toEqual(flameUniforms("risk", 0, "bar"));
  });

  it("caps the device pixel ratio at 2", () => {
    expect([undefined, 1, 1.5, 2, 3].map(cappedDpr)).toEqual([1, 1, 1.5, 2, 2]);
  });
});
