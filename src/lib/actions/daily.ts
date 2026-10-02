"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { POINTS } from "@/lib/engine/points";
import { closedDates, repairsUsed } from "@/lib/queries/daily";
import { CLOSE_EXTRA, CLOSE_NUMBERS, CLOSE_TEXT, closeDay, lockIn, upsertLog, type Close } from "@/lib/daily-core";
import { brokenStreak } from "@/lib/engine/streak";
import { isWeekday } from "@/lib/dates";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";

export async function morningCheckinAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "The lock-in, the close and the streak are {first}'s own." });
  const newFocus = str(formData, "newFocus");
  // The rules (the redo, a typed title finding the open task instead of a second one, the points) are in src/lib/daily-core.ts.
  await lockIn(v, { energy: num(formData, "energy") || 3, intention: opt(formData, "intention"), focusIds: formData.getAll("focus").map(String).filter(Boolean).slice(0, 3), newTitles: newFocus ? [newFocus] : [] });
  refresh();
}

export async function eveningCloseAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "The lock-in, the close and the streak are {first}'s own." });
  // The form sends every field: optional groups left collapsed simply stay at zero, a blank line is cleared.
  const input: Close = {};
  for (const k of [...CLOSE_NUMBERS, ...CLOSE_EXTRA]) input[k] = num(formData, k);
  for (const k of CLOSE_TEXT) input[k] = opt(formData, k);
  await closeDay(v, input);
  refresh();
}

/**
 * Mends a broken streak by closing the one missed weekday after the fact. One per calendar month, only when exactly one weekday
 * was missed and it is within the last week. No points: the day is marked closed and repaired, the running streak survives,
 * the weekly bonus still restarts at day 1.
 */
export async function repairStreakAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "The lock-in, the close and the streak are {first}'s own." });
  const date = str(formData, "date");
  const closed = await closedDates(workspaceId, userId);
  const broken = brokenStreak(closed, v.today);
  if (!broken || !broken.repairable || broken.missed[0] !== date || !isWeekday(date)) return;
  if ((await repairsUsed(workspaceId, userId, v.today.slice(0, 7))) >= 1) return;
  const log = await upsertLog(workspaceId, userId, date);
  if (log.eveningDoneAt) return;
  await db.update(schema.dailyLogs).set({ eveningDoneAt: nowIso(), repairedAt: nowIso(), streakDay: 0, win: log.win ?? "Streak repaired" }).where(eq(schema.dailyLogs.id, log.id));
  refresh();
}

/**
 * A new task typed in the morning lock-in (handoff rev 157): added straight away as a real task for today, due today, so it is
 * on Tasks too, and handed back for the pick list. The same title twice finds the open task instead of making a second one.
 */
export async function addTodayTaskAction(title: string): Promise<{ ok: true; task: { id: string; title: string } } | { ok: false; error: string }> {
  const { v, workspaceId, userId } = await ctx();
  const t = title.trim().slice(0, 200);
  if (!t) return { ok: false, error: "Type the task first." };
  const existing = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, workspaceId), ne(schema.tasks.status, "done"), sql`lower(${schema.tasks.title}) = lower(${t})`) });
  if (existing) {
    // An imported task waiting for review, typed here, joins the member's list (30 Sep).
    if (existing.reviewState) await db.update(schema.tasks).set({ reviewState: null }).where(and(eq(schema.tasks.id, existing.id), eq(schema.tasks.workspaceId, workspaceId)));
    return { ok: true, task: { id: existing.id, title: existing.title } };
  }
  const id = newId();
  await db.insert(schema.tasks).values({ id, workspaceId, userId, title: t, urgency: "medium", status: "today", dueDate: v.today, points: POINTS.task });
  return { ok: true, task: { id, title: t } };
}

/** One tap takes back a task just added in the lock-in: only an open one of the member's own, added today and not yet picked. */
export async function removeTodayTaskAction(id: string): Promise<{ ok: boolean }> {
  const { v, workspaceId, userId } = await ctx();
  await db.delete(schema.tasks).where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId), eq(schema.tasks.workspaceId, workspaceId), ne(schema.tasks.status, "done"), eq(schema.tasks.dueDate, v.today), sql`${schema.tasks.focusDate} is null`, sql`date(${schema.tasks.createdAt}) >= date(${v.today}, '-1 day')`));
  return { ok: true };
}
