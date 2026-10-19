/**
 * The streak flame (H-552, plan H-558): the tiers, the state the pill shows, when the daily surge is due, and the surge's
 * envelope, and which filmed loop each look plays (H-952). Pure, so the pill, the sheet, the layout and the tests all read the same rules. No new scoring: the streak is
 * the one the daily loop already keeps (`streakFor`).
 */

export type FlameTier = "ember" | "torch" | "gold";
/** What the fire draws: a tier, or the dim, still ember of a day not closed yet. */
export type FlameLook = FlameTier | "risk";

export const FLAME_TIERS: { tier: FlameTier; name: string; from: number }[] = [
  { tier: "ember", name: "Ember", from: 1 },
  { tier: "torch", name: "Torch", from: 7 },
  { tier: "gold", name: "Gold flame", from: 30 },
];

/** Ember 1 to 6 days, Torch 7 to 29, Gold flame 30 and up. */
export function flameTier(days: number): FlameTier {
  return days >= 30 ? "gold" : days >= 7 ? "torch" : "ember";
}

export function tierName(tier: FlameTier): string {
  return FLAME_TIERS.find((t) => t.tier === tier)!.name;
}

/** The next tier and the days to it, or null at the top. */
export function nextTier(days: number): { name: string; days: number } | null {
  const next = FLAME_TIERS.find((t) => t.from > days);
  return next ? { name: next.name, days: next.from - days } : null;
}

/** The sheet's line under the tier: "3 days to Torch", "1 day to Gold flame", "Top tier". */
export function nextTierLine(days: number): string {
  const n = nextTier(days);
  return n ? `${n.days} ${n.days === 1 ? "day" : "days"} to ${n.name}` : "Top tier";
}

/** The pill's accessible name. */
export function flameLabel(days: number): string {
  return `${days}-day streak. Open streak details`;
}

/** From this hour in the member's own zone (when Today unfolds the close form), a day not closed yet shows as waiting. */
export const WAITING_FROM_HOUR = 16;

export type FlameState = {
  /** The count the pill shows: a missed day starts again at Day 1. */
  days: number;
  tier: FlameTier;
  /** "Waiting on you": the dim, still ember and the amber chip. */
  waiting: boolean;
  /** The daily surge is due on this open. */
  surge: boolean;
  /** The streak day the surge is for, stored once it has played. */
  day: string;
};

export type FlameInput = {
  running: number;
  /** The streak day it's read as of (yesterday inside the late close-out window, else today). */
  asOf: string;
  today: string;
  hour: number;
  active: Set<string>;
  closed: Set<string>;
  /** `memberships.streak_surge_seen_on`. */
  seenOn: string | null;
};

export function flameStateOf(i: FlameInput): FlameState {
  const days = Math.max(1, i.running);
  // Late close-out window: yesterday is still the day and isn't closed. Otherwise today, from 4 pm until it's closed.
  const waiting = i.asOf !== i.today ? !i.closed.has(i.asOf) : i.hour >= WAITING_FROM_HOUR && !i.closed.has(i.today);
  return { days, tier: flameTier(days), waiting, surge: surgeDue(i), day: i.asOf };
}

/** Once per streak day: the day has counted (shown up) and the surge hasn't played for it yet. */
export function surgeDue(i: Pick<FlameInput, "running" | "asOf" | "active" | "seenOn">): boolean {
  return i.running >= 1 && i.active.has(i.asOf) && i.seenOn !== i.asOf;
}

/** How long the surge lasts, in seconds. */
export const SURGE_SECONDS = 2.2;

/** The surge's swell, 0 to under 1, `since` seconds after it started: up and back down over 2.2 s (the mockup's draw()). */
export function surgeEnvelope(since: number): number {
  if (!(since >= 0) || since >= SURGE_SECONDS) return 0;
  return Math.sin(Math.min(since / SURGE_SECONDS, 1) * Math.PI) * Math.exp(-since * 0.6);
}

/**
 * The filmed loops (H-952): per tier, a pill (360x540) for the top bar and the sidebar, a stage (1280x720) for the sheet, and
 * a still for reduced motion and a video that won't play. Photoreal fire on true black, so a screen blend lets the dark UI
 * show through. The waiting ember is the Ember loop, dimmed and slowed.
 */
export type FlameClip = {
  /** H.264, listed first: the phone's hardware decoder starts it sooner than VP9 (H-1063). */
  mp4: string;
  /** VP9, a computer's second choice; none on a phone. */
  webm: string | null;
  /** Shown at once, before and under the video: the loop's first frame on a phone, the tier's still on a computer. */
  poster: string;
  /** The tier's last frame: reduced motion's picture. */
  still: string;
  rate: number;
  /** Waiting on you: how dark the overlay laid over the flame is (0 = none). A layer, never a filter on the video. */
  dim: number;
};

const FLAME_FILE: Record<FlameLook, FlameTier> = { ember: "ember", torch: "torch", gold: "gold", risk: "ember" };

/** Bumped when a flame file is swapped under the same name: the files are cached for a year as immutable. */
export const FLAME_FILES_VERSION = 2;

/**
 * The files for a look and a place. A phone (`mobile`) gets the light copies (pill 160x240, stage 854x480, MP4 only) and
 * their first-frame posters; a computer keeps the full loops with the still as the poster.
 */
export function flameClip(look: FlameLook, place: "bar" | "stage", mobile = false): FlameClip {
  const base = `/streak/streak-${FLAME_FILE[look]}`;
  const size = place === "bar" ? "pill" : "stage";
  const waiting = look === "risk";
  const v = `?v=${FLAME_FILES_VERSION}`;
  const still = `${base}-still.jpg${v}`;
  const common = { still, rate: waiting ? 0.7 : 1, dim: waiting ? 0.4 : 0 };
  if (mobile) return { mp4: `${base}-${size}-m.mp4${v}`, webm: null, poster: `${base}-${size}-m-poster.jpg${v}`, ...common };
  return { mp4: `${base}-${size}.mp4${v}`, webm: `${base}-${size}.webm${v}`, poster: still, ...common };
}

/** The surge drawn over the loop: up to about 30% larger with a glow layer behind it at its peak; the waiting ember never swells. */
export function surgeLook(look: FlameLook, boost: number): { scale: number; glow: number } {
  const b = look === "risk" ? 0 : Math.max(0, Math.min(boost, 1));
  return { scale: 1 + 0.3 * b, glow: b };
}
