import { describe, expect, it } from "vitest";
import { backboneLit, backbonePlace, EMPTY_FACTS, helixRungs, longestRun, nextRung, PHASES, rungDone, rungPlace, RUNGS, SIGNALS, stats, STEP_PX, TWIST_DEG } from "@/lib/engine/my-helix";

describe("My Helix (rev 707, rev 710)", () => {
  it("has 67 rungs over ten phases, bottom to top, each with a known signal and a link", () => {
    expect(RUNGS).toHaveLength(67);
    expect(PHASES.map((p) => p.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(PHASES.map((p) => RUNGS.filter((r) => r.phase === p.n).length)).toEqual([7, 6, 6, 7, 7, 7, 6, 7, 5, 9]);
    const known = new Set(SIGNALS.map((s) => s.key));
    for (const r of RUNGS) {
      expect(known.has(r.signal), `${r.key} reads ${r.signal}`).toBe(true);
      expect(r.href.startsWith("/")).toBe(true);
    }
    expect(RUNGS[0].key).toBe("p0-superpower");
    expect(RUNGS[66].key).toBe("p9-event-client");
    expect(RUNGS.filter((r) => r.signal === "tick")).toHaveLength(30);
  });
  it("places rung i at i × 14px and i × 30°, the backbone ball halfway, lit only between two done rungs", () => {
    expect(rungPlace(0)).toEqual({ y: 0, theta: 0 });
    expect(rungPlace(12)).toEqual({ y: 12 * STEP_PX, theta: 12 * TWIST_DEG });
    expect(backbonePlace(3)).toEqual({ y: 3.5 * STEP_PX, theta: 3.5 * TWIST_DEG });
    expect(backboneLit([true, true, false], 0)).toBe(true);
    expect(backboneLit([true, false, true], 0)).toBe(false);
    expect(backboneLit([true, false, true], 1)).toBe(false);
    expect(backboneLit([true, true], 1)).toBe(false);
  });
  it("a new account is all grey with rung 1 of Essence next; stats count built rungs", () => {
    const rungs = helixRungs(RUNGS, EMPTY_FACTS);
    expect(rungs.every((r) => !r.done)).toBe(true);
    expect(nextRung(rungs)?.key).toBe("p0-superpower");
    expect(stats(rungs)).toEqual({ built: 0, total: 67, pct: 0 });
    const some = helixRungs(RUNGS, { ...EMPTY_FACTS, ticks: ["p0-superpower", "p0-seven-levels"], avatars: 1 });
    expect(nextRung(some)?.key).toBe("p0-mission");
    expect(stats(some)).toEqual({ built: 3, total: 67, pct: 4 });
    expect(nextRung(helixRungs(RUNGS, { ...EMPTY_FACTS, ticks: RUNGS.map((r) => r.key), avatars: 1, offers: { promise: true, framework: true, containerPrice: true, objections: true, tiers: ["freebie", "starter", "core", "premium"] }, pathwayMax: 2, ladders: { launched: 1, shipped: 1 }, postStreak: 7, magnets: 1, magnetsPublished: 1, log: { newLeads: 50, dmsStarted: 1, callsBooked: 1, callsHeld: 1, offersMade: 1 }, content: { count: 15, scheduled: 1, posted: 1 }, scripts: 1, clients: 1, botLive: true, essence: ["mission_and_vision", "goals_and_objectives", "stories"], webinar: { any: true, named: true, registration: true, delivered: true, offers: true, debrief: true, sale: true } }))).toBeNull();
  });
  it("a signal rung reads its signal, never a tick; a tick rung reads only its tick", () => {
    const lead10 = RUNGS.find((r) => r.key === "p4-lead-10")!;
    expect(rungDone(lead10, { ...EMPTY_FACTS, log: { ...EMPTY_FACTS.log, newLeads: 9 } })).toBe(false);
    expect(rungDone(lead10, { ...EMPTY_FACTS, log: { ...EMPTY_FACTS.log, newLeads: 10 } })).toBe(true);
    expect(rungDone(lead10, { ...EMPTY_FACTS, ticks: ["p4-lead-10"] })).toBe(false);
    const superpower = RUNGS.find((r) => r.key === "p0-superpower")!;
    expect(rungDone(superpower, { ...EMPTY_FACTS, avatars: 3, clients: 3 })).toBe(false);
    expect(rungDone(superpower, { ...EMPTY_FACTS, ticks: ["p0-superpower"] })).toBe(true);
    const mission = RUNGS.find((r) => r.key === "p0-mission")!;
    expect(rungDone(mission, { ...EMPTY_FACTS, essence: ["mission_and_vision"] })).toBe(false);
    expect(rungDone(mission, { ...EMPTY_FACTS, essence: ["mission_and_vision", "goals_and_objectives"] })).toBe(true);
    const core = RUNGS.find((r) => r.key === "p2-core")!;
    expect(rungDone(core, { ...EMPTY_FACTS, offers: { ...EMPTY_FACTS.offers, tiers: ["starter"] } })).toBe(false);
    expect(rungDone(core, { ...EMPTY_FACTS, offers: { ...EMPTY_FACTS.offers, tiers: ["core"] } })).toBe(true);
    // An unknown signal (a coach's typo in the editor) falls back to the tick rather than lighting up on its own.
    expect(rungDone({ key: "x", signal: "nonsense" }, EMPTY_FACTS)).toBe(false);
    expect(rungDone({ key: "x", signal: "nonsense" }, { ...EMPTY_FACTS, ticks: ["x"] })).toBe(true);
  });
  it("the visibility streak is the longest run of consecutive days with a post", () => {
    expect(longestRun([])).toBe(0);
    expect(longestRun(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"])).toBe(3);
    expect(longestRun(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"])).toBe(7);
  });
});
