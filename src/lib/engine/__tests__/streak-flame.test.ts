import { describe, expect, it } from "vitest";
import { CLOSE_HREF, flameClip, flameLabel, flameStateOf, flameTier, nextTierLine, sheetAction, surgeDue, surgeEnvelope, surgeLook, SURGE_SECONDS, tierName } from "@/lib/engine/streak-flame";

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

  it("each look plays its own filmed loop: the pill in the bar, the stage in the sheet, the still for reduced motion (H-952)", () => {
    expect(flameClip("torch", "bar")).toEqual({ mp4: "/streak/streak-torch-pill.mp4?v=2", webm: "/streak/streak-torch-pill.webm?v=2", poster: "/streak/streak-torch-still.jpg?v=2", still: "/streak/streak-torch-still.jpg?v=2", rate: 1, dim: 0 });
    expect(flameClip("gold", "stage")).toMatchObject({ mp4: "/streak/streak-gold-stage.mp4?v=2", webm: "/streak/streak-gold-stage.webm?v=2" });
    // Waiting on you: the Ember loop under an 18% dark layer at 0.7x speed (about 82% of the done state, H-1487).
    expect(flameClip("risk", "bar")).toMatchObject({ mp4: "/streak/streak-ember-pill.mp4?v=2", rate: 0.7, dim: 0.18 });
  });
  it("gives a phone the light copies, MP4 only, with first-frame posters (H-1063)", () => {
    expect(flameClip("gold", "bar", true)).toEqual({ mp4: "/streak/streak-gold-pill-m.mp4?v=2", webm: null, poster: "/streak/streak-gold-pill-m-poster.jpg?v=2", still: "/streak/streak-gold-still.jpg?v=2", rate: 1, dim: 0 });
    expect(flameClip("risk", "stage", true)).toMatchObject({ mp4: "/streak/streak-ember-stage-m.mp4?v=2", poster: "/streak/streak-ember-stage-m-poster.jpg?v=2", dim: 0.18 });
  });
  it("swells the surge with a glow layer, never on the waiting ember", () => {
    expect(surgeLook("torch", 0)).toEqual({ scale: 1, glow: 0 });
    expect(surgeLook("ember", 1)).toEqual({ scale: 1.3, glow: 1 });
    expect(surgeLook("gold", 2).scale).toBe(1.3);
    expect(surgeLook("risk", 1)).toEqual(surgeLook("risk", 0));
  });
});
