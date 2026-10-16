/**
 * Late close-outs, the backfill's reads (rev 731): every client's closed days and the close and streak points already paid, in
 * the coach's own workspace, for the dry run on Coach → Late close-outs. Read only: nothing here writes, and the apply waits
 * for Danno's go.
 */
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { planLateCloses, type LateMember, type LatePlan } from "@/lib/engine/late-close";

export async function lateCloseMembers(workspaceId: string, workspaceTz: string): Promise<LateMember[]> {
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  if (!members.length) return [];
  const ids = members.map((m) => m.userId);
  const [logs, paid] = await Promise.all([
    db
      .select({ id: schema.dailyLogs.id, userId: schema.dailyLogs.userId, date: schema.dailyLogs.date, eveningDoneAt: schema.dailyLogs.eveningDoneAt, morningDoneAt: schema.dailyLogs.morningDoneAt, repairedAt: schema.dailyLogs.repairedAt, streakDay: schema.dailyLogs.streakDay })
      .from(schema.dailyLogs)
      .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), inArray(schema.dailyLogs.userId, ids), or(isNotNull(schema.dailyLogs.eveningDoneAt), isNotNull(schema.dailyLogs.morningDoneAt)))),
    db
      .select({ userId: schema.pointsLedger.userId, type: schema.pointsLedger.type, refId: schema.pointsLedger.refId, points: schema.pointsLedger.points })
      .from(schema.pointsLedger)
      .where(and(eq(schema.pointsLedger.workspaceId, workspaceId), inArray(schema.pointsLedger.userId, ids), inArray(schema.pointsLedger.type, ["close", "streak"]))),
  ]);
  return members.map((m) => {
    const mine = paid.filter((p) => p.userId === m.userId && p.refId);
    return {
      userId: m.userId,
      tz: m.timezone || workspaceTz,
      days: m.workDays,
      logs: logs.filter((l) => l.userId === m.userId),
      paid: { close: new Set(mine.filter((p) => p.type === "close").map((p) => p.refId!)), streak: new Set(mine.filter((p) => p.type === "streak").map((p) => p.refId!)) },
      closePaidOn: new Map(mine.filter((p) => p.type === "close").map((p) => [p.refId!, p.points])),
    };
  });
}

/** The dry run for a workspace: the plan, counts only on the page. */
export async function lateCloseDryRun(workspaceId: string, workspaceTz: string, now: Date = new Date()): Promise<LatePlan> {
  return planLateCloses(await lateCloseMembers(workspaceId, workspaceTz), now);
}
