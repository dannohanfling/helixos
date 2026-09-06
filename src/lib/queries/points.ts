import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import type { POINT_TYPES } from "@/db/schema";
import { background, pushPoints } from "@/lib/integrations";

export type PointType = (typeof POINT_TYPES)[number];

export async function totalPoints(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.pointsLedger.points}), 0)` })
    .from(schema.pointsLedger)
    .where(eq(schema.pointsLedger.userId, userId));
  return Number(row?.total ?? 0);
}

export async function pointsSince(userId: string, sinceIso: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.pointsLedger.points}), 0)` })
    .from(schema.pointsLedger)
    .where(and(eq(schema.pointsLedger.userId, userId), sql`${schema.pointsLedger.createdAt} >= ${sinceIso}`));
  return Number(row?.total ?? 0);
}

/** Idempotent when a refId is given: the same (user, type, ref) never scores twice. */
export async function award(
  ctx: { workspaceId: string; userId: string },
  type: PointType,
  points: number,
  reason: string,
  refId?: string,
): Promise<boolean> {
  if (!points) return false;
  const res = await db
    .insert(schema.pointsLedger)
    .values({ id: newId(), workspaceId: ctx.workspaceId, userId: ctx.userId, type, points, reason, refId: refId ?? null })
    .onConflictDoNothing();
  const inserted = (res.rowsAffected ?? 0) > 0;
  if (inserted && points > 0) background(pushPoints(ctx, points, reason));
  return inserted;
}

export async function recentLedger(userId: string, limit = 30) {
  return db.query.pointsLedger.findMany({
    where: eq(schema.pointsLedger.userId, userId),
    orderBy: desc(schema.pointsLedger.createdAt),
    limit,
  });
}

export async function leaderboard(workspaceId: string, sinceIso?: string) {
  const rows = await db
    .select({
      userId: schema.pointsLedger.userId,
      total: sql<number>`coalesce(sum(${schema.pointsLedger.points}), 0)`,
    })
    .from(schema.pointsLedger)
    .where(
      sinceIso
        ? and(eq(schema.pointsLedger.workspaceId, workspaceId), sql`${schema.pointsLedger.createdAt} >= ${sinceIso}`)
        : eq(schema.pointsLedger.workspaceId, workspaceId),
    )
    .groupBy(schema.pointsLedger.userId)
    .orderBy(desc(sql`sum(${schema.pointsLedger.points})`));
  return rows.map((r) => ({ userId: r.userId, total: Number(r.total) }));
}
