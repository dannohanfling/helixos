import { describe, expect, it } from "vitest";
import { AQUEDUCT_FOUNTAIN, COLOSSEUM_BIRDS, COLOSSEUM_CLOUD_S, COLOSSEUM_FLICKER, COLOSSEUM_MOTES, COLOSSEUM_TWINKLES, top3CheerKey } from "../ambience";

const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;

describe("the Colosseum's ambience (H-637 PR 1)", () => {
  it("draws what the mockup draws: three flicker regions, twelve lights, sixteen motes, three birds, a 48 s cloud", () => {
    expect(COLOSSEUM_FLICKER).toHaveLength(3);
    expect(COLOSSEUM_TWINKLES).toHaveLength(12);
    expect(COLOSSEUM_MOTES).toHaveLength(16);
    expect(COLOSSEUM_BIRDS).toHaveLength(3);
    expect(COLOSSEUM_CLOUD_S).toBe(48);
  });

  it("keeps one copy of the photo per region: the three clips are left, centre and right", () => {
    expect(COLOSSEUM_FLICKER.map((f) => f.clip)).toEqual(["inset(0 64% 0 0)", "inset(0 34% 0 34%)", "inset(0 0 0 64%)"]);
    expect(new Set(COLOSSEUM_FLICKER.map((f) => f.d)).size).toBe(3);
  });

  it("puts every light, mote and bird inside the picture, with a positive duration", () => {
    for (const t of COLOSSEUM_TWINKLES) expect(inside(t) && t.d > 0).toBe(true);
    for (const m of COLOSSEUM_MOTES) expect(inside(m) && m.d > 0).toBe(true);
    for (const b of COLOSSEUM_BIRDS) expect(b.y > 0 && b.y < 30 && b.d > 0).toBe(true);
  });

  it("keeps the motes over the arena floor, around its centre", () => {
    for (const m of COLOSSEUM_MOTES) {
      expect(Math.abs(m.x - 50.6)).toBeLessThanOrEqual(11);
      expect(Math.abs(m.y - 54.2)).toBeLessThanOrEqual(13);
    }
  });

  it("marks the top-3 cheer per member and per week", () => {
    expect(top3CheerKey("m1", "2026-10-12")).toBe("hx-top3-m1-2026-10-12");
    expect(top3CheerKey("m1", "2026-10-19")).not.toBe(top3CheerKey("m1", "2026-10-12"));
    expect(top3CheerKey("m2", "2026-10-12")).not.toBe(top3CheerKey("m1", "2026-10-12"));
  });
});

describe("the Aqueduct's full fountain (H-637 PR 2)", () => {
  it("draws four streaks, a mist, four spray drops and a ripple in both looks", () => {
    for (const look of ["day", "night"] as const) {
      const f = AQUEDUCT_FOUNTAIN[look];
      expect(f.streaks).toHaveLength(4);
      expect(f.spray).toHaveLength(4);
    }
  });

  it("keeps golden hour on the mockup's coordinates", () => {
    expect(AQUEDUCT_FOUNTAIN.day.streaks[0].d).toBe("M1392,392 C1410,450 1425,520 1430,612");
    expect(AQUEDUCT_FOUNTAIN.day.mist).toEqual({ cx: 1452, cy: 628, rx: 60, ry: 18 });
    expect(AQUEDUCT_FOUNTAIN.day.spray[0]).toEqual({ cx: 1528, cy: 598, r: 2.4, dl: 0 });
  });

  it("puts every point inside the 1680 by 944 picture, by the waterfall and fountain on the right", () => {
    for (const look of ["day", "night"] as const) {
      const f = AQUEDUCT_FOUNTAIN[look];
      const pts = f.streaks.flatMap((s) => [...s.d.matchAll(/(\d+),(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]));
      pts.push([f.mist.cx, f.mist.cy], [f.ripple.cx, f.ripple.cy], ...f.spray.map((d) => [d.cx, d.cy]));
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThan(1300);
        expect(x).toBeLessThan(1680);
        expect(y).toBeGreaterThan(300);
        expect(y).toBeLessThan(944);
      }
    }
  });
});
