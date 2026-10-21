import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Client work waiting for the coach's approval (H-1280, plan H-1296): Pathway tasks handed in and certification deliverables
 * handed in, for clients still in the workspace. One read feeds the Verify submissions card, the Coach view's subtitle and
 * the "Submissions to verify" count in the menu, so they can never disagree. A removed client's hand-ins drop out with them.
 */
export type SubmissionsWaiting = { pathway: (typeof schema.pathwayProgress.$inferSelect)[]; certs: (typeof schema.certSubmissions.$inferSelect)[]; total: number };

export async function submissionsWaiting(workspaceId: string): Promise<SubmissionsWaiting> {
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client")), columns: { userId: true, removedAt: true } });
  const userIds = members.filter((m) => !m.removedAt).map((m) => m.userId);
  if (!userIds.length) return { pathway: [], certs: [], total: 0 };
  const [pathway, certs] = await Promise.all([
    db.query.pathwayProgress.findMany({ where: and(eq(schema.pathwayProgress.workspaceId, workspaceId), eq(schema.pathwayProgress.status, "submitted"), inArray(schema.pathwayProgress.userId, userIds)), orderBy: desc(schema.pathwayProgress.submittedAt) }),
    db.query.certSubmissions.findMany({ where: and(eq(schema.certSubmissions.workspaceId, workspaceId), eq(schema.certSubmissions.status, "submitted"), inArray(schema.certSubmissions.userId, userIds)), orderBy: desc(schema.certSubmissions.createdAt) }),
  ]);
  return { pathway, certs, total: pathway.length + certs.length };
}

/** The count alone, for the menu. */
export async function submissionsWaitingCount(workspaceId: string): Promise<number> {
  return (await submissionsWaiting(workspaceId)).total;
}
