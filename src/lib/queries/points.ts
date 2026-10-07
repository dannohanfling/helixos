import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import type { POINT_TYPES } from "@/db/schema";
import { background, pushPoints } from "@/lib/integrations";

export type PointType = (typeof POINT_TYPES)[number];

/** Every read here is scoped to (workspace, user): a user can belong to more than one workspace and points never cross over. */
export async function totalPoints(workspaceId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.pointsLedger.points}), 0)` })
    .from(schema.pointsLedger)
    .where(and(eq(schema.pointsLedger.workspaceId, workspaceId), eq(schema.pointsLedger.userId, userId)));
  return Number(row?.total ?? 0);
}

export async function pointsSince(workspaceId: string, userId: string, sinceIso: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.pointsLedger.points}), 0)` })
    .from(schema.pointsLedger)
    .where(and(eq(schema.pointsLedger.workspaceId, workspaceId), eq(schema.pointsLedger.userId, userId), sql`${schema.pointsLedger.createdAt} >= ${sinceIso}`));
  return Number(row?.total ?? 0);
}

/** Whether this request is someone acting in a member's HelixOS: a coach switched in, or a team member. Outside a request (the hourly job) it never is. */
async function actingForMember(): Promise<boolean> {
  try {
    const { getViewer } = await import("@/lib/auth");
    const v = await getViewer();
    return Boolean(v?.switchedInto || v?.team);
  } catch {
    return false;
  }
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
  // Points are the member's own: nothing a coach does while switched into their HelixOS (rev 216), and nothing a team member
  // does (Danno, 6 Oct), scores for them.
  if (await actingForMember()) return false;
  const res = await db
    .insert(schema.pointsLedger)
    .values({ id: newId(), workspaceId: ctx.workspaceId, userId: ctx.userId, type, points, reason, refId: refId ?? null })
    .onConflictDoNothing();
  const inserted = (res.rowsAffected ?? 0) > 0;
  if (inserted) background(pushPoints(ctx, points, reason));
  return inserted;
}

export async function recentLedger(workspaceId: string, userId: string, limit = 30) {
  return db.query.pointsLedger.findMany({
    where: and(eq(schema.pointsLedger.workspaceId, workspaceId), eq(schema.pointsLedger.userId, userId)),
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
