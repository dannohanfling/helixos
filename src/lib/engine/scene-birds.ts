/**
 * Birds over a scene (H-1367, plan H-1384): the pure parts of the overlay that draws filmed dove and eagle sprites on a
 * canvas over a still photo. Everything with a number in it lives here, tested without a browser; the component
 * (src/components/scene-birds.tsx) only loads the sheets, keeps time and draws.
 *
 * A sheet holds top-down frames in rows of `cols`, the head toward the top of each frame; a bird is turned by
 * atan2(dy, dx) + 90° to face where it flies. Every crossing is a quadratic curve from off-screen on one side to
 * off-screen on the other, kept to the upper part of the scene, so nothing ever pops in or out.
 */
export type SpriteMeta = { frames: number; cols: number; frameWidth: number; frameHeight: number; fps: number };
/** The two sheets as shipped by Scriba (20 Oct): one seamless wingbeat, and a glide with a gentle bank. */
export const DOVE_META: SpriteMeta = { frames: 37, cols: 8, frameWidth: 240, frameHeight: 128, fps: 24 };
export const EAGLE_META: SpriteMeta = { frames: 60, cols: 8, frameWidth: 320, frameHeight: 135, fps: 24 };
/** Bumped on a same-name swap of the sheets: they are served as immutable for a year. */
export const BIRDS_VERSION = 1;
export const COLOSSEUM_BIRDS = {
  dove: { webp: `/colosseum/birds/dove.webp?v=${BIRDS_VERSION}`, png: `/colosseum/birds/dove.png?v=${BIRDS_VERSION}`, meta: DOVE_META },
  eagle: { webp: `/colosseum/birds/eagle.webp?v=${BIRDS_VERSION}`, png: `/colosseum/birds/eagle.png?v=${BIRDS_VERSION}`, meta: EAGLE_META },
} as const;

export type Range = readonly [number, number];
export type Kind = "dove" | "eagle";
/** The behaviour Danno approved, in seconds and in shares of the scene's width. */
export type Timing = { firstAt: Range; every: Range; cross: Range; width: Range; curve: number; pairChance: number };
export const DOVE_TIMING: Timing = { firstAt: [2, 6], every: [7, 15], cross: [8, 12], width: [0.03, 0.04], curve: 0.25, pairChance: 0.75 };
export const EAGLE_TIMING: Timing = { firstAt: [12, 25], every: [45, 90], cross: [16, 21], width: [0.07, 0.085], curve: 0.45, pairChance: 0 };
/** The top share of the scene the birds keep to. */
export const SKY = 0.7;
/** How far off-screen a crossing starts and ends, as a share of the width. */
export const OFFSCREEN = 0.12;
export const MAX_DPR = 2;

export type Rng = () => number;
export const between = (rng: Rng, r: Range): number => r[0] + rng() * (r[1] - r[0]);

export type Path = { x0: number; y0: number; cx: number; cy: number; x2: number; y2: number };
export type Bird = { kind: Kind; path: Path; dur: number; w: number; age: number; side: number; phase: number; rate: number };
export type Flock = { clock: number; birds: Bird[]; nextDove: number; nextEagle: number; crossings: number };

/** A gentle curved crossing: off-screen to off-screen, a random height in the sky and a random bend. */
export function crossingPath(rng: Rng, W: number, H: number, curve: number): Path {
  const leftToRight = rng() < 0.5;
  const y0 = between(rng, [0.05, 0.55]) * H;
  const y2 = Math.min(Math.max(y0 + between(rng, [-0.35, 0.35]) * H, 0.02 * H), SKY * H);
  const pad = OFFSCREEN * W;
  const x0 = leftToRight ? -pad : W + pad;
  const x2 = leftToRight ? W + pad : -pad;
  const cx = between(rng, [0.3, 0.7]) * W;
  const cy = (y0 + y2) / 2 + between(rng, [-curve, curve]) * H;
  return { x0, y0, cx, cy, x2, y2 };
}

/** Where the curve is at t in [0, 1], and which way it heads there. */
export function pointAt(p: Path, t: number): { x: number; y: number; dx: number; dy: number } {
  const u = 1 - t;
  return {
    x: u * u * p.x0 + 2 * u * t * p.cx + t * t * p.x2,
    y: u * u * p.y0 + 2 * u * t * p.cy + t * t * p.y2,
    dx: 2 * u * (p.cx - p.x0) + 2 * t * (p.x2 - p.cx),
    dy: 2 * u * (p.cy - p.y0) + 2 * t * (p.y2 - p.cy),
  };
}

/** The sheet's head points up, so a bird flying along (dx, dy) turns by this. */
export const headingOf = (dx: number, dy: number): number => Math.atan2(dy, dx) + Math.PI / 2;

/** Which frame a bird shows after `age` seconds, and where it sits on the sheet. */
export function frameAt(m: SpriteMeta, phase: number, age: number, rate: number): { f: number; sx: number; sy: number } {
  const f = ((Math.floor(phase + age * m.fps * rate) % m.frames) + m.frames) % m.frames;
  return { f, sx: (f % m.cols) * m.frameWidth, sy: Math.floor(f / m.cols) * m.frameHeight };
}

/** Where a bird draws now: its centre (the follower beside and a little behind the leader), its turn, and its size. */
export function placeBird(b: Bird): { x: number; y: number; angle: number; w: number; h: number; sheet: SpriteMeta } | null {
  const t = b.age / b.dur;
  if (t < 0 || t > 1) return null;
  const q = pointAt(b.path, t);
  const angle = headingOf(q.dx, q.dy);
  const m = b.kind === "dove" ? DOVE_META : EAGLE_META;
  const h = (b.w * m.frameHeight) / m.frameWidth;
  // Across the direction of travel, so a pair flies side by side.
  const nx = -Math.sin(angle - Math.PI / 2);
  const ny = Math.cos(angle - Math.PI / 2);
  return { x: q.x + nx * b.side * b.w, y: q.y + ny * b.side * b.w, angle, w: b.w, h, sheet: m };
}

/** A dove crossing: a pair three times in four, the follower beside and slightly behind. */
export function spawnDoves(rng: Rng, W: number, H: number): Bird[] {
  const path = crossingPath(rng, W, H, DOVE_TIMING.curve);
  const dur = between(rng, DOVE_TIMING.cross);
  const w = W * between(rng, DOVE_TIMING.width);
  const count = rng() < DOVE_TIMING.pairChance ? 2 : 1;
  const out: Bird[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ kind: "dove", path, dur, w, age: -i * between(rng, [0.25, 0.45]), side: i ? between(rng, [0.5, 0.9]) * (rng() < 0.5 ? -1 : 1) : 0, phase: rng() * DOVE_META.frames, rate: between(rng, [0.9, 1.1]) });
  }
  return out;
}

export function spawnEagle(rng: Rng, W: number, H: number): Bird {
  return { kind: "eagle", path: crossingPath(rng, W, H, EAGLE_TIMING.curve), dur: between(rng, EAGLE_TIMING.cross), w: W * between(rng, EAGLE_TIMING.width), age: 0, side: 0, phase: rng() * EAGLE_META.frames, rate: between(rng, [0.85, 1]) };
}

/** An empty sky with the first crossings scheduled: doves 2 to 6 s in, the eagle 12 to 25 s in. */
export function newFlock(rng: Rng): Flock {
  return { clock: 0, birds: [], nextDove: between(rng, DOVE_TIMING.firstAt), nextEagle: between(rng, EAGLE_TIMING.firstAt), crossings: 0 };
}

/**
 * Advance the sky by `dt` seconds (capped so a sleeping tab never jumps): new crossings on their schedule, every bird
 * older, finished birds gone and counted. Doves first, the eagle last, so it draws above them.
 */
export function stepFlock(f: Flock, dt: number, rng: Rng, W: number, H: number): Flock {
  const step = Math.min(Math.max(dt, 0), 0.1);
  const clock = f.clock + step;
  let birds = f.birds.map((b) => ({ ...b, age: b.age + step }));
  let { nextDove, nextEagle } = f;
  if (clock >= nextDove) {
    birds = [...birds, ...spawnDoves(rng, W, H)];
    nextDove = clock + between(rng, DOVE_TIMING.every);
  }
  if (clock >= nextEagle) {
    birds = [...birds, spawnEagle(rng, W, H)];
    nextEagle = clock + between(rng, EAGLE_TIMING.every);
  }
  const done = birds.filter((b) => b.age > b.dur).length;
  birds = birds.filter((b) => b.age <= b.dur);
  return { clock, birds: [...birds.filter((b) => b.kind === "dove"), ...birds.filter((b) => b.kind === "eagle")], nextDove, nextEagle, crossings: f.crossings + done };
}
