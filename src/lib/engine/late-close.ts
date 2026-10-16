/**
 * Late close-outs, the backfill (rev 731, Danno's answers at rev 746). Before the 04:00 window existed, a close submitted between
 * 00:00 and 03:59 the member's time landed on the new day; it was meant for the day before. This plans the credit, as counts
 * only, and never writes: the coach page shows the dry run, and nothing is applied until Danno says go.
 *
 * A close qualifies when its first submit time (evening_done_at, read in the member's current timezone) falls before
 * LATE_CLOSE_UNTIL_HOUR on the log's own date, the day before has no close, and it isn't a repair. Rows are walked oldest first
 * per member, so a run of nightly 00:30 closes moves back one day each. Two groups:
 * - move: no lock-in on the new day after that close, so an evening re-close that day was the same close-out. The close moves to
 *   the day before and the new day is left open.
 * - copy: the member locked in on the new day after that close, so an evening close that day belonged to the new day. The day
 *   before is credited and the new day stays closed.
 * Points are the credited day's own, by the normal rules (the close, and the weekly streak bonus), never twice for a day, and
 * nothing already given is taken back. A rerun finds nothing: a credited close no longer sits on its own submit date.
 */
import { addDays, todayInTz, hourInTz } from "@/lib/dates";
import { POINTS } from "./points";
import { LATE_CLOSE_UNTIL_HOUR, runningStreak, streakBonus, streakDayOf, weeklyStreakDay, type WorkDays } from "./streak";

export type LateLog = { id: string; date: string; eveningDoneAt: string | null; morningDoneAt: string | null; repairedAt: string | null; streakDay: number };
export type LateMember = {
  userId: string;
  tz: string;
  /** The member's work days (H-289 §2) for the running streak counts; Monday to Friday when not given. */
  days?: WorkDays;
  logs: LateLog[];
  /** The days already paid, by ledger type: "close" and "streak" rows' refIds (a date). */
  paid: { close: Set<string>; streak: Set<string> };
  /** Points the "close" row for a day already gave, by date (for the new days that keep theirs). */
  closePaidOn: Map<string, number>;
};
export type LateCredit = { userId: string; logId: string; from: string; to: string; kind: "move" | "copy"; closePoints: number; streakPoints: number; streakDay: number };
export type LatePlan = {
  credits: LateCredit[];
  /** Stored weekly streak days that change once the closes sit on the right days: (log, new value). */
  restamp: { userId: string; date: string; streakDay: number }[];
  counts: LateCounts;
};
export type LateCounts = {
  closesFound: number;
  members: number;
  daysCredited: number;
  moved: number;
  copied: number;
  pointsToAward: number;
  streaksUp: number;
  streaksDown: number;
  streakDaysChanged: number;
  /** Conflict (b): the new day was already paid for by the late close; it keeps them. */
  newDayAlreadyPaid: number;
  newDayPointsKept: number;
  /** Conflict (c): closes whose submit time can't be read, so they can't be judged. */
  unreadable: number;
};

/** A stored time to an instant: ISO with a zone, or SQLite's "YYYY-MM-DD HH:MM:SS", which is UTC. Null when it can't be read. */
export function readStamp(s: string | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  const iso = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(t) ? `${t.replace(" ", "T")}Z` : t;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso)) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The plan for every member: which closes to credit to the day before, the points, the streak days, and the counts. */
export function planLateCloses(members: LateMember[], now: Date): LatePlan {
  const credits: LateCredit[] = [];
  const restamp: LatePlan["restamp"] = [];
  const c: LateCounts = { closesFound: 0, members: 0, daysCredited: 0, moved: 0, copied: 0, pointsToAward: 0, streaksUp: 0, streaksDown: 0, streakDaysChanged: 0, newDayAlreadyPaid: 0, newDayPointsKept: 0, unreadable: 0 };
  for (const m of members) {
    const logs = [...m.logs].sort((a, b) => (a.date < b.date ? -1 : 1));
    const closedBefore = new Set(logs.filter((l) => l.eveningDoneAt).map((l) => l.date));
    const closed = new Set(closedBefore);
    const mine: LateCredit[] = [];
    for (const l of logs) {
      if (!l.eveningDoneAt || l.repairedAt) continue;
      const at = readStamp(l.eveningDoneAt);
      if (!at) {
        c.unreadable++;
        continue;
      }
      if (todayInTz(m.tz, at) !== l.date || hourInTz(m.tz, at) >= LATE_CLOSE_UNTIL_HOUR) continue;
      const prev = addDays(l.date, -1);
      if (closed.has(prev)) continue;
      const lock = readStamp(l.morningDoneAt);
      const kind = lock && lock.getTime() > at.getTime() ? "copy" : "move";
      closed.add(prev);
      if (kind === "move") closed.delete(l.date);
      mine.push({ userId: m.userId, logId: l.id, from: l.date, to: prev, kind, closePoints: 0, streakPoints: 0, streakDay: 0 });
      if (m.paid.close.has(l.date) && kind === "move") {
        c.newDayAlreadyPaid++;
        c.newDayPointsKept += m.closePaidOn.get(l.date) ?? 0;
      }
    }
    if (!mine.length) continue;
    // Points and streak days by the normal rules, on the closes as they will sit (repairs never feed the escalation).
    const repaired = new Set(logs.filter((l) => l.repairedAt).map((l) => l.date));
    const forStreak = new Set([...closed].filter((d) => !repaired.has(d)));
    for (const x of mine) {
      x.streakDay = weeklyStreakDay(forStreak, x.to);
      x.closePoints = m.paid.close.has(x.to) ? 0 : POINTS.close;
      const bonus = streakBonus(x.streakDay);
      x.streakPoints = bonus && !m.paid.streak.has(x.to) ? bonus : 0;
      c.pointsToAward += x.closePoints + x.streakPoints;
    }
    // Stored streak days that change in the weeks touched (the credited days themselves are set by their credit).
    const credited = new Set(mine.map((x) => x.to));
    for (const l of logs) {
      if (!closed.has(l.date) || repaired.has(l.date) || credited.has(l.date)) continue;
      if (!l.eveningDoneAt) continue;
      const day = weeklyStreakDay(forStreak, l.date);
      if (day !== l.streakDay) restamp.push({ userId: m.userId, date: l.date, streakDay: day });
    }
    const today = todayInTz(m.tz, now);
    const hour = hourInTz(m.tz, now);
    const before = runningStreak(closedBefore, streakDayOf(closedBefore, today, hour), m.days ?? "weekdays");
    const after = runningStreak(closed, streakDayOf(closed, today, hour), m.days ?? "weekdays");
    if (after > before) c.streaksUp++;
    if (after < before) c.streaksDown++;
    credits.push(...mine);
    c.members++;
  }
  c.closesFound = credits.length;
  c.daysCredited = credits.length;
  c.moved = credits.filter((x) => x.kind === "move").length;
  c.copied = credits.filter((x) => x.kind === "copy").length;
  c.streakDaysChanged = restamp.length;
  return { credits, restamp, counts: c };
}

/**
 * The plan applied to the logs in memory, the way the apply writes them: a move takes the close (its submit time and streak day)
 * to the day before and clears it from the new day, keeping the new day's lock-in; a copy credits the day before and leaves the
 * new day closed. Used by the tests to show a rerun finds nothing, and by the apply once Danno says go.
 */
export function applyLatePlan(logs: LateLog[], plan: LatePlan, userId: string): LateLog[] {
  const out = logs.map((l) => ({ ...l }));
  for (const x of plan.credits.filter((p) => p.userId === userId)) {
    const from = out.find((l) => l.id === x.logId)!;
    let to = out.find((l) => l.date === x.to);
    if (!to) {
      to = { id: `${x.logId}:${x.to}`, date: x.to, eveningDoneAt: null, morningDoneAt: null, repairedAt: null, streakDay: 0 };
      out.push(to);
    }
    to.eveningDoneAt = from.eveningDoneAt;
    to.streakDay = x.streakDay;
    if (x.kind === "move") {
      from.eveningDoneAt = null;
      from.streakDay = 0;
    }
  }
  for (const r of plan.restamp.filter((p) => p.userId === userId)) {
    const l = out.find((x) => x.date === r.date);
    if (l) l.streakDay = r.streakDay;
  }
  return out;
}

/** The one line Danno posts in the doc: counts only, never a name. */
export function lateCountsLine(c: LateCounts): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return [
    `Late close-outs dry run: ${n(c.closesFound, "close", "closes")} found, ${n(c.members, "member", "members")}, ${n(c.daysCredited, "day", "days")} credited (${c.moved} moved, ${c.copied} copied because the member locked in on the new day)`,
    `${n(c.pointsToAward, "point", "points")} to award`,
    `streaks: ${c.streaksUp} go up, ${c.streaksDown} go down, ${n(c.streakDaysChanged, "stored streak day changes", "stored streak days change")}`,
    `conflicts: ${n(c.newDayAlreadyPaid, "new day", "new days")} already paid by the late close (${n(c.newDayPointsKept, "point", "points")}, kept), ${n(c.unreadable, "close", "closes")} with a submit time that can't be read`,
  ].join("; ") + ".";
}
