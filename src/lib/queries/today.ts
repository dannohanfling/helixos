import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { nextBestActions, type Action, type Snapshot } from "@/lib/engine/nba";
import { tierProgress } from "@/lib/engine/tiers";
import { simplePath } from "@/lib/engine/pathway";
import { closedDates, logFor, repairsUsed, streakFor, todayActivity } from "./daily";
import { brokenStreak } from "@/lib/engine/streak";
import { STEPS, nextStep, webinarProgress } from "@/lib/engine/webinar";
import { totalPoints } from "./points";

/** The one pathway task to show today: revisions first, then the next must-do on the simple path. */
export async function nextPathwayTask(userId: string) {
  const [stages, library, progress] = await Promise.all([
    db.query.pathwayStages.findMany({ orderBy: asc(schema.pathwayStages.order) }),
    db.query.libraryTasks.findMany(),
    db.query.pathwayProgress.findMany({ where: eq(schema.pathwayProgress.userId, userId) }),
  ]);
  const path = simplePath(stages, library, progress);
  const t = path.now[0];
  if (!t) return null;
  const status = progress.find((p) => p.libraryTaskKey === t.key)?.status ?? "todo";
  return { key: t.key, name: t.name, points: t.points, stageKey: t.stageKey, status };
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
  const workspaceId = v.workspace.id;
  const tomorrow = addDays(today, 1);

  const [log, streak, points, focusTasks, dueTasks, overdueTasks, contentDue, contentOverdue, followUps, inbound, revisions, pathwayNext, curriculumDay, goal, everLockedIn] =
    await Promise.all([
      logFor(workspaceId, userId, today),
      streakFor(workspaceId, userId, today),
      totalPoints(workspaceId, userId),
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
      db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), isNotNull(schema.dailyLogs.morningDoneAt)) }),
    ]);

  const [allClosed, used, activity] = await Promise.all([closedDates(workspaceId, userId), repairsUsed(workspaceId, userId, today.slice(0, 7)), todayActivity(workspaceId, userId, today)]);
  const broken = log?.eveningDoneAt ? null : brokenStreak(allClosed, today);
  const repairsLeft = Math.max(0, 1 - used);
  const clientRecords = await db.query.clientRecords.findMany({ where: and(eq(schema.clientRecords.userId, userId), eq(schema.clientRecords.status, "active")) });
  const clientsDueCheckin = clientRecords.filter((c) => {
    const base = c.lastCheckinAt ?? c.startDate;
    return !base || addDays(base, c.checkinCadenceDays) <= today;
  }).length;
  const building = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.userId, userId), inArray(schema.webinars.status, ["draft", "building"]), eq(schema.webinars.isExample, false)), orderBy: desc(schema.webinars.createdAt) });
  let webinarInProgress: Snapshot["webinarInProgress"] = null;
  if (building) {
    const [secs, bels] = await Promise.all([
      db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, building.id) }),
      db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, building.id) }),
    ]);
    const p = webinarProgress(building, secs, bels, null);
    const step = nextStep(p.steps);
    webinarInProgress = { id: building.id, title: building.title, step, stepLabel: STEPS.find((s) => s.key === step)?.label ?? step };
  }

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
    clientsDueCheckin,
    webinarInProgress,
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
    /** Never locked in: Today shows the welcome card instead of the next-action block. */
    firstSession: !everLockedIn,
    /** When the running streak is 0 and something was lost: what, when, and whether one grace day mends it. */
    broken,
    repairsLeft,
    /** What the app already saw today, to pre-fill the close. */
    activity,
    actions,
    snapshot,
  };
}
