import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { FIELD_TASKS, fieldTaskStatus } from "@/lib/engine/pathway";
import { award } from "@/lib/queries/points";

/**
 * Brings the field-bound stage 1 tasks in line with the fields: a filled field verifies its task (once, with its points);
 * an emptied field reopens a task that was verified this way. Idempotent; writes only when a status changes. Called
 * after the Settings saves and when Today or the Pathway loads, so members from before also catch up.
 */
export async function syncFieldTasks(workspaceId: string, userId: string): Promise<void> {
  const keys = Object.keys(FIELD_TASKS);
  const [m, goal, rows, lib] = await Promise.all([
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)) }),
    db.query.goals.findFirst({ where: and(eq(schema.goals.workspaceId, workspaceId), eq(schema.goals.userId, userId), eq(schema.goals.primary, true)) }),
    db.query.pathwayProgress.findMany({ where: and(eq(schema.pathwayProgress.workspaceId, workspaceId), eq(schema.pathwayProgress.userId, userId), inArray(schema.pathwayProgress.libraryTaskKey, keys)) }),
    db.query.libraryTasks.findMany({ where: inArray(schema.libraryTasks.key, keys) }),
  ]);
  if (!m) return;
  const done = fieldTaskStatus({ bigPromise: m.bigPromise, audience: m.audience, goalTarget: goal?.target ?? 0 });
  const now = nowIso();
  for (const key of keys) {
    const row = rows.find((r) => r.libraryTaskKey === key);
    const task = lib.find((t) => t.key === key);
    if (!task) continue;
    if (done[key] && row?.status !== "verified") {
      if (row) await db.update(schema.pathwayProgress).set({ status: "verified", submittedAt: row.submittedAt ?? now, verifiedAt: now, verifiedBy: "auto" }).where(eq(schema.pathwayProgress.id, row.id));
      else await db.insert(schema.pathwayProgress).values({ id: newId(), workspaceId, userId, libraryTaskKey: key, status: "verified", submittedAt: now, verifiedAt: now, verifiedBy: "auto" });
      await award({ workspaceId, userId }, "pathway", task.points, `Pathway: ${task.name}`, key);
    } else if (!done[key] && row?.status === "verified" && row.verifiedBy === "auto") {
      await db.update(schema.pathwayProgress).set({ status: "todo", verifiedAt: null, verifiedBy: null }).where(eq(schema.pathwayProgress.id, row.id));
    }
  }
}
