/**
 * This week's 3-1-3, the one copy of how it is saved (handoff rev 124): the week is the member's current one; the tasks become the
 * week's Tasks, due Friday (or the day set, on a weekend): an edit renames each open one in its slot, adds a new one, and removes
 * one taken off unless it is already done; a key result keeps its mark only while its words are unchanged. The Intentions form
 * and the Board's set-up both call it.
 */
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { IntentionTask } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { queueProgress } from "@/lib/chat-progress";
import { soundsLikeTask, tasksDueOn, weekOf, type IntentionInput } from "@/lib/engine/intentions";

export async function saveWeekIntention(m: { workspaceId: string; userId: string; today: string }, value: IntentionInput): Promise<{ created: boolean }> {
  const { workspaceId, userId } = m;
  const week = weekOf(m.today);
  const v = { today: m.today };
  const existing = await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, workspaceId), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.weekOf, week)) });
  const before = existing?.tasks ?? [];
  const tasks: IntentionTask[] = [];
  for (const [i, title] of value.tasks.entries()) {
    const prior = before[i]?.taskId;
    if (prior) {
      await db.update(schema.tasks).set({ title }).where(and(eq(schema.tasks.id, prior), eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, workspaceId)));
      tasks.push({ title, taskId: prior });
    } else {
      const id = newId();
      await db.insert(schema.tasks).values({ id, workspaceId, userId, title, status: "upcoming", urgency: "high", dueDate: tasksDueOn(v.today), source: "intention", sourceRef: week });
      tasks.push({ title, taskId: id });
    }
  }
  for (const gone of before.slice(value.tasks.length)) {
    if (gone.taskId) await db.delete(schema.tasks).where(and(eq(schema.tasks.id, gone.taskId), eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, workspaceId), ne(schema.tasks.status, "done")));
  }
  // A key result keeps its mark only while its words are unchanged.
  // One saved as written though it reads like a task is marked for the coach (rev 158: the nudge asks, it never blocks).
  const keyResults = value.keyResults.map((text, i) => {
    const same = existing?.keyResults[i]?.text === text ? existing.keyResults[i] : null;
    return { text, done: same ? same.done : null, actual: same?.actual ?? null, ...(soundsLikeTask(text) ? { kept: true } : {}) };
  });
  if (existing) {
    await db
      .update(schema.weeklyIntentions)
      .set({ word: value.word, keyResults, initiative: value.initiative, tasks, updatedAt: nowIso() })
      .where(and(eq(schema.weeklyIntentions.id, existing.id), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.workspaceId, workspaceId)));
    return { created: false };
  }
  await db.insert(schema.weeklyIntentions).values({ id: newId(), workspaceId, userId, weekOf: week, word: value.word, keyResults, initiative: value.initiative, tasks }).onConflictDoNothing();
  // The coach's assistant learns the week (rev 241), after the response.
  queueProgress(workspaceId, userId, "intention_set");
  return { created: true };
}
