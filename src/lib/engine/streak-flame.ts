/**
 * The streak flame (H-552, plan H-558): the tiers, the state the pill shows, when the daily surge is due, and the surge's
 * envelope. Pure, so the pill, the sheet, the layout and the tests all read the same rules. No new scoring: the streak is
 * the one the daily loop already keeps (`streakFor`).
 */

export type FlameTier = "ember" | "torch" | "gold";
/** What the fire draws: a tier, or the dim, still ember of a day not closed yet. */
export type FlameLook = FlameTier | "risk";

/** The shader's settings per look (the approved Cowork mockup). `speed` scales its clock. */
export type FlameSettings = { h: number; heat: number; gold: number; sparks: number; speed: number };

export const FLAME_SETTINGS: Record<FlameLook, FlameSettings> = {
  ember: { h: 0.52, heat: 0.85, gold: 0, sparks: 0.45, speed: 0.8 },
  torch: { h: 0.84, heat: 1.0, gold: 0, sparks: 1, speed: 1 },
  gold: { h: 0.86, heat: 1.06, gold: 1, sparks: 1, speed: 1 },
  // Not done yet: lower, cooler and still; no sparks.
  risk: { h: 0.42, heat: 0.62, gold: 0, sparks: 0, speed: 0 },
};

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
  /** The day waiting is yesterday (the late close-out window), not today. */
  late: boolean;
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
  return { days, tier: flameTier(days), waiting, late: waiting && i.asOf !== i.today, surge: surgeDue(i), day: i.asOf };
}

/** Where the sheet's own button goes while the day waits (H-927): straight to the close on Today, named for the day it closes. */
export const CLOSE_HREF = "/today#close";

export function sheetAction(s: Pick<FlameState, "waiting" | "late">): { label: string; href: string } | null {
  if (!s.waiting) return null;
  return { label: s.late ? "Close yesterday" : "Close the day", href: CLOSE_HREF };
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

/** The bar's narrower fire; the sheet draws at full width. */
export const BAR_WIDTH = 1.7;

/** The uniforms for one frame: about 30% taller and hotter at the surge's peak, sparks off in the bar. */
export function flameUniforms(look: FlameLook, boost: number, place: "bar" | "stage"): { uH: number; uHeat: number; uGold: number; uSparks: number; uW: number } {
  const c = FLAME_SETTINGS[look];
  const b = look === "risk" ? 0 : Math.max(0, boost);
  return {
    uH: Math.min(c.h * (1 + 0.32 * b), 1),
    uHeat: c.heat * (1 + 0.35 * b),
    uGold: c.gold,
    uSparks: place === "bar" ? 0 : c.sparks * (1 + 1.5 * b),
    uW: place === "bar" ? BAR_WIDTH : 1,
  };
}

/** The clock a still frame is drawn at (reduced motion, and the waiting ember). */
export const STILL_TIME = 1.7;

/** Device pixel ratio, capped at 2. */
export function cappedDpr(dpr: number | undefined): number {
  return Math.min(Math.max(dpr || 1, 1), 2);
}
