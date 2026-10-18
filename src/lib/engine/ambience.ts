/**
 * Roma Vivit (H-327 PR B, plan H-637): the always-on ambience under the big picture scenes. Pure data, copied from the approved
 * mockups in docs/scenes (living-scenes-colosseum.dc.html for now): where each twinkle, mote and bird sits, in percent of the
 * 1680×944 picture, and its timing in seconds. Nothing here reads or writes data; it only draws over the photos.
 */

/** A point in percent of the picture, with a duration and a delay in seconds. */
export type Twinkle = { x: number; y: number; d: number; dl: number };
export type Mote = { x: number; y: number; dx: number; dy: number; d: number; dl: number };
export type Bird = { y: number; d: number; dl: number };

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

/** Three birds crossing high over the stands, at golden hour. */
export const COLOSSEUM_BIRDS: Bird[] = [
  { y: 9, d: 22, dl: 0 },
  { y: 13, d: 26, dl: -6 },
  { y: 7, d: 30, dl: -15 },
];

/** The cloud shadow's crossing, in seconds: about one every 48 s. */
export const COLOSSEUM_CLOUD_S = 48;

/** The browser's mark that the top-3 cheer played for this member this week: once a week, never on a reload. */
export const top3CheerKey = (membershipId: string, monday: string): string => `hx-top3-${membershipId}-${monday}`;

/**
 * The Aqueduct's "none" picture (H-327 §4): falling streaks over the painted waterfall, a mist pulse at its foot, and a spray
 * and ripple at the fountain, in the 1680×944 viewBox. Golden hour is the mockup's (living-scenes-aqueduct.dc.html); the night
 * picture's waterfall starts about 60 px higher, so its streaks are matched to that picture by eye.
 */
export type Fountain = {
  streaks: { d: string; dl: number }[];
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
    streaks: [
      { d: "M1392,392 C1410,450 1425,520 1430,612", dl: 0 },
      { d: "M1408,388 C1428,450 1442,525 1448,618", dl: -0.2 },
      { d: "M1424,392 C1444,455 1456,530 1462,622", dl: -0.45 },
      { d: "M1440,400 C1458,460 1468,535 1472,620", dl: -0.3 },
    ],
    mist: { cx: 1452, cy: 628, rx: 60, ry: 18 },
    spray: SPRAY,
    ripple: { cx: 1530, cy: 636, rx: 46, ry: 11 },
  },
  night: {
    streaks: [
      { d: "M1392,332 C1412,420 1428,520 1432,606", dl: 0 },
      { d: "M1408,328 C1430,420 1444,525 1450,610", dl: -0.2 },
      { d: "M1424,332 C1446,425 1458,530 1464,614", dl: -0.45 },
      { d: "M1440,340 C1460,430 1470,535 1474,612", dl: -0.3 },
    ],
    mist: { cx: 1455, cy: 614, rx: 60, ry: 18 },
    spray: SPRAY,
    ripple: { cx: 1530, cy: 634, rx: 46, ry: 11 },
  },
};

/*
 * The Forum (H-327 §5, docs/scenes/living-scenes-forum.dc.html), under the messengers. Night: the same three-copy flicker,
 * a light pool breathing over the plaza, the welcome's small flame on the centre column, fireflies in the gardens. Golden
 * hour: five doves flying an oval over the plaza (x and y each easing back and forth, a quarter turn apart) and a cloud.
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

/** The doves' oval in percent of the picture, the half-lap in seconds, and each dove's delays (x, y, wing). */
export const FORUM_DOVE_OVAL = { x: [32.1, 67.9], y: [32.8, 64.6], s: 13 } as const;
export const FORUM_DOVES = [0, 1, 2, 3, 4].map((i) => ({ dx: round(-(i * 2.6), 1), dy: round(-(i * 2.6) - 6.5, 1), fl: round(-(i * 0.13)) }));

/** The cloud shadow's crossing over the Forum, in seconds. */
export const FORUM_CLOUD_S = 52;
