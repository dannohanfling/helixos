/**
 * The Daily welcome (H-312, plan H-314): what the card says and shows the first time a member opens HelixOS each day. Pure:
 * the numbers come in from the one streak read (the ledger's own credits, never a copy of the values), the words and the coins
 * come out. The design (docs/welcome/daily-welcome-v1.dc.html) is the source of the timings and the look.
 */
import { addDays, isWeekday, startOfWeek, weekday } from "@/lib/dates";
import { bonusFor, countsDay, type WorkDays } from "./streak";

/** The fire's stages, day 1 to day 7 and up. */
export const FIRE_STAGES = ["Ember", "Spark", "Kindling", "Flame", "Blaze", "Bonfire", "Beacon"] as const;
/** The flame's scale and glow by stage (index 0 is "no fire yet": a streak of 0, the moment before today's open lights it). */
export const FLAME_SCALE = [0.22, 0.45, 0.55, 0.66, 0.76, 0.86, 0.94, 1] as const;
export const FLAME_GLOW = [0.15, 0.3, 0.4, 0.5, 0.6, 0.72, 0.86, 1] as const;
/** Sparks rise from stage 5 up. */
export const SPARKS_FROM_STAGE = 5;
/** The fire stage for a streak: min(streak, 7); 0 before the first day. */
export const fireStage = (streak: number): number => Math.max(0, Math.min(7, Math.floor(streak)));
export const fireName = (streak: number): string => FIRE_STAGES[Math.max(0, fireStage(streak) - 1)];

/**
 * Milestones in days in the arena (H-312 §6): the days, the laurel each gives and the bonus. Rewards stay off (no panel, no
 * laurel, no points) until Danno answers in the inbox; the days and the next-milestone caption show either way.
 */
export const MILESTONES = [30, 50, 100, 365] as const;
export const MILESTONE_REWARDS_ON = false;
export const MILESTONE_LAUREL: Record<number, "bronze" | "silver" | "gold"> = { 50: "bronze", 100: "silver", 365: "gold" };
export const MILESTONE_BONUS: Record<number, number> = { 30: 100, 50: 250, 100: 500, 365: 1000 };
const DAY_WORDS: Record<number, string> = { 30: "Thirty", 50: "Fifty", 100: "A hundred", 365: "A year" };

/** The next milestone past `days`, and the bar from the one before it. */
export function arenaProgress(days: number): { next: number | null; prev: number; fraction: number; caption: string } {
  const next = MILESTONES.find((m) => m > days) ?? null;
  const prev = [...MILESTONES].reverse().find((m) => m <= days) ?? 0;
  if (!next) return { next: null, prev, fraction: 1, caption: "Every day from here is a victory lap." };
  const left = next - days;
  return { next, prev, fraction: Math.max(0, Math.min(1, (days - prev) / (next - prev))), caption: `${left} ${left === 1 ? "day" : "days"} to your Day ${next} laurel.` };
}

export type CoinState = "done" | "today" | "next" | "missed" | "off";
export type Coin = { date: string; label: string; state: CoinState; amount: number | null };
const DAY_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * This week's seven coins, Monday to Sunday: struck gold for days already credited (their amount), today's coin with the day's
 * credit, bronze for the days ahead with what they would be worth if the streak holds, a dashed ring for a day missed, and an
 * empty slot for a day that never counts (a Monday to Friday member's weekend).
 */
export function weekCoins(args: { today: string; days: WorkDays; active: Set<string>; ladder: Set<string>; paid: Map<string, number>; todayBonus: number }): Coin[] {
  const monday = startOfWeek(args.today);
  const out: Coin[] = [];
  // The days ahead, as if every day from today on were active.
  const ahead = new Set(args.ladder);
  for (let d = args.today; d <= addDays(monday, 6); d = addDays(d, 1)) ahead.add(d);
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const label = DAY_LABELS[weekday(date)];
    if (!countsDay(date, args.days)) out.push({ date, label, state: "off", amount: null });
    else if (date < args.today) {
      if (args.paid.has(date)) out.push({ date, label, state: "done", amount: args.paid.get(date)! });
      else if (args.active.has(date)) out.push({ date, label, state: "done", amount: bonusFor(args.ladder, date, args.days).points });
      else out.push({ date, label, state: "missed", amount: null });
    } else if (date === args.today) out.push({ date, label, state: "today", amount: args.todayBonus });
    else out.push({ date, label, state: "next", amount: bonusFor(ahead, date, args.days).points });
  }
  return out;
}

export type WelcomeCopy = { eyebrow: string; title: string; line: string };
/** The header's three lines by the day's state. No exclamation marks, no scolding. */
export function welcomeCopy(a: { first: string; streak: number; comeback: boolean; today: string; days: WorkDays; todayBonus: number; daysInArena: number; milestone: number | null }): WelcomeCopy {
  const first = a.first || "there";
  if (a.milestone) return { eyebrow: `Ave, ${first}`, title: `Day ${a.milestone} in the arena.`, line: `${DAY_WORDS[a.milestone] ?? a.milestone} days of showing up. This is how it compounds.` };
  if (a.comeback) return { eyebrow: `Welcome back, ${first}`, title: "Back in the arena.", line: "Day 1 starts now. Your days in the arena never reset." };
  const stage = fireStage(a.streak);
  if (!isWeekday(a.today) && a.days === "all") {
    const dayName = weekday(a.today) === 6 ? "Saturday" : "Sunday";
    return { eyebrow: `Ave, ${first}`, title: `Day ${a.streak}. Weekends count too.`, line: a.todayBonus ? `${dayName} adds ${a.todayBonus} points and keeps your fire lit.` : `${dayName} keeps your fire lit.` };
  }
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday(a.today)];
  const line =
    stage >= 7
      ? `Your fire is at full strength. ${weekday(a.today) === 5 ? "Friday is the biggest day of the week." : `${dayName} is worth ${a.todayBonus} points.`}`
      : weekday(a.today) === 1
        ? `Monday starts the ladder again. Your fire is a${/^[aeiou]/i.test(fireName(a.streak)) ? "n" : ""} ${fireName(a.streak).toLowerCase()}.`
        : `Your fire is a${/^[aeiou]/i.test(fireName(a.streak)) ? "n" : ""} ${fireName(a.streak).toLowerCase()}. ${dayName} is worth ${a.todayBonus} points.`;
  return { eyebrow: `Ave, ${first}`, title: `Day ${a.streak} of your streak.`, line };
}

export type WelcomeCard = {
  look: "day" | "night";
  copy: WelcomeCopy;
  streak: number;
  streakOld: number;
  stage: number;
  stageOld: number;
  points: number;
  pointsOld: number;
  todayBonus: number;
  coins: Coin[];
  daysInArena: number;
  daysOld: number;
  progress: ReturnType<typeof arenaProgress>;
  /** The milestone panel, only on a milestone day with rewards on. */
  milestone: { days: number; laurel: "bronze" | "silver" | "gold" | null; bonus: number } | null;
  lockedIn: boolean;
  /** One line for a screen reader. */
  summary: string;
};

/** The whole card from the day's numbers. */
export function welcomeCard(a: {
  look: "day" | "night";
  first: string;
  today: string;
  days: WorkDays;
  active: Set<string>;
  ladder: Set<string>;
  paid: Map<string, number>;
  streak: number;
  points: number;
  todayBonus: number;
  /** Whether today was already active before this open (a lock-in earlier, or a second device): then nothing rolls. */
  wasActiveToday: boolean;
  lockedIn: boolean;
}): WelcomeCard {
  const daysInArena = a.active.size;
  const comeback = a.streak <= 1 && daysInArena > 1 && !a.active.has(addDays(a.today, -1));
  const milestoneDay = MILESTONES.find((m) => m === daysInArena) ?? null;
  const milestone = MILESTONE_REWARDS_ON && milestoneDay ? { days: milestoneDay, laurel: MILESTONE_LAUREL[milestoneDay] ?? null, bonus: MILESTONE_BONUS[milestoneDay] ?? 0 } : null;
  const copy = welcomeCopy({ first: a.first, streak: a.streak, comeback, today: a.today, days: a.days, todayBonus: a.todayBonus, daysInArena, milestone: milestone?.days ?? null });
  const streakOld = a.wasActiveToday ? a.streak : Math.max(0, a.streak - 1);
  const daysOld = a.wasActiveToday ? daysInArena : Math.max(0, daysInArena - 1);
  const pointsOld = a.wasActiveToday ? a.points : a.points - a.todayBonus;
  return {
    look: a.look,
    copy,
    streak: a.streak,
    streakOld,
    stage: fireStage(a.streak),
    stageOld: fireStage(streakOld),
    points: a.points,
    pointsOld,
    todayBonus: a.todayBonus,
    coins: weekCoins({ today: a.today, days: a.days, active: a.active, ladder: a.ladder, paid: a.paid, todayBonus: a.todayBonus }),
    daysInArena,
    daysOld,
    progress: arenaProgress(daysInArena),
    milestone,
    lockedIn: a.lockedIn,
    summary: `Day ${a.streak} streak. Plus ${a.todayBonus} points. ${daysInArena} days in the arena.`,
  };
}
