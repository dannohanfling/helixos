/**
 * Tasks, the one copy of their rules (connector step 1, rev 380): adding (a double tap is one task), ticking (points once per
 * task, a repeating task spawns its next row), un-ticking, and moving a due date. The form actions in
 * src/lib/actions/tasks.ts parse the form and call these; the connector's tools in src/lib/mcp/tools/tasks.ts call the same
 * functions. Every write is scoped to the viewer's own rows.
 */
import { and, asc, desc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { addDays, nowIso } from "@/lib/dates";
import { taskPoints } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";

export const TASK_URGENCIES = ["top3", "high", "medium", "low"] as const;
export const TASK_CATEGORIES = ["sales", "content", "community", "system", "admin", "fulfillment"] as const;
export type TaskUrgency = (typeof TASK_URGENCIES)[number];
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type NewTask = { title: string; details?: string | null; urgency?: string | null; category?: string | null; dueDate?: string | null; repeatEveryDays?: number | null };

/**
 * A new task for the viewer. Due today unless a date is given; a Top 3 task due today is starred for today. The same title from
 * the same person in the last 20 seconds is the same task (a double tap), handed back with `created: false`.
 */
export async function addTask(v: Viewer, input: NewTask): Promise<{ task: schema.Task; created: boolean } | null> {
  const title = input.title.trim().slice(0, 300);
  if (!title) return null;
  const userId = v.user.id;
  const urgency = TASK_URGENCIES.find((u) => u === input.urgency) ?? "medium";
  const category = TASK_CATEGORIES.find((c) => c === input.category) ?? "sales";
  const dueDate = input.dueDate && DATE.test(input.dueDate) ? input.dueDate : v.today;
  const repeat = input.repeatEveryDays && input.repeatEveryDays > 0 ? Math.round(input.repeatEveryDays) : null;
  const recent = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.title, title), gte(schema.tasks.createdAt, new Date(Date.now() - 20_000).toISOString().replace("T", " ").slice(0, 19))) });
  if (recent) return { task: recent, created: false };
  const id = newId();
  await db.insert(schema.tasks).values({
    id,
    workspaceId: v.workspace.id,
    userId,
    title,
    details: input.details?.trim() || null,
    urgency,
    category,
    dueDate,
    status: dueDate <= v.today ? "today" : "upcoming",
    focusDate: urgency === "top3" && dueDate === v.today ? v.today : null,
    points: taskPoints(urgency),
    repeatEveryDays: repeat,
  });
  return { task: (await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) }))!, created: true };
}

/** One of the viewer's own tasks by id, or undefined. */
export const ownTask = (v: Viewer, id: string) => db.query.tasks.findFirst({ where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, v.user.id)) });

export type Ticked = { done: boolean; points: number; awarded: boolean; next: schema.Task | null };

/**
 * Ticks an open task (points once per task id, however often it is ticked and un-ticked; a repeating task's next row appears
 * on its next date) or un-ticks a done one (back to today or upcoming by its date; the points stay, as on the page).
 */
export async function toggleTask(v: Viewer, task: schema.Task): Promise<Ticked> {
  const userId = v.user.id;
  if (task.status === "done") {
    await db.update(schema.tasks).set({ status: task.dueDate && task.dueDate <= v.today ? "today" : "upcoming", completedAt: null }).where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.userId, userId)));
    return { done: false, points: 0, awarded: false, next: null };
  }
  await db.update(schema.tasks).set({ status: "done", completedAt: nowIso() }).where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.userId, userId)));
  const points = taskPoints(task.urgency, task.points);
  const awarded = await award({ workspaceId: v.workspace.id, userId }, "task", points, `Task: ${task.title}`, task.id);
  let next: schema.Task | null = null;
  if (task.repeatEveryDays) {
    const id = newId();
    await db.insert(schema.tasks).values({
      id,
      workspaceId: v.workspace.id,
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
    next = (await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) })) ?? null;
  }
  return { done: true, points, awarded, next };
}

/** A new due date (tomorrow when none is given); the task leaves today's Top 3. */
export async function rescheduleTask(v: Viewer, id: string, date?: string | null): Promise<string> {
  const dueDate = date && DATE.test(date) ? date : addDays(v.today, 1);
  await db
    .update(schema.tasks)
    .set({ dueDate, status: dueDate <= v.today ? "today" : "upcoming", focusDate: null })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, v.user.id)));
  return dueDate;
}

/* ───────── Reading, for the connector ───────── */

/** A task still in the member's list: not an imported one waiting for review (those show only on Tasks' review tab). */
const inPlay = isNull(schema.tasks.reviewState);

export type TaskLists = { top3: schema.Task[]; dueToday: schema.Task[]; overdue: schema.Task[]; upcoming: schema.Task[]; doneToday: schema.Task[] };

/** What Today and Tasks show: today's Top 3, the rest due today, overdue, the next seven days, and what was ticked today. */
export async function taskLists(v: Viewer): Promise<TaskLists> {
  const userId = v.user.id;
  const mine = and(eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, v.workspace.id), inPlay);
  const [top3, due, overdue, upcoming, doneToday] = await Promise.all([
    db.query.tasks.findMany({ where: and(mine, eq(schema.tasks.focusDate, v.today)), orderBy: [asc(schema.tasks.status), asc(schema.tasks.createdAt)] }),
    db.query.tasks.findMany({ where: and(mine, ne(schema.tasks.status, "done"), eq(schema.tasks.dueDate, v.today)), orderBy: asc(schema.tasks.createdAt) }),
    db.query.tasks.findMany({ where: and(mine, ne(schema.tasks.status, "done"), lt(schema.tasks.dueDate, v.today)), orderBy: asc(schema.tasks.dueDate) }),
    db.query.tasks.findMany({ where: and(mine, ne(schema.tasks.status, "done"), sql`${schema.tasks.dueDate} between ${addDays(v.today, 1)} and ${addDays(v.today, 7)}`), orderBy: asc(schema.tasks.dueDate), limit: 25 }),
    db.query.tasks.findMany({ where: and(mine, eq(schema.tasks.status, "done"), sql`substr(${schema.tasks.completedAt}, 1, 10) = ${v.today}`), orderBy: desc(schema.tasks.completedAt) }),
  ]);
  const topIds = new Set(top3.map((t) => t.id));
  return { top3, dueToday: due.filter((t) => !topIds.has(t.id)), overdue: overdue.filter((t) => !topIds.has(t.id)), upcoming, doneToday };
}

/** Open tasks to pick from by title, and the recently done ones to un-tick. */
export async function openTasks(v: Viewer): Promise<schema.Task[]> {
  return db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, v.user.id), eq(schema.tasks.workspaceId, v.workspace.id), inPlay, ne(schema.tasks.status, "done")), orderBy: [asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)], limit: 200 });
}
export async function recentlyDone(v: Viewer): Promise<schema.Task[]> {
  return db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, v.user.id), eq(schema.tasks.workspaceId, v.workspace.id), eq(schema.tasks.status, "done")), orderBy: desc(schema.tasks.completedAt), limit: 60 });
}

/** A task by its title: an exact match (case aside) first, else the one whose title contains the words, else the titles to pick from. */
export function byTitle(tasks: schema.Task[], title: string, what = "open task"): schema.Task {
  const n = String(title ?? "").trim().toLowerCase();
  const exact = tasks.filter((t) => t.title.toLowerCase() === n);
  if (exact.length) return exact[0];
  const partial = n ? tasks.filter((t) => t.title.toLowerCase().includes(n)) : [];
  if (partial.length === 1) return partial[0];
  const titles = [...new Set((partial.length ? partial : tasks).map((t) => t.title))];
  if (!tasks.length) throw new Error(`There's no ${what} to pick from.`);
  throw new Error(`No ${what} called "${title}"${partial.length ? ` exactly; ${partial.length} match it` : ""}. Pick from: ${titles.slice(0, 25).join(", ")}${titles.length > 25 ? "…" : ""}.`);
}
