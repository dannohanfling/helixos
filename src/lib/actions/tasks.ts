"use server";

import { redirect } from "next/navigation";
import { deletedTo } from "@/lib/deleted";
import { and, eq, isNotNull, ne, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";
import { addTask, ownTask, rescheduleTask, toggleTask } from "@/lib/tasks-core";

export async function createTaskAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ team: "allow" });
  // The rules (the double-tap guard, the dates, the star for a Top 3 due today) are in src/lib/tasks-core.ts.
  await addTask(v, { title: str(formData, "title"), details: opt(formData, "details"), urgency: str(formData, "urgency"), category: str(formData, "category"), dueDate: opt(formData, "dueDate"), repeatEveryDays: num(formData, "repeatEveryDays") || null });
  refresh();
}

export async function toggleTaskAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ team: "allow" });
  const task = await ownTask(v, str(formData, "id"));
  if (!task) return;
  await toggleTask(v, task);
  refresh();
}

export async function rescheduleTaskAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ team: "allow" });
  await rescheduleTask(v, str(formData, "id"), opt(formData, "dueDate"));
  refresh();
}

export async function setFocusAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const on = str(formData, "on") === "1";
  await db
    .update(schema.tasks)
    .set(on ? { focusDate: v.today, urgency: "top3", status: "today", dueDate: v.today } : { focusDate: null })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)));
  refresh();
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  await db.delete(schema.tasks).where(and(eq(schema.tasks.id, str(formData, "id")), eq(schema.tasks.userId, userId)));
  refresh();
  // A task is deleted from Today or Tasks; the person stays on whichever it was, with the line saying it went.
  const from = str(formData, "from");
  redirect(deletedTo(from === "/today" ? "/today" : "/tasks", "task"));
}

/**
 * An imported task waiting for review (30 Sep): Keep makes it an ordinary task of theirs, Done files it as history, Let go hides
 * it (never deleted; the Let go tab brings it back). Housekeeping, so Done here earns no points: the work was done before HelixOS.
 */
export async function reviewImportedTaskAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const choice = str(formData, "choice");
  const set =
    choice === "done" ? { status: "done" as const, completedAt: nowIso(), reviewState: null, focusDate: null } : choice === "let_go" ? { reviewState: "let_go" as const, focusDate: null } : { reviewState: null };
  await db
    .update(schema.tasks)
    .set(set)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, workspaceId), isNotNull(schema.tasks.reviewState)));
  refresh();
}

/** One press keeps every imported task still waiting that is dated after today, as their own; the rest stay to review. */
export async function keepFutureImportedTasksAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  await db
    .update(schema.tasks)
    .set({ reviewState: null })
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, workspaceId), eq(schema.tasks.reviewState, "to_review"), ne(schema.tasks.status, "done"), gt(schema.tasks.dueDate, v.today)));
  refresh();
}
