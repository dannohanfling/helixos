/**
 * Roma Vivit (H-327 PR B, plan H-637): the always-on ambience under the big picture scenes. Pure data, copied from the approved
 * mockups in docs/scenes (living-scenes-colosseum.dc.html for now): where each twinkle, mote and bird sits, in percent of the
 * 1680×944 picture, and its timing in seconds. Nothing here reads or writes data; it only draws over the photos.
 */

/** A point in percent of the picture, with a duration and a delay in seconds. */
export type Twinkle = { x: number; y: number; d: number; dl: number };
export type Mote = { x: number; y: number; dx: number; dy: number; d: number; dl: number };

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** The night photo's flicker: three clipped copies (left, centre, right), each on its own timing. One copy per region. */
export const COLOSSEUM_FLICKER = [
  { clip: "inset(0 64% 0 0)", d: 2.1, dl: 0 },
  { clip: "inset(0 34% 0 34%)", d: 1.7, dl: 0.4 },
  { clip: "inset(0 0 0 64%)", d: 2.6, dl: 0.9 },
] as const;

/** The twelve city lights around the rim, at night. */
export const COLOSSEUM_TWINKLES: Twinkle[] = (
  [
    [6, 8],
    [14, 4],
    [22, 12],
    [31, 3],
    [40, 6],
    [62, 4],
    [70, 7],
    [78, 11],
    [86, 4],
    [93, 13],
    [97, 24],
    [3, 26],
  ] as const
).map(([x, y], i) => ({ x, y, d: round(2.2 + (i % 5) * 0.7, 1), dl: round(i * 0.37) }));

/** Sixteen dust motes on a spiral over the arena floor, at golden hour. dx and dy are their drift in px. */
export const COLOSSEUM_MOTES: Mote[] = Array.from({ length: 16 }, (_, i) => {
  const ang = i * 2.4;
  const r = 0.25 + ((i * 37) % 70) / 100;
  return {
    x: round(50.6 + Math.cos(ang) * 11 * r),
    y: round(54.2 + Math.sin(ang) * 13 * r),
    dx: 14 + (i % 4) * 9,
    dy: -10 - (i % 3) * 8,
    d: round(7 + (i % 5) * 1.6, 1),
    dl: round(-(i * 0.9), 1),
  };
});

/** The cloud shadow's crossing, in seconds: about one every 48 s. */
export const COLOSSEUM_CLOUD_S = 48;

/** The browser's mark that the top-3 cheer played for this member this week: once a week, never on a reload. */
export const top3CheerKey = (membershipId: string, monday: string): string => `hx-top3-${membershipId}-${monday}`;

/**
 * The Aqueduct's "none" picture (H-327 §4, H-966): a sheet and falling streaks over the painted waterfall, a mist pulse at its foot, and a spray
 * and ripple at the fountain, in the 1680×944 viewBox. Golden hour is the mockup's (living-scenes-aqueduct.dc.html); the night
 * picture's waterfall starts about 60 px higher, so its streaks are matched to that picture by eye.
 */
export type Fountain = {
  /** The falling sheet behind the streaks, over the painted waterfall. */
  sheet: string;
  /** Each streak's path, delay, width and speed (seconds per run of the `aq-drop` keyframes). */
  streaks: { d: string; dl: number; w: number; s: number }[];
  mist: { cx: number; cy: number; rx: number; ry: number };
  spray: { cx: number; cy: number; r: number; dl: number }[];
  ripple: { cx: number; cy: number; rx: number; ry: number };
};
const SPRAY = [
  { cx: 1528, cy: 598, r: 2.4, dl: 0 },
  { cx: 1522, cy: 600, r: 2, dl: 0.35 },
  { cx: 1534, cy: 600, r: 2, dl: 0.7 },
  { cx: 1528, cy: 602, r: 1.8, dl: 1.05 },
];
export const AQUEDUCT_FOUNTAIN: Record<"day" | "night", Fountain> = {
  day: {
    sheet: "M1388,392 C1408,452 1422,522 1426,614 L1476,622 C1470,535 1460,458 1444,398 Z",
    streaks: [
      { d: "M1392,392 C1410,450 1425,520 1430,612", dl: 0, w: 3, s: 2.6 },
      { d: "M1400,390 C1419,450 1434,522 1439,615", dl: -0.7, w: 1.6, s: 3.4 },
      { d: "M1408,388 C1428,450 1442,525 1448,618", dl: -0.2, w: 2.4, s: 2.2 },
      { d: "M1424,392 C1444,455 1456,530 1462,622", dl: -0.45, w: 3.4, s: 2.9 },
      { d: "M1440,400 C1458,460 1468,535 1472,620", dl: -0.3, w: 2, s: 2.4 },
    ],
    mist: { cx: 1452, cy: 628, rx: 60, ry: 18 },
    spray: SPRAY,
    ripple: { cx: 1530, cy: 636, rx: 46, ry: 11 },
  },
  night: {
    sheet: "M1388,332 C1410,420 1424,520 1428,606 L1478,614 C1472,535 1462,428 1444,338 Z",
    streaks: [
      { d: "M1392,332 C1412,420 1428,520 1432,606", dl: 0, w: 3, s: 2.6 },
      { d: "M1400,330 C1421,420 1436,522 1441,608", dl: -0.7, w: 1.6, s: 3.4 },
      { d: "M1408,328 C1430,420 1444,525 1450,610", dl: -0.2, w: 2.4, s: 2.2 },
      { d: "M1424,332 C1446,425 1458,530 1464,614", dl: -0.45, w: 3.4, s: 2.9 },
      { d: "M1440,340 C1460,430 1470,535 1474,612", dl: -0.3, w: 2, s: 2.4 },
    ],
    mist: { cx: 1455, cy: 614, rx: 60, ry: 18 },
    spray: SPRAY,
    ripple: { cx: 1530, cy: 634, rx: 46, ry: 11 },
  },
};

/*
 * The Forum (H-327 §5, docs/scenes/living-scenes-forum.dc.html), under the messengers. Night: the same three-copy flicker,
 * a light pool breathing over the plaza, the welcome's small flame on the centre column, fireflies in the gardens. Golden
 * hour: a loose flock of five birds (FORUM_FLIGHTS, below) and a cloud.
 */
export const FORUM_FLICKER = [
  { clip: "inset(0 64% 0 0)", d: 2.3, dl: 0 },
  { clip: "inset(0 34% 0 34%)", d: 1.9, dl: 0.5 },
  { clip: "inset(0 0 0 64%)", d: 2.7, dl: 1 },
] as const;

/** The flame on the centre column, as a box in percent of the picture: its base sits on the column's top. */
export const FORUM_FLAME = { x: 49.2, y: 39.6, w: 1.6, h: 3.6 } as const;

/** Ten fireflies in the gardens, from the mockup's points in the 1680×944 picture. dx and dy are their drift in px. */
export const FORUM_FIREFLIES: Mote[] = (
  [
    [620, 280],
    [1050, 300],
    [470, 430],
    [1180, 420],
    [560, 620],
    [1120, 600],
    [900, 250],
    [700, 700],
    [1000, 700],
    [380, 330],
  ] as const
).map(([px, py], i) => ({
  x: round(px / 16.8),
  y: round(py / 9.44),
  dx: (i % 2 ? 1 : -1) * (10 + i * 2),
  dy: -8 - (i % 3) * 6,
  d: round(5 + (i % 4) * 1.3, 1),
  dl: round(-(i * 0.8), 1),
}));

/** The cloud shadow's crossing over the Forum, in seconds. */
export const FORUM_CLOUD_S = 52;

/*
 * Birds (H-966, plan H-971): one shared bird for both golden-hour scenes, seen from above as the photos are. A filled silhouette
 * (body, tail, two wings) in three wing poses. Each bird flaps for a few beats (up, level, down, level), then glides on level
 * wings, on its own rhythm. Each flies its own gentle arc through five or six points, from just off one edge to just off
 * another, turning to face where it is going, and fades in and out at the edges. Nearer birds (k above 1) are a little larger
 * and faster. All of it is CSS keyframes built here, transforms and opacity only.
 */

/** The bird, in a 40×40 box with its head up. The left wing is the right one mirrored. */
const mirror = (d: string): string => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${round(40 - Number(x), 2)} ${y}`);
const wings = (right: string): string => `${right} ${mirror(right)}`;
export const BIRD_BODY = "M20 11 C22.2 11.4 23 14 22.8 17 L22.2 24 L25 29.5 L20 28 L15 29.5 L17.8 24 L17.2 17 C17 14 17.8 11.4 20 11 Z";
export const BIRD_POSES = {
  /** Raised: seen from above the wings look shorter, tips swept back a little. */
  up: wings("M22.5 15.8 C26 13.6 29.5 12.4 33 12 C30.5 16 27 20 22.5 22.6 Z"),
  /** Level: the full span, as in a glide. */
  level: wings("M22.5 15.8 C27.5 14 33.5 14.2 39.2 17.6 C34 19.6 28.5 21.6 22.5 23.2 Z"),
  /** Down: shorter again, tips forward of the shoulders' line. */
  down: wings("M22.5 16.4 C27 16 31.5 17.6 35 21.4 C30 21.8 26 22.4 22.5 23 Z"),
} as const;
export type BirdPose = keyof typeof BIRD_POSES;
/**
 * The bird's look. The photos are seen from above, so a bird crosses dark trees as well as light stone: a warm deep brown body
 * (a little see-through, slightly soft so it sits in the light) with a thin sunlit rim, and a soft shadow on the ground below,
 * offset towards the low sun's far side, in percent of the picture.
 */
export const BIRD_LOOK = { fill: "#3A2616", opacity: 0.85, blur: 0.35, rim: "#F6DDB0", rimOpacity: 0.4, rimWidth: 0.8 } as const;
export const BIRD_SHADOW = { fill: "#140B04", opacity: 0.34, blur: 1.2, dx: 0.9, dy: 2.2 } as const;

export type Flight = {
  /** Waypoints in percent of the picture; the first and last sit just off its edges. */
  pts: [number, number][];
  /** Size: 1 is the base bird; nearer birds are larger and fly faster. */
  k: number;
  /** Seconds off the picture before the next crossing. */
  rest: number;
  /** Seconds into its loop the bird starts (a negative delay), so the flock is never in step. */
  dl: number;
  /** One wing-beat, in seconds; how many beats before a glide; the glide, in seconds. */
  beat: number;
  flaps: number;
  glide: number;
};
export type FlightPlan = Flight & {
  /** Seconds across the picture, from its length and its speed. */
  fly: number;
  /** The whole loop: the crossing and the rest. */
  d: number;
  /** One flap-and-glide cycle. */
  cycle: number;
  /** Width at most, in px; it shrinks with the screen. */
  w: number;
};

/** The picture's height over its width (1680×944), so a turn in y counts as much as one in x. */
const ASPECT = 944 / 1680;
/** The base bird's speed, in percent of the picture's width per second. */
export const BIRD_SPEED = 4.2;
/** The base bird's width, in px, on a wide screen. */
export const BIRD_W = 30;

/** A smooth curve through the waypoints (Catmull-Rom), as `n` steps per stretch. */
export function flightCurve(pts: [number, number][], n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** The curve's length, in percent of the picture's width. */
export const flightLength = (curve: [number, number][]): number =>
  curve.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - curve[i][0], (p[1] - curve[i][1]) * ASPECT), 0);

export function planFlight(f: Flight): FlightPlan {
  const fly = round(flightLength(flightCurve(f.pts)) / (BIRD_SPEED * f.k), 1);
  return { ...f, fly, d: round(fly + f.rest, 1), cycle: round(f.flaps * f.beat + f.glide, 2), w: Math.round(BIRD_W * f.k) };
}

/** Where the wings are at each step of one flap-and-glide cycle: four frames a beat, then level for the glide. */
export function poseFrames(f: Pick<Flight, "beat" | "flaps" | "glide">): { at: number; pose: BirdPose }[] {
  const cycle = f.flaps * f.beat + f.glide;
  const frames: { at: number; pose: BirdPose }[] = [];
  const order: BirdPose[] = ["up", "level", "down", "level"];
  for (let b = 0; b < f.flaps; b++) order.forEach((pose, j) => frames.push({ at: (b * f.beat + (j * f.beat) / 4) / cycle, pose }));
  frames.push({ at: (f.flaps * f.beat) / cycle, pose: "level" });
  return frames;
}

const pct = (n: number) => `${round(n * 100, 2)}%`;

/**
 * The CSS for one bird, as keyframes blocks named from `id`: its path (place and fade), its heading (the bird and its shadow turn
 * with it, so the shadow's offset stays the sun's), and its three wing poses.
 */
export function flightCss(id: string, f: FlightPlan): string {
  const curve = flightCurve(f.pts);
  const lens = [0];
  for (let i = 1; i < curve.length; i++) lens.push(lens[i - 1] + Math.hypot(curve[i][0] - curve[i - 1][0], (curve[i][1] - curve[i - 1][1]) * ASPECT));
  const total = lens[lens.length - 1];
  const share = f.fly / f.d;
  // Heading: the bird's head points up, so it turns by atan2(dx, -dy); unwrapped so it never spins the long way round.
  let prev = 0;
  const heads = curve.map((p, i) => {
    const a = curve[Math.max(0, i - 1)], b = curve[Math.min(curve.length - 1, i + 1)];
    let deg = (Math.atan2(b[0] - a[0], -(b[1] - a[1]) * ASPECT) * 180) / Math.PI;
    if (i > 0) while (deg - prev > 180) deg -= 360;
    if (i > 0) while (deg - prev < -180) deg += 360;
    prev = deg;
    return round(deg, 1);
  });
  const fade = 0.08;
  const path = curve.map((p, i) => {
    const t = lens[i] / total;
    const o = t < fade ? t / fade : t > 1 - fade ? (1 - t) / fade : 1;
    return `${pct(t * share)}{transform:translate(${round(p[0], 2)}%,${round(p[1], 2)}%);opacity:${round(o, 2)}}`;
  });
  const turn = curve.map((_, i) => `${pct((lens[i] / total) * share)}{transform:translate(-50%,-50%) rotate(${heads[i]}deg)}`);
  const last = curve[curve.length - 1];
  path.push(`100%{transform:translate(${last[0]}%,${last[1]}%);opacity:0}`);
  turn.push(`100%{transform:translate(-50%,-50%) rotate(${heads[heads.length - 1]}deg)}`);
  const frames = poseFrames(f);
  const pose = (name: BirdPose) => frames.map((fr) => `${pct(fr.at)}{opacity:${fr.pose === name ? 1 : 0}}`).join("") + `100%{opacity:${frames[0].pose === name ? 1 : 0}}`;
  return [
    `@keyframes ${id}-p{${path.join("")}}`,
    `@keyframes ${id}-h{${turn.join("")}}`,
    `@keyframes ${id}-up{${pose("up")}}`,
    `@keyframes ${id}-lv{${pose("level")}}`,
    `@keyframes ${id}-dn{${pose("down")}}`,
  ].join("\n");
}

/** The Forum's loose flock of five over the plaza: crossing every way, at their own sizes and speeds. */
export const FORUM_FLIGHTS: FlightPlan[] = (
  [
    { pts: [[-6, 30], [22, 22], [48, 31], [74, 24], [106, 35]], k: 1.15, rest: 6, dl: -4, beat: 0.32, flaps: 4, glide: 1.4 },
    { pts: [[106, 72], [80, 60], [56, 64], [31, 51], [-6, 57]], k: 1, rest: 9, dl: -17, beat: 0.36, flaps: 3, glide: 1.8 },
    { pts: [[20, -6], [31, 18], [45, 35], [59, 52], [73, 73], [84, 107]], k: 0.78, rest: 12, dl: -9, beat: 0.42, flaps: 5, glide: 1.2 },
    { pts: [[-6, 84], [18, 75], [40, 81], [62, 70], [86, 77], [106, 66]], k: 0.9, rest: 8, dl: -26, beat: 0.38, flaps: 4, glide: 2 },
    { pts: [[96, -6], [80, 14], [63, 22], [44, 15], [24, 27], [-6, 20]], k: 0.72, rest: 14, dl: -33, beat: 0.44, flaps: 3, glide: 1.6 },
  ] as Flight[]
).map(planFlight);

/** The Colosseum's three, high over the stands and the city beyond. */
export const COLOSSEUM_FLIGHTS: FlightPlan[] = (
  [
    { pts: [[-6, 10], [24, 6], [52, 12], [78, 7], [106, 13]], k: 1, rest: 7, dl: -5, beat: 0.34, flaps: 4, glide: 1.6 },
    { pts: [[106, 17], [80, 21], [56, 14], [30, 19], [-6, 12]], k: 0.8, rest: 11, dl: -21, beat: 0.4, flaps: 3, glide: 1.3 },
    { pts: [[-6, 26], [20, 19], [44, 9], [70, 4], [92, -6]], k: 0.9, rest: 9, dl: -13, beat: 0.37, flaps: 5, glide: 1.9 },
  ] as Flight[]
).map(planFlight);

/*
 * The Council Chamber, My Board (Roma Vivit 2, plan H-1060), over the council photos (1680×944) and under the five seats.
 * Night: ten candle flames placed on the painted ones (the two braziers, the six niche candles, the two tall candles), a warm
 * glow breathing under each brazier and tall candle, a faint moonbeam in the far doorway, a few motes in the candlelight.
 * Golden hour: light shafts slanting in from the right-hand arches, motes drifting through them, and a cloud shadow. Points
 * were measured on the photos; a flame is its base (the wick) and its size, all in percent of the picture.
 */
const pctX = (px: number) => round((px / 1680) * 100);
const pctY = (px: number) => round((px / 944) * 100);
export type Flame = { x: number; y: number; w: number; h: number; d: number; dl: number };
const flame = (bx: number, by: number, w: number, h: number, i: number): Flame => ({ x: pctX(bx), y: pctY(by), w: pctX(w), h: pctY(h), d: round(0.8 + (i % 4) * 0.17), dl: round(-(i * 0.23)) });

export const COUNCIL_FLAMES: Flame[] = [
  // The two braziers on the upper sconces.
  flame(263, 222, 26, 48, 0),
  flame(1387, 212, 24, 44, 1),
  // The back niches: three candles each, the middle one taller.
  flame(564, 176, 8, 14, 2),
  flame(577, 166, 10, 18, 3),
  flame(593, 176, 8, 14, 4),
  flame(1085, 176, 8, 14, 5),
  flame(1101, 165, 10, 18, 6),
  flame(1116, 176, 8, 14, 7),
  // The two tall candles lower down.
  flame(48, 442, 20, 38, 8),
  flame(1633, 432, 20, 38, 9),
];

/** Warm glow pools under the braziers and the tall candles: centre and radius in percent. */
export const COUNCIL_GLOWS = [
  { x: pctX(263), y: pctY(205), r: 9, d: 3.4 },
  { x: pctX(1387), y: pctY(196), r: 9, d: 3.9 },
  { x: pctX(48), y: pctY(425), r: 7, d: 3.1 },
  { x: pctX(1633), y: pctY(415), r: 7, d: 3.6 },
] as const;

/** The far doorway, where the moon shows at night: a narrow beam, in percent. */
export const COUNCIL_MOONBEAM = { x: pctX(818), y: 0, w: pctX(44), h: pctY(250) } as const;

export const COUNCIL_MOTES_NIGHT: Mote[] = Array.from({ length: 8 }, (_, i) => ({
  x: round([16, 22, 34, 66, 78, 84, 12, 90][i]),
  y: round([28, 34, 22, 22, 30, 26, 50, 48][i]),
  dx: (i % 2 ? 1 : -1) * (8 + i * 2),
  dy: -10 - (i % 3) * 6,
  d: round(8 + (i % 4) * 1.5, 1),
  dl: round(-(i * 1.1), 1),
}));

/** Golden hour: shafts of sun from the right-hand arches, each a rotated band (left, top, width, height in percent). */
export const COUNCIL_SHAFTS = [
  { x: 70, y: 8, w: 9, h: 95, rot: 38, d: 9, dl: 0 },
  { x: 80, y: 14, w: 7, h: 90, rot: 38, d: 11, dl: -3 },
  { x: 88, y: 22, w: 6, h: 80, rot: 38, d: 10, dl: -6 },
] as const;

export const COUNCIL_MOTES_DAY: Mote[] = Array.from({ length: 14 }, (_, i) => ({
  x: round(56 + ((i * 29) % 34)),
  y: round(30 + ((i * 17) % 45)),
  dx: -14 - (i % 4) * 7,
  dy: -8 - (i % 3) * 7,
  d: round(8 + (i % 5) * 1.4, 1),
  dl: round(-(i * 0.8), 1),
}));

/** The cloud shadow's crossing over the chamber floor, in seconds. */
export const COUNCIL_CLOUD_S = 60;
