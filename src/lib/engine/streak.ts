import { addDays, daysBetween, isWeekday, startOfWeek } from "@/lib/dates";

/**
 * Streak rules (from the HelixOS Daily Hashtag quest):
 * - Only weekdays count. Weekends never break a streak and never extend it.
 * - The escalating bonus resets every Monday: day 1 = 10, day 2 = 20, day 3 = 40, day 4 = 80, day 5 = 160.
 * - Miss a weekday and the escalation drops back to day 1.
 */
export const STREAK_BONUS = [0, 10, 20, 40, 80, 160] as const;

export function streakBonus(streakDay: number): number {
  if (streakDay <= 0) return 0;
  return STREAK_BONUS[Math.min(streakDay, 5)];
}

/**
 * Escalation day for a close on `date`, given the set of dates that already have a completed close.
 * Counts consecutive closed weekdays back from `date` within the same Mon–Fri week, including `date` itself.
 */
export function weeklyStreakDay(closed: Set<string>, date: string): number {
  if (!isWeekday(date)) return 0;
  const monday = startOfWeek(date);
  let day = 1;
  let cursor = addDays(date, -1);
  while (cursor >= monday) {
    if (isWeekday(cursor)) {
      if (!closed.has(cursor)) break;
      day += 1;
    }
    cursor = addDays(cursor, -1);
  }
  return day;
}

/**
 * All-time running streak in weekdays, weekends bridge.
 * If `today` is not closed yet, the streak is still alive as long as the previous weekday was closed.
 */
export function runningStreak(closed: Set<string>, today: string): number {
  let cursor = today;
  if (!closed.has(today)) {
    cursor = addDays(today, -1);
    while (!isWeekday(cursor)) cursor = addDays(cursor, -1);
    if (!closed.has(cursor)) return 0;
  }
  let count = 0;
  for (let i = 0; i < 3650; i++) {
    if (isWeekday(cursor)) {
      if (!closed.has(cursor)) break;
      count += 1;
    }
    cursor = addDays(cursor, -1);
  }
  return count;
}

/**
 * When the running streak is 0, what was lost and whether one grace day would mend it. Repair means closing the single missed
 * weekday after the fact; two or more missed weekdays are a real break. Weekends are never "missed".
 */
export function brokenStreak(closed: Set<string>, today: string): { lost: number; endedOn: string; missed: string[]; repairable: boolean } | null {
  if (runningStreak(closed, today) > 0 || closed.size === 0) return null;
  const endedOn = [...closed].filter((d) => d < today).sort().at(-1);
  if (!endedOn) return null;
  const lost = runningStreak(closed, endedOn);
  if (lost < 2) return null;
  const missed: string[] = [];
  for (let d = addDays(endedOn, 1); d < today; d = addDays(d, 1)) if (isWeekday(d) && !closed.has(d)) missed.push(d);
  if (!missed.length) return null;
  return { lost, endedOn, missed, repairable: missed.length === 1 && daysBetween(missed[0], today) <= 7 };
}

export function bestStreak(closed: Set<string>): number {
  if (closed.size === 0) return 0;
  const dates = [...closed].sort();
  let best = 0;
  for (const d of dates) {
    // only evaluate at the end of runs to keep it O(n·k)
    const next = addDays(d, 1);
    const nextWeekday = isWeekday(next) ? next : addDays(d, next === addDays(d, 1) && new Date(next).getUTCDay() === 6 ? 3 : 2);
    if (!closed.has(nextWeekday)) best = Math.max(best, runningStreak(closed, d));
  }
  return best;
}
