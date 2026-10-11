/**
 * Numbers targets, the one copy of the rule: one row per member, month and metric; zero clears it. The Numbers page's form and
 * the Board's set-up both call it.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";

/** Sets (or, with zero, clears) one of the member's monthly targets. */
export async function setTarget(m: { workspaceId: string; userId: string }, month: string, metric: string, target: number): Promise<void> {
  const existing = await db.query.targets.findFirst({ where: and(eq(schema.targets.userId, m.userId), eq(schema.targets.month, month), eq(schema.targets.metric, metric)) });
  if (!target && existing) await db.delete(schema.targets).where(eq(schema.targets.id, existing.id));
  else if (target && existing) await db.update(schema.targets).set({ target }).where(eq(schema.targets.id, existing.id));
  else if (target) await db.insert(schema.targets).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, month, metric, target });
}
