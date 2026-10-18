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
