/**
 * The living scenes' moments (H-327, plan H-337, PR A): the rank-up ceremony and the evening close. Pure: the ledger's own
 * numbers come in, the words and the states come out. Nothing here creates points or data; the designs
 * (docs/scenes/living-scenes-rankup.dc.html and living-scenes-closeout.dc.html) are the source of the timings and the look.
 */
import { addDays, instantOf, weekday } from "@/lib/dates";
import { TIER_RING } from "./colosseum";
import { bonusFor, countsDay, type WorkDays } from "./streak";
import { TIERS, tierFor, tierProgress, type Tier } from "./tiers";

export const RANK_COUNT = TIERS.length;
export const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;
export const roman = (n: number): string => ROMAN[n] ?? String(n);
/** The rank's file name: `public/ranks/rank-{slug}.mp4|.webm` and `rank-{slug}-end.jpg`. */
export const rankSlug = (name: string): string => name.toLowerCase();
/** Where each Colosseum ring seats a member, in the card's words. */
export const SEAT_WORDS: Record<number, string> = { 0: "the front rows", 1: "the middle stands", 2: "the upper stands", 3: "the top tier" };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmt = (n: number): string => n.toLocaleString("en-US");

/**
 * The rank to celebrate on this open, or null. `celebrated` is the highest rank the member has seen celebrated
 * (memberships.celebrated_tier_level); null means never recorded, and then nothing shows: the client stamps the current rank
 * silently so nobody is congratulated for where they already were. Several ranks crossed at once give only the highest; Artisan,
 * the starting rank, never has a ceremony.
 */
export function rankUpFor(points: number, celebrated: number | null): Tier | null {
  if (celebrated === null) return null;
  const t = tierFor(points);
  if (t.level <= 1 || t.level <= celebrated) return null;
  return t;
}

/** A rank's relic clip files under public/ranks, or null when none exist yet (the medal plays). */
export type RankClip = { mp4: string | null; webm: string | null; poster: string | null };

export type RankCard = {
  level: number;
  name: string;
  slug: string;
  numeral: string;
  eyebrow: string;
  pre: string;
  line: string;
  points: number;
  /** The 9-step ladder, bottom to top. */
  pips: ("done" | "now" | "next")[];
  ends: [string, string];
  next: { name: string; points: number; toGo: number; pct: number } | null;
  nextLine: string;
  summary: string;
};

/** The card under the window, as the design draws it. */
export function rankCard(tier: Tier, points: number): RankCard {
  const ring = TIER_RING[tier.name] ?? 3;
  const before = TIERS.find((t) => t.level === tier.level - 1);
  const ringBefore = before ? (TIER_RING[before.name] ?? 3) : 3;
  const seat = SEAT_WORDS[ring] ?? "the stands";
  const line = `You've passed ${fmt(tier.minPoints)} points. ${ring < ringBefore ? `Your seat moves up to ${seat}` : `Your seat keeps its place in ${seat}`} of the Colosseum.`;
  const p = tierProgress(points);
  const next = p.next ? { name: p.next.name, points: p.next.minPoints, toGo: p.toNext, pct: p.pct } : null;
  return {
    level: tier.level,
    name: tier.name,
    slug: rankSlug(tier.name),
    numeral: roman(tier.level),
    eyebrow: `New rank · ${roman(tier.level)} of ${roman(RANK_COUNT)}`,
    pre: "You have risen to",
    line,
    points,
    pips: TIERS.map((t) => (t.level < tier.level ? "done" : t.level === tier.level ? "now" : "next")),
    ends: [TIERS[0].name, TIERS[TIERS.length - 1].name],
    next,
    nextLine: next ? `Next: ${next.name} at ${fmt(next.points)}` : "The top of the ladder. Every point from here is a victory lap.",
    summary: `New rank: ${tier.name}, ${roman(tier.level)} of ${roman(RANK_COUNT)}. ${line}${next ? ` Next: ${next.name} at ${fmt(next.points)}, ${fmt(next.toGo)} to go.` : ""}`,
  };
}

/** How long after the close the scene may still play: a reload later than this shows nothing. */
export const CLOSE_SCENE_WINDOW_MS = 10 * 60 * 1000;

export type CloseScene = {
  /** The close's own ledger row: the key the browser remembers, so the scene plays once per close. */
  id: string;
  /** The credit that row carries, never computed again. */
  credit: number;
  eyebrow: string;
  title: string;
  line: string;
  creditLine: string;
  tomorrow: string;
  summary: string;
};

/** "Tomorrow is Saturday: +40 for showing up", from the streak engine's own rule for the day after the close. */
export function tomorrowLine(day: string, days: WorkDays, ladder: Set<string>): string {
  const tomorrow = addDays(day, 1);
  const name = DAY_NAMES[weekday(tomorrow)];
  if (!countsDay(tomorrow, days)) return `Tomorrow is ${name}. Your fire rests until Monday.`;
  const active = new Set(ladder);
  active.add(day);
  const b = bonusFor(active, tomorrow, days);
  if (!b.points) return `Tomorrow is ${name}. Show up and the fire keeps burning.`;
  return `Tomorrow is ${name}: +${b.points} for showing up${b.streakDay > 1 ? ` (streak day ${b.streakDay})` : ""}.`;
}

/**
 * The evening close's scene for a close just written, or null: no close row, or one older than the window. The credit is
 * the ledger row's own points.
 */
export function closeSceneFor(a: { row: { id: string; points: number; createdAt: string } | null; now: number; day: string; streak: number; days: WorkDays; ladder: Set<string> }): CloseScene | null {
  if (!a.row) return null;
  const age = a.now - instantOf(a.row.createdAt).getTime();
  if (!(age >= -60_000 && age <= CLOSE_SCENE_WINDOW_MS)) return null;
  const line = a.streak >= 2 ? `Every lamp is yours tonight. Your ${a.streak}-day fire carries into tomorrow.` : "Every lamp is yours tonight. Your fire is lit for tomorrow.";
  const tomorrow = tomorrowLine(a.day, a.days, a.ladder);
  return {
    id: a.row.id,
    credit: a.row.points,
    eyebrow: "Day closed",
    title: "The arena is lit.",
    line,
    creditLine: `+${a.row.points} for closing out the day`,
    tomorrow,
    summary: `Day closed. The arena is lit. Plus ${a.row.points} for closing out the day. ${tomorrow}`,
  };
}
