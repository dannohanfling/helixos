import { addDays, isWeekday, startOfWeek } from "@/lib/dates";

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
