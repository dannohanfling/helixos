import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

/** A member's most recent Community Pass point awards. Server-only query: callers must already have resolved the viewer. */
export async function recentMemberPoints(userId: string, limit = 20) {
  return db.query.memberPoints.findMany({ where: eq(schema.memberPoints.userId, userId), orderBy: desc(schema.memberPoints.createdAt), limit });
}
