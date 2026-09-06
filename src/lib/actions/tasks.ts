"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { addDays, nowIso } from "@/lib/dates";
import { taskPoints } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";

const URGENCY = ["top3", "high", "medium", "low"] as const;
const CATEGORY = ["sales", "content", "community", "system", "admin", "fulfillment"] as const;

export async function createTaskAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const title = str(formData, "title");
  if (!title) return;
  const urgency = URGENCY.find((u) => u === str(formData, "urgency")) ?? "medium";
  const category = CATEGORY.find((c) => c === str(formData, "category")) ?? "sales";
  const dueDate = opt(formData, "dueDate") ?? v.today;
  const repeat = num(formData, "repeatEveryDays") || null;
  await db.insert(schema.tasks).values({
    id: newId(),
    workspaceId,
    userId,
    title,
    details: opt(formData, "details"),
    urgency,
    category,
    dueDate,
    status: dueDate <= v.today ? "today" : "upcoming",
    focusDate: urgency === "top3" && dueDate === v.today ? v.today : null,
    points: taskPoints(urgency),
    repeatEveryDays: repeat,
  });
  refresh();
}

export async function toggleTaskAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const task = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)) });
  if (!task) return;
  if (task.status === "done") {
    await db.update(schema.tasks).set({ status: task.dueDate && task.dueDate <= v.today ? "today" : "upcoming", completedAt: null }).where(eq(schema.tasks.id, id));
  } else {
    await db.update(schema.tasks).set({ status: "done", completedAt: nowIso() }).where(eq(schema.tasks.id, id));
    await award({ workspaceId, userId }, "task", taskPoints(task.urgency, task.points), `Task: ${task.title}`, task.id);
    if (task.repeatEveryDays) {
      await db.insert(schema.tasks).values({
        id: newId(),
        workspaceId,
        userId,
        title: task.title,
        details: task.details,
        urgency: task.urgency === "top3" ? "high" : task.urgency,
        category: task.category,
        dueDate: addDays(task.dueDate ?? v.today, task.repeatEveryDays),
        status: "upcoming",
        points: task.points,
        repeatEveryDays: task.repeatEveryDays,
        source: "repeat",
        sourceRef: task.id,
      });
    }
  }
  refresh();
}

export async function rescheduleTaskAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const id = str(formData, "id");
  const dueDate = opt(formData, "dueDate") ?? addDays(v.today, 1);
  await db
    .update(schema.tasks)
    .set({ dueDate, status: dueDate <= v.today ? "today" : "upcoming", focusDate: null })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)));
  refresh();
}

export async function setFocusAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const id = str(formData, "id");
  const on = str(formData, "on") === "1";
  await db
    .update(schema.tasks)
    .set(on ? { focusDate: v.today, urgency: "top3", status: "today", dueDate: v.today } : { focusDate: null })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)));
  refresh();
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.tasks).where(and(eq(schema.tasks.id, str(formData, "id")), eq(schema.tasks.userId, userId)));
  refresh();
}
