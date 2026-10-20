import { sceneLookFor, type SceneLook } from "@/lib/engine/board-view";

/**
 * The Aqueduct (rev 711): the member's lead pipeline as a Roman aqueduct, the leak at the weakest step. Pure: the stages and
 * steps, the period windows, each step's rate, the leak rule (the step whose rate fell the most against the previous period,
 * by at least five points, skipping any step with a zero denominator), which picture, the water's geometry and colours, the
 * waterfall per picture, the tags' anchors and the words under the scene. Nothing here invents a count.
 */
export const STAGES = ["Posts", "Comments", "DMs started", "Conversations", "Calls booked", "Calls held", "Offers made", "Clients"] as const;
/** Step b runs from stage b+1 to stage b+2: six steps, comments → DMs through offers → clients. Comments per post are not a step. */
export const STEP_LABELS = ["to DMs", "to conversations", "booked a call", "showed up", "heard an offer", "became clients"] as const;
export const STEP_TOOLS = [
  { name: "comment ladders", href: "/content/ladders" },
  { name: "Conversations", href: "/conversations" },
  { name: "the DM library", href: "/conversations/playbook" },
  { name: "calls", href: "/socrates" },
  { name: "the Call sheet", href: "/socrates/scripts" },
  { name: "offers", href: "/offers" },
] as const;
export const PERIODS = [30, 7] as const;
export type PeriodDays = (typeof PERIODS)[number];
export const MIN_DROP_POINTS = 5;
export const NARROW_PX = 760;
export const PICTURE = { width: 1680, height: 944 } as const;

/** A stage's count over a period; null when HelixOS has no data for it yet. */
export type Counts = (number | null)[];

/** The windows, inclusive YYYY-MM-DD: the last `days` days ending today, and the `days` before them. */
export function windows(today: string, days: PeriodDays): { now: [string, string]; before: [string, string] } {
  const d = (n: number) => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    return t.toISOString().slice(0, 10);
  };
  return { now: [d(days - 1), today], before: [d(2 * days - 1), d(days)] };
}

/** Step b's rate, stage b+2 ÷ stage b+1; null when either count is missing or the denominator is zero. */
export function stepRate(counts: Counts, b: number): number | null {
  const from = counts[b + 1];
  const to = counts[b + 2];
  if (from === null || from === undefined || to === null || to === undefined || from <= 0) return null;
  return to / from;
}

export type Leak = { step: number; nowRate: number; wasRate: number; drop: number };
/** The leak: the step whose rate fell the most in percentage points, by at least five, with both periods' rates known. */
export function leakOf(now: Counts, before: Counts): Leak | null {
  let best: Leak | null = null;
  for (let b = 0; b < 6; b++) {
    const nowRate = stepRate(now, b);
    const wasRate = stepRate(before, b);
    if (nowRate === null || wasRate === null) continue;
    // In points, settled to a millionth so a drop of exactly five is five and not 4.999999.
    const drop = Math.round((wasRate - nowRate) * 100 * 1e6) / 1e6;
    if (drop < MIN_DROP_POINTS) continue;
    if (!best || drop > best.drop) best = { step: b, nowRate, wasRate, drop };
  }
  return best;
}

export const aqueductLook = (setting: "auto" | "day" | "night", hour: number): SceneLook => sceneLookFor(setting, hour);
/** The picture, without its extension: the leak's step, or the intact aqueduct with a full fountain. */
export const pictureFor = (look: SceneLook, leak: Leak | null): string => `/aqueduct/aqueduct-${look}-${leak ? leak.step : "none"}`;

/** The filmed loops (H-1180) live with every scene's in scene-loops.ts; the Aqueduct's water is the first of them. */
export { loopFor } from "@/lib/engine/scene-loops";

/** "About N people slipped through this arch": what the previous rate would have carried, less what did; at least one. And E, the usual. */
export function slipped(now: Counts, leak: Leak): { n: number; expected: number } {
  const from = now[leak.step + 1] ?? 0;
  const to = now[leak.step + 2] ?? 0;
  const expected = Math.round(from * leak.wasRate);
  return { n: Math.max(1, expected - to), expected };
}

/** The water along the channel, the same for all 14 pictures: each segment's path and the stage whose count sets its width. */
export const SEGMENTS = [
  { key: "src", d: "M185,266 C240,280 300,293 360,300", stage: 1 },
  { key: "s0", d: "M360,300 C420,305 470,307 520,309", stage: 2 },
  { key: "s1", d: "M520,309 L700,312", stage: 3 },
  { key: "s2", d: "M700,312 L880,312", stage: 4 },
  { key: "s3", d: "M880,312 L1060,310", stage: 5 },
  { key: "s4", d: "M1060,310 L1240,306", stage: 6 },
  { key: "out", d: "M1240,306 L1378,303 C1440,330 1500,480 1528,598", stage: 7 },
] as const;
/** 3 + 11·√(count ÷ comments) px; the thinnest water when comments are unknown or none. */
export function waterWidth(count: number | null | undefined, comments: number | null | undefined): number {
  if (!count || !comments || comments <= 0) return 3;
  return Math.round((3 + 11 * Math.sqrt(count / comments)) * 100) / 100;
}
/**
 * The water (H-966, plan H-971): a body along each segment, lighter at the edges and deeper in the middle, partly see-through,
 * with three flow layers running over it at their own speeds (soft ripple bands, streaks in two lanes, a sparse sparkle). Every
 * layer's width is a share of the segment's width, with a floor so the thinnest water still shows them. Each dash pattern's
 * period divides RUN_PERIOD, so one keyframes block (`aq-run`, to -RUN_PERIOD) runs them all and loops without a jump.
 */
export const RUN_PERIOD = 144;
export type FlowLayer = { key: "band" | "streak-a" | "streak-b" | "spark"; array: string; width: number; min: number; lane: number; alpha: number; seconds: number };
export const FLOW: FlowLayer[] = [
  { key: "band", array: "36 36", width: 0.78, min: 2, lane: 0, alpha: 0.2, seconds: 7.2 },
  { key: "streak-a", array: "16 20", width: 0.13, min: 1.2, lane: -0.24, alpha: 0.6, seconds: 3.6 },
  { key: "streak-b", array: "12 36", width: 0.1, min: 1, lane: 0.22, alpha: 0.5, seconds: 4.5 },
  { key: "spark", array: "0.1 71.9", width: 0.2, min: 2.2, lane: -0.08, alpha: 0.95, seconds: 5.1 },
];
/** The period of a dash pattern, in the picture's units. */
export const dashPeriod = (array: string): number => array.split(/\s+/).reduce((sum, n) => sum + Number(n), 0);
/** A layer's stroke width on water `w` wide. */
export const flowWidth = (layer: FlowLayer, w: number): number => Math.round(Math.max(layer.min, w * layer.width) * 100) / 100;
/** The body: an edge stroke as wide as the water, a deeper core 60% as wide over it. */
export const BODY = { core: 0.6 } as const;
export const WATER = {
  day: { edge: "#BFE8F7", edgeAlpha: 0.55, deep: "#3D93BD", deepAlpha: 0.55, dash: "#FFFFFF", blend: "normal" },
  night: { edge: "#7FE3FF", edgeAlpha: 0.45, deep: "#2D86B0", deepAlpha: 0.5, dash: "#E6FBFF", blend: "screen" },
} as const;

/** The whole channel as one path, from the source to the fountain, for the water front when the channel fills. */
export const CHANNEL = SEGMENTS.map((seg, i) => (i === 0 ? seg.d : seg.d.replace(/^M[^CL]+/, ""))).join(" ");
/** The channel fills when the scene opens: the front runs from the source to the fountain in this many seconds. */
export const FILL_SECONDS = 2.4;

/** A path's length, for the absolute M, L and C commands the channel uses (each curve measured in 32 steps). */
export function pathLength(d: string): number {
  const tokens = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  let i = 0;
  let cmd = "M";
  let at: [number, number] = [0, 0];
  let len = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLC]/.test(tokens[i])) cmd = tokens[i++];
    if (cmd === "M") {
      at = [num(), num()];
      cmd = "L";
    } else if (cmd === "L") {
      const to: [number, number] = [num(), num()];
      len += Math.hypot(to[0] - at[0], to[1] - at[1]);
      at = to;
    } else {
      const c1 = [num(), num()], c2 = [num(), num()], to: [number, number] = [num(), num()];
      let prev = at;
      for (let k = 1; k <= 32; k++) {
        const t = k / 32, u = 1 - t;
        const p: [number, number] = [0, 1].map((j) => u * u * u * at[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t * t * t * to[j]) as [number, number];
        len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
      }
      at = to;
    }
  }
  return Math.round(len * 10) / 10;
}
export const CHANNEL_LENGTH = pathLength(CHANNEL);
/** When the front reaches a point x along the channel, in seconds: what waits for the water (a leak's fall, the fountain). */
export const frontReaches = (x: number): number => Math.round(Math.min(1, Math.max(0, (x - 185) / (1528 - 185))) * FILL_SECONDS * 100) / 100;

/**
 * Falling water (the leak, H-966): a sheet that widens as it falls and sways a little, with streaks falling through it at their
 * own speeds and widths. `dx` is a streak's offset at the foot; it starts at 40% of that under the lip. Every streak's period
 * divides DROP_PERIOD, for the one `aq-drop` keyframes block.
 */
export const DROP_PERIOD = 120;
export const FALL_STREAKS = [
  { dx: -9, w: 1.6, array: "14 26", seconds: 0.75 },
  { dx: -4, w: 2.4, array: "22 18", seconds: 0.6 },
  { dx: 1, w: 1.4, array: "10 20", seconds: 0.9 },
  { dx: 5, w: 2, array: "18 22", seconds: 0.7 },
  { dx: 9.5, w: 1.2, array: "8 22", seconds: 1 },
] as const;
/** The sheet's outline for a fall at x from top to bottom: 8 wide at the lip, 26 at the foot. */
export function fallSheet(x: number, top: number, bottom: number): string {
  const h = bottom - top;
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M${r(x - 4)},${top} L${r(x + 4)},${top} C${r(x + 6.5)},${r(top + h * 0.4)} ${r(x + 10)},${r(top + h * 0.75)} ${r(x + 13)},${bottom} L${r(x - 13)},${bottom} C${r(x - 10)},${r(top + h * 0.75)} ${r(x - 6.5)},${r(top + h * 0.4)} ${r(x - 4)},${top} Z`;
}

/** The waterfall per picture, [x, top, bottom, poolCx, poolCy, poolRx, poolRy], matched to the one painted in. */
export const FALLS: Record<SceneLook, number[][]> = {
  day: [
    [440, 400, 780, 445, 790, 95, 28],
    [565, 520, 760, 600, 768, 85, 24],
    [735, 505, 750, 750, 768, 90, 26],
    [897, 395, 760, 920, 768, 95, 28],
    [1165, 470, 690, 1165, 690, 70, 20],
    [1213, 420, 690, 1205, 692, 60, 15],
  ],
  night: [
    [416, 396, 780, 417, 790, 58, 18],
    [528, 395, 750, 523, 770, 57, 17],
    [624, 420, 730, 624, 738, 40, 13],
    [890, 392, 760, 910, 768, 72, 22],
    [1038, 400, 690, 1057, 705, 34, 11],
    [1185, 381, 730, 1193, 745, 42, 13],
  ],
};
export const RIPPLE = { from: 0.4, to: 1.5, seconds: 2.4, secondDelay: 1.2 } as const;
/** Stage pills, anchored bottom-centre, stages 0 to 7. */
export const STAGE_TAG_AT = [
  [165, 125],
  [360, 286],
  [520, 294],
  [700, 297],
  [880, 297],
  [1060, 295],
  [1240, 291],
  [1505, 410],
] as const;
/** Step tags, centred, steps 0 to 5. */
export const STEP_TAG_AT = [
  [440, 470],
  [610, 470],
  [790, 470],
  [970, 470],
  [1150, 470],
  [1300, 455],
] as const;
export const LEAK_TAG = "rgba(150,78,22,.88)";

export const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);
export const count = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : n.toLocaleString());

/** One quiet line for the stages with no data yet, or null. */
export function missingLine(counts: Counts): string | null {
  const names = STAGES.filter((_, i) => counts[i] === null || counts[i] === undefined);
  if (!names.length) return null;
  return `No count yet for ${names.join(", ")}: the steps either side are left out until there is one.`;
}

/** The question "Ask My Board how to fix it" opens with. */
export function boardQuestion(leak: Leak): string {
  return `My ${STAGES[leak.step + 1].toLowerCase()} → ${STAGES[leak.step + 2].toLowerCase()} rate fell from ${pct(leak.wasRate)} to ${pct(leak.nowRate)}. What should I change first?`;
}
