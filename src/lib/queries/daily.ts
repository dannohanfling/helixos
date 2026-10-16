import { and, eq, gte, isNotNull, isNull, like, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays } from "@/lib/dates";
import { activeDaysOf, closeTarget, lateOpen, runningStreak, streakDayOf, type ActiveDays, type CloseTarget, type WorkDays } from "@/lib/engine/streak";

/** Every read here is scoped to (workspace, user): a user can belong to more than one workspace and days never cross over. */
export async function closedDates(workspaceId: string, userId: string, opts: { excludeRepaired?: boolean } = {}): Promise<Set<string>> {
  const rows = await db
    .select({ date: schema.dailyLogs.date })
    .from(schema.dailyLogs)
    .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), isNotNull(schema.dailyLogs.eveningDoneAt), ...(opts.excludeRepaired ? [isNull(schema.dailyLogs.repairedAt)] : [])));
  return new Set(rows.map((r) => r.date));
}

/** How many streak repairs this member has used in the given month (YYYY-MM). One per month is the allowance. */
export async function repairsUsed(workspaceId: string, userId: string, month: string): Promise<number> {
  const rows = await db.select({ id: schema.dailyLogs.id }).from(schema.dailyLogs).where(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), like(schema.dailyLogs.repairedAt, `${month}%`)));
  return rows.length;
}

export type TodayActivity = { dmsStarted: number; conversations: number; posts: number; newLeads: number };

/**
 * What the app already saw the member do today, to pre-fill the close: contacts started, replies logged, content marked posted.
 * Timestamps are UTC while "today" is the member's day, so this is a starting point the member corrects, not a verdict.
 */
export async function todayActivity(workspaceId: string, userId: string, today: string): Promise<TodayActivity> {
  const [started, replied, created, posted] = await Promise.all([
    db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.userId, userId), like(schema.contacts.lastOutboundAt, `${today}%`))),
    db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.userId, userId), like(schema.contacts.lastInboundAt, `${today}%`))),
    db.select({ id: schema.contacts.id }).from(schema.contacts).where(and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.userId, userId), like(schema.contacts.createdAt, `${today}%`))),
    db.select({ id: schema.contentItems.id }).from(schema.contentItems).where(and(eq(schema.contentItems.workspaceId, workspaceId), eq(schema.contentItems.userId, userId), like(schema.contentItems.postedAt, `${today}%`))),
  ]);
  return { dmsStarted: Math.max(started.length, created.length), conversations: replied.length, posts: posted.length, newLeads: created.length };
}

/**
 * The member's active days (H-289 §1): every day with a log begun or closed, or points earned in their own time. The one read
 * every streak comes from; the engine decides which ledger rows count (never a streak bonus or a coach's adjustment).
 */
export async function activityFor(workspaceId: string, userId: string, tz: string): Promise<ActiveDays> {
  const [rows, logs] = await Promise.all([
    db
      .select({ type: schema.pointsLedger.type, points: schema.pointsLedger.points, refId: schema.pointsLedger.refId, adjustedBy: schema.pointsLedger.adjustedBy, createdAt: schema.pointsLedger.createdAt })
      .from(schema.pointsLedger)
      .where(and(eq(schema.pointsLedger.workspaceId, workspaceId), eq(schema.pointsLedger.userId, userId))),
    db
      .select({ date: schema.dailyLogs.date, morningDoneAt: schema.dailyLogs.morningDoneAt, eveningDoneAt: schema.dailyLogs.eveningDoneAt, repairedAt: schema.dailyLogs.repairedAt })
      .from(schema.dailyLogs)
      .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId))),
  ]);
  return activeDaysOf(rows, logs, tz);
}

/** The days a streak bonus was already paid for (the ledger's "streak" rows, one a day, whatever the reason says). */
export async function paidStreakDays(workspaceId: string, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ refId: schema.pointsLedger.refId })
    .from(schema.pointsLedger)
    .where(and(eq(schema.pointsLedger.workspaceId, workspaceId), eq(schema.pointsLedger.userId, userId), eq(schema.pointsLedger.type, "streak")));
  return new Set(rows.map((r) => r.refId).filter((r): r is string => Boolean(r)));
}

/** Who the streak is read for: their day and hour, their zone (to date what they did) and their work days. */
export type StreakWho = { today: string; hour: number; tz: string; days: WorkDays };
export type StreakRead = {
  running: number;
  /** The day it is read as of: yesterday inside the late close-out window while yesterday is still open (rev 731), else today. */
  asOf: string;
  activity: ActiveDays;
  closed: Set<string>;
  days: WorkDays;
};

/**
 * The running streak (H-289): every reader (Today, the badge, the coach's roster and client page, the reminders, the connector)
 * comes through here, so they all count the same days the same way.
 */
export async function streakFor(workspaceId: string, userId: string, who: StreakWho): Promise<StreakRead> {
  const [activity, closed, logs] = await Promise.all([activityFor(workspaceId, userId, who.tz), closedDates(workspaceId, userId), logsBetween(workspaceId, userId, addDays(who.today, -1), who.today)]);
  const asOf = streakDayOf(activity.active, who.today, who.hour, lateOpen(logs, who.today));
  return { running: runningStreak(activity.active, asOf, who.days), asOf, activity, closed, days: who.days };
}

/** The day a close-out made now is for (rev 731): the same close-out as the last, yesterday inside the window, or today. */
export async function closeTargetFor(workspaceId: string, userId: string, today: string, hour: number, now: Date = new Date()): Promise<CloseTarget> {
  const marks = await db
    .select({ date: schema.dailyLogs.date, eveningDoneAt: schema.dailyLogs.eveningDoneAt, morningDoneAt: schema.dailyLogs.morningDoneAt, repairedAt: schema.dailyLogs.repairedAt })
    .from(schema.dailyLogs)
    .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), gte(schema.dailyLogs.date, addDays(today, -2)), lte(schema.dailyLogs.date, today)));
  return closeTarget(marks, today, hour, now);
}

export async function logFor(workspaceId: string, userId: string, date: string) {
  return db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), eq(schema.dailyLogs.date, date)) });
}

export async function logsBetween(workspaceId: string, userId: string, from: string, to: string) {
  return db.query.dailyLogs.findMany({
    where: and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), gte(schema.dailyLogs.date, from), lte(schema.dailyLogs.date, to)),
    orderBy: schema.dailyLogs.date,
  });
}
