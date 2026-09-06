import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { runningStreak } from "@/lib/engine/streak";

export async function closedDates(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ date: schema.dailyLogs.date })
    .from(schema.dailyLogs)
    .where(and(eq(schema.dailyLogs.userId, userId), isNotNull(schema.dailyLogs.eveningDoneAt)));
  return new Set(rows.map((r) => r.date));
}

export async function streakFor(userId: string, today: string): Promise<{ running: number; closed: Set<string> }> {
  const closed = await closedDates(userId);
  return { running: runningStreak(closed, today), closed };
}

export async function logFor(userId: string, date: string) {
  return db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, userId), eq(schema.dailyLogs.date, date)) });
}

export async function logsBetween(userId: string, from: string, to: string) {
  return db.query.dailyLogs.findMany({
    where: and(eq(schema.dailyLogs.userId, userId), gte(schema.dailyLogs.date, from), lte(schema.dailyLogs.date, to)),
    orderBy: schema.dailyLogs.date,
  });
}
