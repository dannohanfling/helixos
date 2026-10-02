/**
 * The connector's Tasks tools (connector step 1, rev 380; Danno's order at rev 418): list, add, tick, un-tick and move a
 * task, through the same functions the Tasks page uses (src/lib/tasks-core.ts), so a task added by voice follows every rule a
 * typed one does. Reads answer in a plain line and then JSON; writes say what changed. Nothing here deletes a task.
 */
import { z } from "zod";
import type { Viewer } from "@/lib/auth";
import type { Task } from "@/db/schema";
import { defineTool, type ToolResult } from "@/lib/mcp/registry";
import { TASK_CATEGORIES, TASK_URGENCIES, addTask, byTitle, openTasks, recentlyDone, rescheduleTask, taskLists, toggleTask } from "@/lib/tasks-core";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URGENCY_WORDS: Record<string, string> = { top3: "Top 3", high: "high", medium: "medium", low: "low" };

/** One task as the tools speak of it. */
export const taskData = (t: Task) => ({ title: t.title, done: t.status === "done", due: t.dueDate, urgency: t.urgency, category: t.category, points: t.points, repeatsEveryDays: t.repeatEveryDays, details: t.details });
const line = (t: Task, today: string) => `${t.status === "done" ? "✓ " : ""}${t.title}${t.dueDate && t.dueDate !== today ? ` (due ${t.dueDate})` : ""}${t.repeatEveryDays ? `, repeats every ${t.repeatEveryDays} days` : ""}`;
const list = (ts: Task[], today: string) => (ts.length ? ts.map((t) => line(t, today)).join("; ") : "none");

function dateArg(v: Viewer, raw: unknown, what: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (s.toLowerCase() === "today") return v.today;
  if (!DATE.test(s)) throw new Error(`${what} must be a date as YYYY-MM-DD (today is ${v.today}).`);
  return s;
}

export const tasksList = defineTool({
  name: "tasks_list",
  scope: "tasks",
  kind: "read",
  description: "The member's tasks as Today and Tasks show them: today's Top 3 (with ticks), the rest due today, overdue, the next seven days, and what was ticked today. Use the titles here to tick or move one.",
  input: {},
  handler: async (v): Promise<ToolResult> => {
    const l = await taskLists(v);
    const text = [
      `Today is ${v.today}.`,
      `Top 3: ${list(l.top3, v.today)}.`,
      `Also due today: ${list(l.dueToday, v.today)}.`,
      `Overdue: ${list(l.overdue, v.today)}.`,
      `Next 7 days: ${list(l.upcoming, v.today)}.`,
      `Ticked today: ${l.doneToday.length ? l.doneToday.map((t) => t.title).join("; ") : "nothing yet"}.`,
    ].join("\n");
    return { text, data: { today: v.today, top3: l.top3.map(taskData), dueToday: l.dueToday.map(taskData), overdue: l.overdue.map(taskData), upcoming: l.upcoming.map(taskData), doneToday: l.doneToday.map(taskData) } };
  },
});

export const tasksAdd = defineTool({
  name: "tasks_add",
  scope: "tasks",
  kind: "write",
  description: "Adds a task to the member's list, due today unless a date is given. Optional notes, a category, how urgent it is (top3 stars it for today when it is due today), and a repeat every N days.",
  input: {
    title: z.string().min(1).max(300).describe("What the task is, in the member's words"),
    notes: z.string().max(2000).optional().describe("Any detail to keep with it"),
    due: z.string().optional().describe("YYYY-MM-DD, or 'today'; today when left out"),
    category: z.enum(TASK_CATEGORIES).optional().describe("sales (the default), content, community, system, admin or fulfillment"),
    urgency: z.enum(TASK_URGENCIES).optional().describe("top3, high, medium (the default) or low"),
    repeat_every_days: z.number().int().min(1).max(365).optional().describe("Repeats this many days after each tick"),
  },
  handler: async (v, input): Promise<ToolResult> => {
    const r = await addTask(v, { title: String(input.title ?? ""), details: input.notes ? String(input.notes) : null, urgency: (input.urgency as string) ?? null, category: (input.category as string) ?? null, dueDate: dateArg(v, input.due, "due"), repeatEveryDays: (input.repeat_every_days as number) ?? null });
    if (!r) throw new Error("Say what the task is: the title was empty.");
    const t = r.task;
    const text = r.created
      ? `Added "${t.title}", due ${t.dueDate === v.today ? "today" : t.dueDate}${t.focusDate === v.today ? ", starred in today's Top 3" : ""}${t.urgency !== "medium" ? `, ${URGENCY_WORDS[t.urgency]}` : ""}${t.repeatEveryDays ? `, repeating every ${t.repeatEveryDays} days` : ""}. Worth ${t.points} points when ticked.`
      : `"${t.title}" was added a moment ago; it's the same task, not a second one.`;
    return { text, data: { created: r.created, task: taskData(t) } };
  },
});

export const tasksComplete = defineTool({
  name: "tasks_complete",
  scope: "tasks",
  kind: "write",
  description: "Ticks one of the member's open tasks by its title (an exact title, or words only one open task contains). Scores its points once; a repeating task's next one appears on its next date.",
  input: { title: z.string().min(1).describe("The task's title, or words from it") },
  handler: async (v, input): Promise<ToolResult> => {
    const task = byTitle(await openTasks(v), String(input.title ?? ""));
    const r = await toggleTask(v, task);
    const text = `Ticked "${task.title}".${r.awarded ? ` +${r.points} points.` : " Its points were already scored the first time it was ticked."}${r.next ? ` Next one due ${r.next.dueDate}.` : ""}`;
    return { text, data: { task: { ...taskData(task), done: true }, points: r.awarded ? r.points : 0, next: r.next ? taskData(r.next) : null } };
  },
});

export const tasksUncomplete = defineTool({
  name: "tasks_uncomplete",
  scope: "tasks",
  kind: "write",
  description: "Un-ticks a task the member ticked by mistake, by its title, back to today or upcoming by its date. The points stay, as on the Tasks page.",
  input: { title: z.string().min(1).describe("The ticked task's title, or words from it") },
  handler: async (v, input): Promise<ToolResult> => {
    const task = byTitle(await recentlyDone(v), String(input.title ?? ""), "ticked task");
    await toggleTask(v, task);
    const back = task.dueDate && task.dueDate <= v.today ? "today" : `upcoming (due ${task.dueDate})`;
    return { text: `Un-ticked "${task.title}"; it's back on ${back}.`, data: { task: { ...taskData(task), done: false } } };
  },
});

export const tasksReschedule = defineTool({
  name: "tasks_reschedule",
  scope: "tasks",
  kind: "write",
  description: "Moves one of the member's open tasks to another date (tomorrow when no date is given). A task moved off today leaves the Top 3.",
  input: { title: z.string().min(1).describe("The task's title, or words from it"), to: z.string().optional().describe("YYYY-MM-DD, or 'today'; tomorrow when left out") },
  handler: async (v, input): Promise<ToolResult> => {
    const task = byTitle(await openTasks(v), String(input.title ?? ""));
    const was = task.dueDate;
    const due = await rescheduleTask(v, task.id, dateArg(v, input.to, "to"));
    return { text: `Moved "${task.title}" from ${was ?? "no date"} to ${due === v.today ? "today" : due}.`, data: { task: { ...taskData(task), due }, was } };
  },
});
