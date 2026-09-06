"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { POINTS, closeActivityPoints } from "@/lib/engine/points";
import { streakBonus, weeklyStreakDay } from "@/lib/engine/streak";
import { closedDates } from "@/lib/queries/daily";
import { award } from "@/lib/queries/points";
import { ctx, num, opt, refresh, str } from "@/lib/action-helpers";

async function upsertLog(workspaceId: string, userId: string, date: string) {
  const existing = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, userId), eq(schema.dailyLogs.date, date)) });
  if (existing) return existing;
  const id = newId();
  await db.insert(schema.dailyLogs).values({ id, workspaceId, userId, date }).onConflictDoNothing();
  return (await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, userId), eq(schema.dailyLogs.date, date)) }))!;
}

export async function morningCheckinAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const today = v.today;
  const log = await upsertLog(workspaceId, userId, today);
  const energy = Math.min(5, Math.max(1, num(formData, "energy") || 3));
  const intention = opt(formData, "intention");
  const focusIds = formData.getAll("focus").map(String).filter(Boolean).slice(0, 3);

  await db.update(schema.dailyLogs).set({ energy, intention, morningDoneAt: log.morningDoneAt ?? nowIso() }).where(eq(schema.dailyLogs.id, log.id));

  // Reset today's open focus tasks (completed ones keep their star), then set the chosen ones.
  await db
    .update(schema.tasks)
    .set({ focusDate: null })
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.focusDate, today), ne(schema.tasks.status, "done")));
  if (focusIds.length) {
    await db
      .update(schema.tasks)
      .set({ focusDate: today, urgency: "top3", status: "today" })
      .where(and(eq(schema.tasks.userId, userId), inArray(schema.tasks.id, focusIds)));
  }
  const newFocus = str(formData, "newFocus");
  if (newFocus) {
    await db.insert(schema.tasks).values({
      id: newId(),
      workspaceId,
      userId,
      title: newFocus,
      urgency: "top3",
      status: "today",
      dueDate: today,
      focusDate: today,
      points: POINTS.top3Task,
    });
  }
  await award({ workspaceId, userId }, "checkin", POINTS.checkin, "Morning lock-in", today);
  refresh();
}

export async function eveningCloseAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const today = v.today;
  const log = await upsertLog(workspaceId, userId, today);
  const numbers = {
    dmsStarted: num(formData, "dmsStarted"),
    conversations: num(formData, "conversations"),
    callsBooked: num(formData, "callsBooked"),
    callsHeld: num(formData, "callsHeld"),
    posts: num(formData, "posts"),
    offersMade: num(formData, "offersMade"),
    newLeads: num(formData, "newLeads"),
    cashCollected: num(formData, "cashCollected"),
  };
  // Optional groups. Left collapsed, they simply stay at zero.
  const extra = {
    webinarRegs: num(formData, "webinarRegs"),
    webinarShows: num(formData, "webinarShows"),
    replayViews: num(formData, "replayViews"),
    applications: num(formData, "applications"),
    proofPosts: num(formData, "proofPosts"),
    ctaPosts: num(formData, "ctaPosts"),
    beliefPosts: num(formData, "beliefPosts"),
    storiesCreated: num(formData, "storiesCreated"),
    referralAsks: num(formData, "referralAsks"),
    revContent: num(formData, "revContent"),
    revWebinar: num(formData, "revWebinar"),
    revDm: num(formData, "revDm"),
  };
  const firstClose = !log.eveningDoneAt;
  const closed = await closedDates(workspaceId, userId);
  const streakDay = firstClose ? weeklyStreakDay(closed, today) : log.streakDay;

  await db
    .update(schema.dailyLogs)
    .set({
      ...numbers,
      ...extra,
      start: opt(formData, "start"),
      stop: opt(formData, "stop"),
      keep: opt(formData, "keep"),
      win: opt(formData, "win"),
      gratitude: opt(formData, "gratitude"),
      eveningDoneAt: log.eveningDoneAt ?? nowIso(),
      streakDay,
    })
    .where(eq(schema.dailyLogs.id, log.id));

  if (firstClose) {
    await award({ workspaceId, userId }, "close", POINTS.close, "Closed the day", today);
    const bonus = streakBonus(streakDay);
    if (bonus) await award({ workspaceId, userId }, "streak", bonus, `Streak day ${streakDay}`, today);
    const activity = closeActivityPoints(numbers);
    if (activity.total) await award({ workspaceId, userId }, "dm", activity.total, `Daily activity: ${activity.lines.map((l) => l.label).join(", ")}`, `activity:${today}`);
  }
  if (numbers.cashCollected > 0) {
    const goal = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, userId), eq(schema.goals.primary, true)) });
    if (goal && goal.unit === "$" && firstClose) {
      await db.update(schema.goals).set({ actual: goal.actual + numbers.cashCollected }).where(eq(schema.goals.id, goal.id));
    }
  }
  refresh();
}
