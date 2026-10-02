/** The reads behind the issue button, the coach's inbox and the monthly feedback count (rev 432, items 2 to 4). */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { newFeedbackCount } from "@/lib/engine/reports";

/** The workspace's coach by first name, for "Tell Danno": the first coach to join. */
export async function coachFirstName(workspaceId: string): Promise<string> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "coach")), orderBy: asc(schema.memberships.createdAt) });
  const u = m ? await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) }) : undefined;
  return u?.name.split(" ")[0] || "your coach";
}

/** Reports the coach hasn't opened yet. */
export async function unseenReports(workspaceId: string): Promise<number> {
  return (await db.query.memberReports.findMany({ where: and(eq(schema.memberReports.workspaceId, workspaceId), isNull(schema.memberReports.seenAt)), columns: { id: true } })).length;
}

/** Monthly feedback sent or changed since this coach last opened Monthly feedback. */
export async function newMonthlyFeedback(workspaceId: string, seenAt: string | null): Promise<number> {
  const rows = await db.query.monthlyFeedback.findMany({ where: eq(schema.monthlyFeedback.workspaceId, workspaceId), columns: { createdAt: true, updatedAt: true } });
  return newFeedbackCount(rows, seenAt);
}
