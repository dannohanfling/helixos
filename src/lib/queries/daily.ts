import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { runningStreak } from "@/lib/engine/streak";

/** Every read here is scoped to (workspace, user): a user can belong to more than one workspace and days never cross over. */
export async function closedDates(workspaceId: string, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ date: schema.dailyLogs.date })
    .from(schema.dailyLogs)
    .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), isNotNull(schema.dailyLogs.eveningDoneAt)));
  return new Set(rows.map((r) => r.date));
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
