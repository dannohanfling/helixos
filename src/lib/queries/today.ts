import { and, asc, desc, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { nextBestActions, type Action, type Snapshot } from "@/lib/engine/nba";
import { tierProgress } from "@/lib/engine/tiers";
import { logFor, streakFor } from "./daily";
import { totalPoints } from "./points";

export async function nextPathwayTask(userId: string) {
  const rows = await db
    .select({
      key: schema.libraryTasks.key,
      name: schema.libraryTasks.name,
      points: schema.libraryTasks.points,
      stageKey: schema.libraryTasks.stageKey,
      status: schema.pathwayProgress.status,
    })
    .from(schema.pathwayProgress)
    .innerJoin(schema.libraryTasks, eq(schema.libraryTasks.key, schema.pathwayProgress.libraryTaskKey))
    .innerJoin(schema.pathwayStages, eq(schema.pathwayStages.key, schema.libraryTasks.stageKey))
    .where(and(eq(schema.pathwayProgress.userId, userId), inArray(schema.pathwayProgress.status, ["todo", "revision"])))
    .orderBy(
      sql`case ${schema.libraryTasks.priority} when 'must' then 0 when 'should' then 1 when 'nice' then 2 else 3 end`,
      asc(schema.pathwayStages.order),
      asc(schema.libraryTasks.order),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function currentCurriculumDay(userId: string) {
  const done = await db.query.curriculumProgress.findMany({ where: eq(schema.curriculumProgress.userId, userId) });
  const doneDays = new Set(done.map((d) => d.day));
  const days = await db.query.curriculumDays.findMany({ orderBy: asc(schema.curriculumDays.day) });
  return days.find((d) => !doneDays.has(d.day)) ?? null;
}

export async function todayData(v: Viewer) {
  const { user, today, hour } = v;
  const userId = user.id;
  const tomorrow = addDays(today, 1);

  const [log, streak, points, focusTasks, dueTasks, overdueTasks, contentDue, contentOverdue, followUps, inbound, revisions, pathwayNext, curriculumDay, goal] =
    await Promise.all([
      logFor(userId, today),
      streakFor(userId, today),
      totalPoints(userId),
      db.query.tasks.findMany({
        where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.focusDate, today)),
        orderBy: [asc(schema.tasks.status), asc(schema.tasks.createdAt)],
      }),
      db.query.tasks.findMany({
        where: and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"), eq(schema.tasks.dueDate, today)),
        orderBy: asc(schema.tasks.createdAt),
      }),
      db.query.tasks.findMany({
        where: and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"), lt(schema.tasks.dueDate, today)),
        orderBy: asc(schema.tasks.dueDate),
      }),
      db.query.contentItems.findMany({
        where: and(
          eq(schema.contentItems.userId, userId),
          ne(schema.contentItems.status, "posted"),
          sql`substr(${schema.contentItems.postAt}, 1, 10) = ${today}`,
        ),
        orderBy: asc(schema.contentItems.postAt),
      }),
      db.query.contentItems.findMany({
        where: and(
          eq(schema.contentItems.userId, userId),
          ne(schema.contentItems.status, "posted"),
          sql`substr(${schema.contentItems.postAt}, 1, 10) < ${today}`,
        ),
        orderBy: asc(schema.contentItems.postAt),
      }),
      db.query.contacts.findMany({
        where: and(
          eq(schema.contacts.userId, userId),
          ne(schema.contacts.stage, "cold"),
          ne(schema.contacts.stage, "client"),
          lte(schema.contacts.nextFollowUpAt, today),
        ),
        orderBy: asc(schema.contacts.nextFollowUpAt),
      }),
      db.query.contacts.findMany({
        where: and(
          eq(schema.contacts.userId, userId),
          ne(schema.contacts.stage, "cold"),
          ne(schema.contacts.stage, "client"),
          or(isNull(schema.contacts.lastOutboundAt), sql`${schema.contacts.lastInboundAt} > ${schema.contacts.lastOutboundAt}`),
          sql`${schema.contacts.lastInboundAt} is not null`,
        ),
        orderBy: desc(schema.contacts.lastInboundAt),
      }),
      db.query.pathwayProgress.findMany({ where: and(eq(schema.pathwayProgress.userId, userId), eq(schema.pathwayProgress.status, "revision")) }),
      nextPathwayTask(userId),
      currentCurriculumDay(userId),
      db.query.goals.findFirst({ where: and(eq(schema.goals.userId, userId), eq(schema.goals.primary, true)) }),
    ]);

  const snapshot: Snapshot = {
    today,
    hour,
    morningDone: Boolean(log?.morningDoneAt),
    eveningDone: Boolean(log?.eveningDoneAt),
    overdueTasks: overdueTasks.length,
    focusTasksOpen: focusTasks.filter((t) => t.status !== "done").length,
    followUpsDue: followUps.length,
    unansweredInbound: inbound.length,
    contentDueToday: contentDue.length,
    contentOverdue: contentOverdue.length,
    nextPathwayTask: pathwayNext ? { key: pathwayNext.key, name: pathwayNext.name, points: pathwayNext.points } : null,
    pendingRevision: revisions.length,
    curriculumDay: curriculumDay ? { day: curriculumDay.day, title: curriculumDay.title, points: curriculumDay.points } : null,
    streakAlive: streak.running > 0,
    runningStreak: streak.running,
  };
  const actions: Action[] = nextBestActions(snapshot);

  const upcomingTasks = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"), sql`${schema.tasks.dueDate} between ${tomorrow} and ${addDays(today, 7)}`),
    orderBy: asc(schema.tasks.dueDate),
    limit: 6,
  });
  const openTasks = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done")),
    orderBy: [asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)],
    limit: 40,
  });

  return {
    log: log ?? null,
    streak: streak.running,
    points,
    tier: tierProgress(points),
    focusTasks,
    dueTasks,
    overdueTasks,
    upcomingTasks,
    openTasks,
    contentDue: [...contentOverdue, ...contentDue],
    followUps,
    inbound,
    pathwayNext,
    curriculumDay,
    goal: goal ?? null,
    actions,
    snapshot,
  };
}
