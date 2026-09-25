"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import type { IntentionTask } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { readIntention, tasksDueOn, weekOf } from "@/lib/engine/intentions";

/**
 * Set or edit this week's 3-1-3 (handoff rev 124). The week is always the member's current one, from the session's own date,
 * never from the form. The tasks become the week's Tasks, due Friday (or the day set, on a weekend): an edit renames each open one in its slot, adds a new one,
 * and removes one the member has taken off unless it is already done; a done task stays done.
 */
export async function saveIntentionAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const week = weekOf(v.today);
  const read = readIntention({
    word: str(formData, "word"),
    kr: [str(formData, "kr1"), str(formData, "kr2"), str(formData, "kr3")],
    initiative: str(formData, "initiative"),
    tasks: [str(formData, "task1"), str(formData, "task2"), str(formData, "task3")],
  });
  if ("error" in read) redirect(`/today?weekError=${encodeURIComponent(read.error)}#week`);
  const { value } = read;
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
  const keyResults = value.keyResults.map((text, i) => ({ text, done: existing?.keyResults[i]?.text === text ? existing.keyResults[i].done : null }));
  if (existing) {
    await db
      .update(schema.weeklyIntentions)
      .set({ word: value.word, keyResults, initiative: value.initiative, tasks, updatedAt: nowIso() })
      .where(and(eq(schema.weeklyIntentions.id, existing.id), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.workspaceId, workspaceId)));
  } else {
    await db.insert(schema.weeklyIntentions).values({ id: newId(), workspaceId, userId, weekOf: week, word: value.word, keyResults, initiative: value.initiative, tasks }).onConflictDoNothing();
  }
  refresh();
  redirect("/today?weekSaved=1#week");
}

/** The end-of-week check: each key result done or not done, all at once. Only this week's, and only once it is set. */
export async function reviewIntentionAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const week = weekOf(v.today);
  const existing = await db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, workspaceId), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.weekOf, week)) });
  if (!existing) redirect("/today#week");
  const marks = existing.keyResults.map((k, i) => ({ text: k.text, mark: str(formData, `kr${i + 1}`) }));
  if (marks.some((m) => m.mark !== "done" && m.mark !== "not")) redirect(`/today?weekError=${encodeURIComponent("Mark each key result done or not done.")}#week`);
  const keyResults = marks.map((m) => ({ text: m.text, done: m.mark === "done" }));
  await db
    .update(schema.weeklyIntentions)
    .set({ keyResults, reviewedAt: nowIso(), updatedAt: nowIso() })
    .where(and(eq(schema.weeklyIntentions.id, existing.id), eq(schema.weeklyIntentions.userId, userId), eq(schema.weeklyIntentions.workspaceId, workspaceId)));
  refresh();
  redirect("/today?weekReviewed=1#week");
}
