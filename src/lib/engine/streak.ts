import { addDays, daysBetween, instantOf, isWeekday, startOfWeek, todayInTz } from "@/lib/dates";

/**
 * Streak rules (the HelixOS Daily Hashtag quest, rewritten in H-283/H-289, 16 Oct):
 * - An active day is a day the member earned points in their own time (a lock-in, a close, a task, a post, a conversation, a
 *   3-1-3 shared, a pathway step) or began or closed in the daily log. Streak bonuses and a coach's adjustments never make a
 *   day active, so a day can't count because of its own bonus.
 * - Which days count is the member's choice (Settings → You, "My work days"): every day (the default) or Monday to Friday, where
 *   weekends neither break nor extend the streak.
 * - The weekday bonus escalates and resets every Monday: day 1 = 10, day 2 = 20, day 3 = 40, day 4 = 80, day 5 = 160. Miss a
 *   weekday and the escalation drops back to day 1. Weekends never move the ladder.
 * - On every day, an active Saturday or Sunday that carries the streak on (the day before was active) pays a flat +40.
 *   A full week is 390.
 */
export const STREAK_BONUS = [0, 10, 20, 40, 80, 160] as const;
export const WEEKEND_BONUS = 40;
export type WorkDays = "weekdays" | "all";
export const WORK_DAYS: readonly WorkDays[] = ["weekdays", "all"];
/**
 * Days before this never pay a bonus on their own (the settle, below): history is the recount's, the coach's one Apply on
 * Coach → Late close-outs (H-289 §4), so the dry run he reads is the whole of it.
 */
export const SEVEN_DAY_STREAK_SINCE = "2026-10-16";
/** How far back Today's settle looks for an active day whose bonus was never paid. */
export const SETTLE_DAYS = 14;

export function streakBonus(streakDay: number): number {
  if (streakDay <= 0) return 0;
  return STREAK_BONUS[Math.min(streakDay, 5)];
}

/** Whether `d` is a day the streak counts for a member on these work days. */
export function countsDay(d: string, days: WorkDays): boolean {
  return days === "all" || isWeekday(d);
}

/** The counting day before `d`. */
export function prevCountingDay(d: string, days: WorkDays): string {
  let c = addDays(d, -1);
  while (!countsDay(c, days)) c = addDays(c, -1);
  return c;
}

/** The counting day after `d`. */
export function nextCountingDay(d: string, days: WorkDays): string {
  let c = addDays(d, 1);
  while (!countsDay(c, days)) c = addDays(c, 1);
  return c;
}

/**
 * Escalation day for an active weekday `date`, given the set of active days (repaired days left out: a repair never feeds the
 * ladder). Counts consecutive active weekdays back from `date` within the same Mon–Fri week, including `date` itself. Weekends
 * are 0: they have their own flat bonus and never move the ladder, whatever the member's work days.
 */
export function weeklyStreakDay(active: Set<string>, date: string): number {
  if (!isWeekday(date)) return 0;
  const monday = startOfWeek(date);
  let day = 1;
  let cursor = addDays(date, -1);
  while (cursor >= monday) {
    if (isWeekday(cursor)) {
      if (!active.has(cursor)) break;
      day += 1;
    }
    cursor = addDays(cursor, -1);
  }
  return day;
}

/** The flat weekend bonus for an active `date`: on every day, a Saturday or Sunday whose day before was active too. */
export function weekendBonus(active: Set<string>, date: string, days: WorkDays): number {
  if (days !== "all" || isWeekday(date)) return 0;
  return active.has(addDays(date, -1)) ? WEEKEND_BONUS : 0;
}

export type DayBonus = { points: number; reason: string; streakDay: number };

/** What an active `date` pays as its streak bonus, the weekday ladder or the weekend's flat +40, with the ledger line for it. */
export function bonusFor(active: Set<string>, date: string, days: WorkDays): DayBonus {
  if (isWeekday(date)) {
    const streakDay = weeklyStreakDay(active, date);
    return { points: streakBonus(streakDay), reason: `Streak day ${streakDay}`, streakDay };
  }
  const points = weekendBonus(active, date, days);
  return { points, reason: `Weekend streak +${WEEKEND_BONUS}`, streakDay: 0 };
}

/**
 * All-time running streak in counting days. On Monday to Friday, weekends bridge; on every day, each day counts.
 * If `today` is not active yet, the streak is still alive as long as the counting day before was active.
 */
export function runningStreak(active: Set<string>, today: string, days: WorkDays): number {
  let cursor = today;
  if (!active.has(today)) {
    cursor = prevCountingDay(today, days);
    if (!active.has(cursor)) return 0;
  }
  let count = 0;
  for (let i = 0; i < 3650; i++) {
    if (countsDay(cursor, days)) {
      if (!active.has(cursor)) break;
      count += 1;
    }
    cursor = addDays(cursor, -1);
  }
  return count;
}

/**
 * When the running streak is 0, what was lost and whether one grace day would mend it. Repair means closing the single missed
 * counting day after the fact; two or more missed days are a real break. On Monday to Friday, weekends are never "missed".
 */
export function brokenStreak(active: Set<string>, today: string, days: WorkDays): { lost: number; endedOn: string; missed: string[]; repairable: boolean } | null {
  if (runningStreak(active, today, days) > 0 || active.size === 0) return null;
  // The last active counting day: on Monday to Friday a weekend day after the break neither ends nor mends a streak.
  const endedOn = [...active].filter((d) => d < today && countsDay(d, days)).sort().at(-1);
  if (!endedOn) return null;
  const lost = runningStreak(active, endedOn, days);
  if (lost < 2) return null;
  const missed: string[] = [];
  for (let d = addDays(endedOn, 1); d < today; d = addDays(d, 1)) if (countsDay(d, days) && !active.has(d)) missed.push(d);
  if (!missed.length) return null;
  return { lost, endedOn, missed, repairable: missed.length === 1 && daysBetween(missed[0], today) <= 7 };
}

export function bestStreak(active: Set<string>, days: WorkDays): number {
  if (active.size === 0) return 0;
  let best = 0;
  for (const d of active) {
    // only evaluate at the end of runs to keep it O(n·k)
    if (!countsDay(d, days)) continue;
    if (!active.has(nextCountingDay(d, days))) best = Math.max(best, runningStreak(active, d, days));
  }
  return best;
}

/* ───────────────────────── Active days (H-289 §1) ───────────────────────── */

/** A points ledger row as the streak reads it. */
export type ActivityRow = { type: string; points: number; refId: string | null; adjustedBy: string | null; createdAt: string };
/** A daily log as the streak reads it. */
export type ActivityLog = { date: string; morningDoneAt: string | null; eveningDoneAt: string | null; repairedAt: string | null; /** H-312: the first open of the app that day counts as showing up. */ openedAt?: string | null };
export type ActiveDays = {
  /** Every day the member showed up: a log begun or closed, or points earned that day in their own time. */
  active: Set<string>;
  /** Streak repairs: in `active` (the streak survives) and never in the ladder. */
  repaired: Set<string>;
  /** `active` without the repaired days: what the weekly escalation reads. */
  ladder: Set<string>;
};

/**
 * The day a ledger row is activity for, in the member's own time, or null when it isn't activity: a streak bonus, a coach's
 * adjustment, a redeem, or nothing earned. A row that names its day (the lock-in, the close and the day's activity carry the
 * date as their ref) is that day's, however late it was saved; any other row is dated by when it was written.
 */
export function activityDate(row: ActivityRow, tz: string): string | null {
  if (row.type === "streak" || row.type === "redeem" || row.adjustedBy || row.points <= 0) return null;
  const ref = row.refId?.match(/^(?:activity:)?(\d{4}-\d\d-\d\d)$/);
  if (ref) return ref[1];
  try {
    return todayInTz(tz, instantOf(row.createdAt));
  } catch {
    return null;
  }
}

/** The member's active days from their logs and their ledger (H-289 §1): the one reading every streak comes from. */
export function activeDaysOf(rows: ActivityRow[], logs: ActivityLog[], tz: string): ActiveDays {
  const active = new Set<string>();
  const repaired = new Set<string>();
  for (const l of logs) {
    if (l.morningDoneAt || l.eveningDoneAt || l.openedAt) active.add(l.date);
    if (l.repairedAt) repaired.add(l.date);
  }
  for (const r of rows) {
    const d = activityDate(r, tz);
    if (d) active.add(d);
  }
  const ladder = new Set([...active].filter((d) => !repaired.has(d)));
  return { active, repaired, ladder };
}

/* ───────────────────────── The settle and the recount (H-289 §3, §4) ───────────────────────── */

/**
 * Active days up to `through` whose bonus was never paid, oldest first, from `from`: what the settle on Today (the last
 * SETTLE_DAYS, never before SEVEN_DAY_STREAK_SINCE) and the recount (the whole history) each pay. `paid` holds the days with
 * a streak row already; a day is paid once, whatever the row says.
 */
export function unpaidBonuses(days_: ActiveDays, days: WorkDays, paid: Set<string>, from: string, through: string): { date: string; bonus: DayBonus }[] {
  const out: { date: string; bonus: DayBonus }[] = [];
  for (let d = from; d <= through; d = addDays(d, 1)) {
    if (!days_.active.has(d) || paid.has(d)) continue;
    const bonus = bonusFor(days_.ladder, d, days);
    if (bonus.points > 0) out.push({ date: d, bonus });
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The day a coach's adjustment paid by hand, from its reason: "… credited to 2026-10-10", "credited to Oct 10", "October
 * 10th", "10 Oct", "10/10" (month first). A year named is kept; otherwise the adjustment's own year, or the one before when
 * the day would otherwise sit after the adjustment was made. Null when the reason doesn't say.
 */
export function handCreditedDate(reason: string, createdAt: string): string | null {
  const m = reason.match(/credited\s+to\s+(.+)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  const iso = rest.match(/^(\d{4}-\d\d-\d\d)/);
  if (iso) return iso[1];
  let y: number | null = null;
  let mo = 0;
  let day = 0;
  let x: RegExpMatchArray | null;
  if ((x = rest.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/))) {
    mo = MONTHS.indexOf(x[1].slice(0, 3).toLowerCase()) + 1;
    day = Number(x[2]);
    y = x[3] ? Number(x[3]) : null;
  } else if ((x = rest.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s*(\d{4}))?/))) {
    mo = MONTHS.indexOf(x[2].slice(0, 3).toLowerCase()) + 1;
    day = Number(x[1]);
    y = x[3] ? Number(x[3]) : null;
  } else if ((x = rest.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/))) {
    mo = Number(x[1]);
    day = Number(x[2]);
    y = x[3] ? Number(x[3].length === 2 ? `20${x[3]}` : x[3]) : null;
  }
  if (!mo || mo > 12 || !day || day > 31) return null;
  const made = (() => {
    try {
      return instantOf(createdAt).toISOString().slice(0, 10);
    } catch {
      return null;
    }
  })();
  if (y === null) {
    y = made ? Number(made.slice(0, 4)) : new Date().getUTCFullYear();
    const guess = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (made && guess > addDays(made, 1)) y -= 1;
  }
  const out = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return Number.isNaN(Date.parse(out)) ? null : out;
}

export type RecountMember = {
  userId: string;
  /** Initials only on the page and in the thread (never a name). */
  initials: string;
  days: WorkDays;
  activity: ActiveDays;
  /** Days with a streak row already (any reason). */
  paid: Set<string>;
  /** Days a coach's adjustment credited by hand ("credited to {date}"): that day's bonus, skipped. */
  handPaid: Set<string>;
  /** The member's streak day now, their own time: the recount runs up to the day before it. */
  asOf: string;
};
export type RecountRow = {
  userId: string;
  initials: string;
  /** The days that get a row on Apply. */
  add: { date: string; points: number; reason: string }[];
  points: number;
  /** Days paid by hand and skipped. */
  skipped: string[];
  /** The running streak under the new rules, as of the member's streak day. */
  streak: number;
};
export type RecountPlan = { rows: RecountRow[]; totals: { members: number; days: number; points: number; skipped: number } };

/** The recount, as counts and days only, nothing written: every active day up to yesterday whose bonus was never paid. */
export function planRecount(members: RecountMember[]): RecountPlan {
  const rows: RecountRow[] = [];
  for (const m of members) {
    const first = [...m.activity.active].sort()[0];
    const through = addDays(m.asOf, -1);
    const due = first ? unpaidBonuses(m.activity, m.days, m.paid, first, through) : [];
    const add = due.filter((x) => !m.handPaid.has(x.date)).map((x) => ({ date: x.date, points: x.bonus.points, reason: `Streak recount: ${x.date}` }));
    const skipped = due.filter((x) => m.handPaid.has(x.date)).map((x) => x.date);
    rows.push({ userId: m.userId, initials: m.initials, add, points: add.reduce((a, x) => a + x.points, 0), skipped, streak: runningStreak(m.activity.active, m.asOf, m.days) });
  }
  return { rows, totals: { members: rows.filter((r) => r.add.length || r.skipped.length).length, days: rows.reduce((a, r) => a + r.add.length, 0), points: rows.reduce((a, r) => a + r.points, 0), skipped: rows.reduce((a, r) => a + r.skipped.length, 0) } };
}

/** Initials for a name, two letters at most: "Maya Fernandez" → "M.F.", "Danno" → "D." */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return [parts[0], parts.length > 1 ? parts[parts.length - 1] : null].filter(Boolean).map((p) => `${p![0].toUpperCase()}.`).join("");
}

/** The one line for the thread: counts only. */
export function recountLine(p: RecountPlan): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return `Streak recount dry run: ${n(p.totals.members, "member", "members")}, ${n(p.totals.days, "day", "days")} to pay, ${n(p.totals.points, "point", "points")} to add, ${n(p.totals.skipped, "day", "days")} paid by hand and skipped.`;
}

/* ───────────────────────── Late close-outs (rev 731, Danno's answers at rev 746) ───────────────────────── */

/**
 * Until this hour (the member's own clock) a close-out can still be saved for the day before, as long as that day isn't closed.
 * One constant so it can become a coach setting later.
 */
export const LATE_CLOSE_UNTIL_HOUR = 4;
/** A close-out made again within this many hours of the last one, with no new lock-in between, is the same close-out. */
export const SAME_CLOSE_HOURS = 6;

/** What a day's log says about its close and its lock-in, as stored: the first submit of each, in UTC. */
export type CloseMark = { date: string; eveningDoneAt: string | null; morningDoneAt: string | null; repairedAt?: string | null };
/** The day a close-out made now belongs to: `late` for the day before inside the window, `same` when it edits the last one. */
export type CloseTarget = { date: string; late: boolean; same: boolean };

/**
 * Which day a close-out made now is for. First, the same close-out: the member's last one (never a repaired day), made less than
 * SAME_CLOSE_HOURS ago, with no lock-in since, takes this one as an edit, on its own date, at any hour. Then yesterday: before
 * LATE_CLOSE_UNTIL_HOUR, or until today's lock-in, with yesterday still open, it is yesterday's. Otherwise it is today's.
 */
export function closeTarget(marks: CloseMark[], today: string, hour: number, now: Date): CloseTarget {
  const last = marks
    .filter((m) => m.eveningDoneAt && !m.repairedAt && m.date <= today)
    .sort((a, b) => (a.eveningDoneAt! < b.eveningDoneAt! ? 1 : -1))[0];
  if (last) {
    const at = Date.parse(last.eveningDoneAt!);
    // A lock-in after that close-out, and not in the future (no real lock-in is; a bad clock or a seed shouldn't count).
    const lockedInSince = marks.some((m) => m.morningDoneAt && Date.parse(m.morningDoneAt) > at && Date.parse(m.morningDoneAt) <= now.getTime());
    if (Number.isFinite(at) && now.getTime() - at < SAME_CLOSE_HOURS * 3600000 && now.getTime() >= at && !lockedInSince) return { date: last.date, late: false, same: true };
  }
  const yesterday = addDays(today, -1);
  const closed = (d: string) => marks.some((m) => m.date === d && m.eveningDoneAt);
  // Docket #3 (D.D., GMT+8): a day she locked in to stays open until she locks in the new day, not only until 04:00. A close
  // filled in the next morning before the first lock-in is yesterday's, whatever the hour; after a lock-in it is today's. A day
  // with no lock-in (a weekend, a day off) still closes only inside the window, so nobody is asked to close a day they never began.
  if ((hour < LATE_CLOSE_UNTIL_HOUR || lateOpen(marks, today)) && !closed(yesterday) && !closed(today)) return { date: yesterday, late: true, same: false };
  return { date: today, late: false, same: false };
}

/**
 * The day the streak is read as of: inside the window with yesterday and today both still inactive, yesterday, so a member who
 * closes at 01:00 never shows a missed day (in the streak, the repair card or a reminder) before they do.
 */
export function streakDayOf(active: Set<string>, today: string, hour: number, stillOpen = false): string {
  const yesterday = addDays(today, -1);
  // `stillOpen` (docket #3): yesterday was locked in to and today isn't yet, so yesterday is still the day; a caller that only
  // knows the hour keeps the 04:00 window.
  return (hour < LATE_CLOSE_UNTIL_HOUR || stillOpen) && !active.has(yesterday) && !active.has(today) ? yesterday : today;
}

/** Docket #3: yesterday was locked in to and today isn't yet, so yesterday is still open for its close whatever the hour. */
export function lateOpen(marks: CloseMark[], today: string): boolean {
  const yesterday = addDays(today, -1);
  return marks.some((m) => m.date === yesterday && m.morningDoneAt) && !marks.some((m) => m.date === today && m.morningDoneAt);
}
