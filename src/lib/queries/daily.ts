import { and, eq, gte, isNotNull, isNull, like, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { runningStreak } from "@/lib/engine/streak";

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

export async function streakFor(workspaceId: string, userId: string, today: string): Promise<{ running: number; closed: Set<string> }> {
  const closed = await closedDates(workspaceId, userId);
  return { running: runningStreak(closed, today), closed };
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
