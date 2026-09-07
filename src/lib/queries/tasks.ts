import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { taskPoints } from "@/lib/engine/points";
import { type AssignedTask, TASK_SOURCES, type TaskSource } from "@/lib/engine/notes";

/**
 * Creates tasks in a client's normal Today and Tasks lists from any source: a coach's call note now, a recorded group
 * session later. `today` is the client's own day, so a task due today lands on Today immediately.
 */
export async function assignTasks(target: { workspaceId: string; userId: string; today: string }, origin: { source: TaskSource; sourceRef: string }, items: AssignedTask[]): Promise<string[]> {
  if (!items.length) return [];
  const rows = items.map((t) => {
    const urgency = t.urgency ?? "high";
    const dueDate = t.dueDate ?? target.today;
    return {
      id: newId(),
      workspaceId: target.workspaceId,
      userId: target.userId,
      title: t.title,
      details: t.details ?? null,
      urgency,
      category: t.category ?? ("system" as const),
      dueDate,
      status: dueDate <= target.today ? ("today" as const) : ("upcoming" as const),
      focusDate: null,
      points: t.points ?? taskPoints(urgency),
      source: origin.source,
      sourceRef: origin.sourceRef,
    };
  });
  await db.insert(schema.tasks).values(rows);
  return rows.map((r) => r.id);
}

export type TaskOrigin = { source: string; date: string | null };

/** For the tasks a page is about to render: where each non-manual one came from, so the row can say so. */
export async function taskOrigins(tasks: { id: string; source: string; sourceRef: string | null }[]): Promise<Map<string, TaskOrigin>> {
  const out = new Map<string, TaskOrigin>();
  const fromCalls = tasks.filter((t) => t.source === TASK_SOURCES.coachCall && t.sourceRef);
  if (!fromCalls.length) return out;
  const notes = await db.query.coachNotes.findMany({ where: inArray(schema.coachNotes.id, [...new Set(fromCalls.map((t) => t.sourceRef!))]) });
  const dateOf = new Map(notes.map((n) => [n.id, n.date]));
  for (const t of fromCalls) out.set(t.id, { source: t.source, date: dateOf.get(t.sourceRef!) ?? null });
  return out;
}

/** Tasks created from one note, for the coach's view of what came out of a call. */
export async function tasksFromNotes(workspaceId: string, noteIds: string[]) {
  if (!noteIds.length) return [];
  return db.query.tasks.findMany({ where: and(eq(schema.tasks.workspaceId, workspaceId), eq(schema.tasks.source, TASK_SOURCES.coachCall), inArray(schema.tasks.sourceRef, noteIds)) });
}
