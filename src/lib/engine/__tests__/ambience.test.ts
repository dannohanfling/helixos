import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BIRD_POSES, BIRD_SPEED, flightCss, flightCurve, flightLength, FORUM_CLOUD_S, FORUM_FLIGHTS, FORUM_FIREFLIES, FORUM_FLAME, FORUM_FLICKER, AQUEDUCT_FOUNTAIN, COLOSSEUM_FLIGHTS, COLOSSEUM_CLOUD_S, COLOSSEUM_FLICKER, COLOSSEUM_MOTES, COLOSSEUM_TWINKLES, top3CheerKey } from "../ambience";

const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;

describe("the Colosseum's ambience (H-637 PR 1)", () => {
  it("draws what the mockup draws: three flicker regions, twelve lights, sixteen motes, three birds, a 48 s cloud", () => {
    expect(COLOSSEUM_FLICKER).toHaveLength(3);
    expect(COLOSSEUM_TWINKLES).toHaveLength(12);
    expect(COLOSSEUM_MOTES).toHaveLength(16);
    expect(COLOSSEUM_FLIGHTS).toHaveLength(3);
    expect(COLOSSEUM_CLOUD_S).toBe(48);
  });

  it("keeps one copy of the photo per region: the three clips are left, centre and right", () => {
    expect(COLOSSEUM_FLICKER.map((f) => f.clip)).toEqual(["inset(0 64% 0 0)", "inset(0 34% 0 34%)", "inset(0 0 0 64%)"]);
    expect(new Set(COLOSSEUM_FLICKER.map((f) => f.d)).size).toBe(3);
  });

  it("puts every light and mote inside the picture, with a positive duration, and the birds high over the stands", () => {
    for (const t of COLOSSEUM_TWINKLES) expect(inside(t) && t.d > 0).toBe(true);
    for (const m of COLOSSEUM_MOTES) expect(inside(m) && m.d > 0).toBe(true);
    for (const f of COLOSSEUM_FLIGHTS) for (const [, y] of f.pts.slice(1, -1)) expect(y > 0 && y < 30).toBe(true);
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
  it("draws a sheet, five streaks of their own widths and speeds, a mist, four spray drops and a ripple in both looks (H-966)", () => {
    for (const look of ["day", "night"] as const) {
      const f = AQUEDUCT_FOUNTAIN[look];
      expect(f.sheet.startsWith("M") && f.sheet.endsWith("Z")).toBe(true);
      expect(f.streaks).toHaveLength(5);
      expect(new Set(f.streaks.map((s) => s.w)).size).toBe(5);
      expect(new Set(f.streaks.map((s) => s.s)).size).toBe(5);
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
      const pts = [...f.streaks.map((s) => s.d), f.sheet].flatMap((d) => [...d.matchAll(/(\d+),(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]));
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

describe("the Forum's ambience (H-637 PR 3)", () => {
  it("draws three flicker regions, ten fireflies, a flock of five birds, a 52 s cloud", () => {
    expect(FORUM_FLICKER.map((f) => f.clip)).toEqual(["inset(0 64% 0 0)", "inset(0 34% 0 34%)", "inset(0 0 0 64%)"]);
    expect(FORUM_FIREFLIES).toHaveLength(10);
    expect(FORUM_FLIGHTS).toHaveLength(5);
    expect(FORUM_CLOUD_S).toBe(52);
  });

  it("puts the fireflies and the flame inside the picture, the flame on the centre column", () => {
    for (const f of FORUM_FIREFLIES) expect(inside(f) && f.d > 0).toBe(true);
    expect(FORUM_FIREFLIES[0]).toMatchObject({ x: 36.9, y: 29.66 });
    expect(Math.abs(FORUM_FLAME.x + FORUM_FLAME.w / 2 - 50)).toBeLessThan(1);
  });

});

describe("the birds (H-966)", () => {
  const all = [...FORUM_FLIGHTS, ...COLOSSEUM_FLIGHTS];
  it("draws one bird in three wing poses, the left wing the right one mirrored", () => {
    expect(Object.keys(BIRD_POSES)).toEqual(["up", "level", "down"]);
    for (const d of Object.values(BIRD_POSES)) expect(d.match(/M/g)).toHaveLength(2);
    // Level is the widest span: the up and down poses are seen foreshortened from above.
    const span = (d: string) => Math.max(...[...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Math.abs(Number(m[1]) - 20)));
    expect(span(BIRD_POSES.level)).toBeGreaterThan(span(BIRD_POSES.up));
    expect(span(BIRD_POSES.level)).toBeGreaterThan(span(BIRD_POSES.down));
  });

  it("flies each bird its own path from just off one edge to just off another", () => {
    const out = ([x, y]: [number, number]) => x < 0 || x > 100 || y < 0 || y > 100;
    for (const f of all) {
      expect(f.pts.length).toBeGreaterThanOrEqual(5);
      expect(out(f.pts[0]) && out(f.pts[f.pts.length - 1])).toBe(true);
    }
    expect(new Set(all.map((f) => JSON.stringify(f.pts))).size).toBe(all.length);
  });

  it("makes nearer birds larger and faster, and no two birds in step", () => {
    for (const f of all) expect(flightLength(flightCurve(f.pts)) / f.fly).toBeCloseTo(BIRD_SPEED * f.k, 0);
    const byK = [...FORUM_FLIGHTS].sort((a, b) => a.k - b.k);
    for (let i = 1; i < byK.length; i++) expect(byK[i].w).toBeGreaterThanOrEqual(byK[i - 1].w);
    for (const set of [FORUM_FLIGHTS, COLOSSEUM_FLIGHTS]) {
      expect(new Set(set.map((f) => f.d)).size).toBe(set.length);
      expect(new Set(set.map((f) => f.cycle)).size).toBe(set.length);
      expect(new Set(set.map((f) => f.dl)).size).toBe(set.length);
    }
  });

  it("flaps for three to five beats, then glides on level wings for one to two seconds", () => {
    for (const f of all) {
      expect(f.flaps).toBeGreaterThanOrEqual(3);
      expect(f.flaps).toBeLessThanOrEqual(5);
      expect(f.glide).toBeGreaterThanOrEqual(1);
      expect(f.glide).toBeLessThanOrEqual(2);
    }
  });

  it("builds keyframes for the path (fading in and out), the heading and each pose", () => {
    const css = flightCss("t", FORUM_FLIGHTS[0]);
    for (const n of ["t-p", "t-h", "t-up", "t-lv", "t-dn"]) expect(css).toContain(`@keyframes ${n}{`);
    const path = css.slice(css.indexOf("@keyframes t-p{"), css.indexOf("@keyframes t-h{"));
    expect(path).toMatch(/^@keyframes t-p\{0%\{[^}]*opacity:0\}/);
    expect(path).toContain("opacity:1}");
    expect(path).toMatch(/100%\{[^}]*opacity:0\}\}\s*$/);
    // Glide: the level pose holds from the last beat's end to the cycle's end.
    const f = FORUM_FLIGHTS[0];
    const lv = css.slice(css.indexOf("@keyframes t-lv{"), css.indexOf("@keyframes t-dn{"));
    const glideAt = Math.round(((f.flaps * f.beat) / f.cycle) * 10000) / 100;
    expect(lv).toContain(`${glideAt}%{opacity:1}`);
    expect(lv.trim().endsWith("100%{opacity:0}}")).toBe(true);
  });

  it("uses only transforms and opacity", () => {
    const css = [...FORUM_FLIGHTS, ...COLOSSEUM_FLIGHTS].map((f, i) => flightCss(`b${i}`, f)).join("");
    const props = new Set([...css.matchAll(/[{;]([a-z-]+):/g)].map((m) => m[1]));
    expect([...props].sort()).toEqual(["opacity", "transform"]);
  });

  it("keeps the old dove and lane styles out of the stylesheet", () => {
    const sheet = readFileSync("src/components/ambience.css", "utf8");
    expect(sheet).not.toMatch(/amb-dove|amb-lane|amb-flap|amb-ox/);
  });
});

describe("the Council Chamber's ambience (Roma Vivit 2, H-1060)", () => {
  it("draws ten flames on the painted candles, four glow pools, a moonbeam, and motes and shafts by day", async () => {
    const m = await import("../ambience");
    expect(m.COUNCIL_FLAMES).toHaveLength(10);
    expect(m.COUNCIL_GLOWS).toHaveLength(4);
    expect(m.COUNCIL_MOTES_NIGHT).toHaveLength(8);
    expect(m.COUNCIL_SHAFTS).toHaveLength(3);
    expect(m.COUNCIL_MOTES_DAY).toHaveLength(14);
    expect(m.COUNCIL_CLOUD_S).toBe(60);
  });

  it("puts every flame, glow and mote inside the picture, each flame with a size and a positive timing", async () => {
    const m = await import("../ambience");
    for (const f of m.COUNCIL_FLAMES) {
      expect(inside(f) && f.w > 0 && f.h > 0 && f.d > 0).toBe(true);
      expect(f.y - f.h).toBeGreaterThan(0);
    }
    for (const g of m.COUNCIL_GLOWS) expect(inside(g)).toBe(true);
    for (const p of [...m.COUNCIL_MOTES_NIGHT, ...m.COUNCIL_MOTES_DAY]) expect(inside(p) && p.d > 0).toBe(true);
  });

  it("keeps the braziers on the photo's measured wicks", async () => {
    const m = await import("../ambience");
    expect(m.COUNCIL_FLAMES[0]).toMatchObject({ x: 15.65, y: 23.52 });
    expect(m.COUNCIL_FLAMES[1]).toMatchObject({ x: 82.56, y: 22.46 });
  });
});
