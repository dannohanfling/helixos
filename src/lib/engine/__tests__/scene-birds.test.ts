import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BIRDS_VERSION, COLOSSEUM_BIRDS, DOVE_META, DOVE_TIMING, EAGLE_META, EAGLE_TIMING, OFFSCREEN, SKY, between, crossingPath, frameAt, headingOf, newFlock, placeBird, pointAt, spawnDoves, spawnEagle, stepFlock } from "@/lib/engine/scene-birds";

/** A small seeded generator, so the tests are the same every run. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const W = 1000;
const H = 562;

describe("birds over a scene (H-1367, plan H-1384)", () => {
  it("every crossing starts and ends off-screen, in the sky, however the dice fall", () => {
    const rng = seeded(7);
    for (let i = 0; i < 500; i++) {
      const p = crossingPath(rng, W, H, 0.45);
      const start = pointAt(p, 0);
      const end = pointAt(p, 1);
      expect([start.x, end.x].sort((a, b) => a - b)).toEqual([-OFFSCREEN * W, W + OFFSCREEN * W]);
      for (const y of [p.y0, p.y2]) {
        expect(y).toBeGreaterThanOrEqual(0.02 * H - 1e-9);
        expect(y).toBeLessThanOrEqual(SKY * H + 1e-9);
      }
    }
  });

  it("a bird faces where it flies: the sheet's head points up, so left to right turns it a quarter turn clockwise", () => {
    expect(headingOf(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(headingOf(-1, 0)).toBeCloseTo((3 * Math.PI) / 2);
    expect(headingOf(0, -1)).toBeCloseTo(0);
    const p = { x0: 0, y0: 100, cx: 500, cy: 100, x2: 1000, y2: 100 };
    const mid = pointAt(p, 0.5);
    expect(mid).toEqual({ x: 500, y: 100, dx: 1000, dy: 0 });
  });

  it("frames cycle through the sheet in its rows and columns, at its speed", () => {
    expect(frameAt(DOVE_META, 0, 0, 1)).toEqual({ f: 0, sx: 0, sy: 0 });
    expect(frameAt(DOVE_META, 0, 9 / 24, 1)).toEqual({ f: 9, sx: 240, sy: 128 });
    expect(frameAt(DOVE_META, 0, 37 / 24, 1).f).toBe(0);
    expect(frameAt(EAGLE_META, 59, 0, 1)).toEqual({ f: 59, sx: 3 * 320, sy: 7 * 135 });
    expect(frameAt(EAGLE_META, 0, -1 / 24, 1).f).toBe(59);
  });

  it("doves fly in pairs three times in four, at 3 to 4% of the width, crossing in 8 to 12 s; the follower sits beside and behind", () => {
    const rng = seeded(11);
    let pairs = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const doves = spawnDoves(rng, W, H);
      if (doves.length === 2) pairs++;
      for (const d of doves) {
        expect(d.w / W).toBeGreaterThanOrEqual(DOVE_TIMING.width[0]);
        expect(d.w / W).toBeLessThanOrEqual(DOVE_TIMING.width[1]);
        expect(d.dur).toBeGreaterThanOrEqual(8);
        expect(d.dur).toBeLessThanOrEqual(12);
      }
      if (doves.length === 2) {
        expect(doves[0].side).toBe(0);
        expect(Math.abs(doves[1].side)).toBeGreaterThanOrEqual(0.5);
        expect(doves[1].age).toBeLessThan(0);
        expect(doves[1].path).toBe(doves[0].path);
      }
    }
    expect(pairs / N).toBeGreaterThan(0.7);
    expect(pairs / N).toBeLessThan(0.8);
  });

  it("the eagle is 7 to 8.5% of the width and crosses in 16 to 21 s", () => {
    const rng = seeded(3);
    for (let i = 0; i < 300; i++) {
      const e = spawnEagle(rng, W, H);
      expect(e.w / W).toBeGreaterThanOrEqual(EAGLE_TIMING.width[0]);
      expect(e.w / W).toBeLessThanOrEqual(EAGLE_TIMING.width[1]);
      expect(e.dur).toBeGreaterThanOrEqual(16);
      expect(e.dur).toBeLessThanOrEqual(21);
    }
  });

  it("the first doves come 2 to 6 s in and the eagle 12 to 25 s in; the next every 7 to 15 and 45 to 90 s; crossings are counted and the eagle draws last", () => {
    const rng = seeded(5);
    let f = newFlock(rng);
    expect(f.nextDove).toBeGreaterThanOrEqual(2);
    expect(f.nextDove).toBeLessThanOrEqual(6);
    expect(f.nextEagle).toBeGreaterThanOrEqual(12);
    expect(f.nextEagle).toBeLessThanOrEqual(25);
    const firstDove = f.nextDove;
    const firstEagle = f.nextEagle;
    // 1/30 s steps for 150 s.
    let doveGaps: number[] = [];
    let eagleGaps: number[] = [];
    let lastDove = firstDove;
    let lastEagle = firstEagle;
    for (let t = 0; t < 150 * 30; t++) {
      const before = f;
      f = stepFlock(f, 1 / 30, rng, W, H);
      if (f.nextDove !== before.nextDove) {
        doveGaps.push(f.nextDove - lastDove);
        lastDove = f.nextDove;
      }
      if (f.nextEagle !== before.nextEagle) {
        eagleGaps.push(f.nextEagle - lastEagle);
        lastEagle = f.nextEagle;
      }
      const kinds = f.birds.map((b) => b.kind);
      expect(kinds.lastIndexOf("dove")).toBeLessThan(kinds.includes("eagle") ? kinds.indexOf("eagle") : kinds.length);
      for (const b of f.birds) expect(b.age).toBeLessThanOrEqual(b.dur);
    }
    doveGaps = doveGaps.slice(0, -1);
    eagleGaps = eagleGaps.slice(0, -1);
    expect(doveGaps.length).toBeGreaterThan(5);
    for (const g of doveGaps) {
      expect(g).toBeGreaterThanOrEqual(7);
      expect(g).toBeLessThanOrEqual(15 + 1 / 30);
    }
    for (const g of eagleGaps) {
      expect(g).toBeGreaterThanOrEqual(45);
      expect(g).toBeLessThanOrEqual(90 + 1 / 30);
    }
    expect(f.crossings).toBeGreaterThan(10);
  });

  it("a sleeping tab never jumps: a step is capped at a tenth of a second", () => {
    const f = stepFlock({ clock: 0, birds: [], nextDove: 100, nextEagle: 100, crossings: 0 }, 30, Math.random, W, H);
    expect(f.clock).toBe(0.1);
  });

  it("a bird draws only while on its curve, the follower offset across the direction of travel", () => {
    const path = { x0: -120, y0: 100, cx: 500, cy: 100, x2: 1120, y2: 100 };
    const lead = { kind: "dove" as const, path, dur: 10, w: 35, age: 5, side: 0, phase: 0, rate: 1 };
    const p = placeBird(lead)!;
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(100);
    expect(p.h).toBeCloseTo((35 * 128) / 240);
    const follower = placeBird({ ...lead, side: 0.7 })!;
    expect(follower.x).toBeCloseTo(500);
    expect(Math.abs(follower.y - 100)).toBeCloseTo(0.7 * 35);
    expect(placeBird({ ...lead, age: -0.3 })).toBeNull();
    expect(placeBird({ ...lead, age: 10.1 })).toBeNull();
  });

  it("the Colosseum's sheets are in public/ under a version tag, and the config caches them as immutable", () => {
    for (const s of [COLOSSEUM_BIRDS.dove, COLOSSEUM_BIRDS.eagle]) {
      for (const url of [s.webp, s.png]) {
        expect(url.endsWith(`?v=${BIRDS_VERSION}`)).toBe(true);
        expect(readFileSync(`public${url.split("?")[0]}`).length).toBeGreaterThan(10000);
      }
    }
    expect(readFileSync("next.config.ts", "utf8")).toMatch(/source: "\/colosseum\/birds\/:file\*"/);
    expect(between(() => 0.5, [2, 6])).toBe(4);
  });
});
