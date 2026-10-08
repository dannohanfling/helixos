import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { taskOrigins } from "@/lib/queries/tasks";
import { syncFieldTasks } from "@/lib/queries/pathway";
import type { Viewer } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { nextBestActions, type Action, type Snapshot } from "@/lib/engine/nba";
import { tierProgress } from "@/lib/engine/tiers";
import { roadLine, simplePath } from "@/lib/engine/pathway";
import { closedDates, logFor, logsBetween, repairsUsed, streakFor, todayActivity } from "./daily";
import { nowFor, outcomesFor, type ChannelOutcome } from "@/lib/engine/channel-outcome";
import { brokenStreak } from "@/lib/engine/streak";
import { STEPS, buildChecks, nextStep, statusStale } from "@/lib/engine/webinar";
import { contextFor, knownFor } from "@/lib/queries/webinar";
import { deckSlides } from "@/lib/engine/deck";
import { resolveDeckSlots } from "@/lib/queries/deck-slots";
import { shotList } from "@/lib/engine/shot-list";
import { totalPoints } from "./points";
import { settleOldFocus, stillOpenFocus } from "@/lib/tasks-core";

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

/** Where the client is on the Pathway and what's ahead, in one line for Today's header. */
export async function pathwayRoad(userId: string): Promise<string> {
  // the field-bound stage 1 tasks follow the fields, so members from before this shipped catch up on load
  const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.userId, userId) });
  if (m) await syncFieldTasks(m.workspaceId, userId);
  const [stages, library, progress] = await Promise.all([
    db.query.pathwayStages.findMany({ orderBy: asc(schema.pathwayStages.order) }),
    db.query.libraryTasks.findMany(),
    db.query.pathwayProgress.findMany({ where: eq(schema.pathwayProgress.userId, userId) }),
  ]);
  const path = simplePath(stages, library, progress);
  return roadLine(stages, path.stageKey, path.allDone);
}

export async function currentCurriculumDay(userId: string) {
  const done = await db.query.curriculumProgress.findMany({ where: eq(schema.curriculumProgress.userId, userId) });
  const doneDays = new Set(done.map((d) => d.day));
  const days = await db.query.curriculumDays.findMany({ orderBy: asc(schema.curriculumDays.day) });
  return days.find((d) => !doneDays.has(d.day)) ?? null;
}

/** Tasks in play: an imported task waiting for review, or one let go, stays off Today and out of the lock-in (30 Sep). */
const inPlay = isNull(schema.tasks.reviewState);

export async function todayData(v: Viewer) {
  const { user, today, hour } = v;
  const userId = user.id;
  const workspaceId = v.workspace.id;
  const tomorrow = addDays(today, 1);
  // Yesterday's unfinished Top 3 loses the star before anything is read, so the new morning starts clean.
  await settleOldFocus(v);

  const [log, streak, points, focusTasks, dueTasks, overdueTasks, contentDue, contentOverdue, followUps, inbound, revisions, pathwayNext, curriculumDay, goal, everLockedIn] =
    await Promise.all([
      logFor(workspaceId, userId, today),
      streakFor(workspaceId, userId, today),
      totalPoints(workspaceId, userId),
      db.query.tasks.findMany({
        where: and(eq(schema.tasks.userId, userId), inPlay, eq(schema.tasks.focusDate, today)),
        orderBy: [asc(schema.tasks.status), asc(schema.tasks.createdAt)],
      }),
      db.query.tasks.findMany({
        where: and(eq(schema.tasks.userId, userId), inPlay, ne(schema.tasks.status, "done"), eq(schema.tasks.dueDate, today)),
        orderBy: asc(schema.tasks.createdAt),
      }),
      db.query.tasks.findMany({
        where: and(eq(schema.tasks.userId, userId), inPlay, ne(schema.tasks.status, "done"), lt(schema.tasks.dueDate, today)),
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
  let shotListSnapshot: Snapshot["shotList"] = null;
  if (building) {
    const [secs, bels] = await Promise.all([
      db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, building.id) }),
      db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, building.id) }),
    ]);
    const p = buildChecks({ webinar: building, sections: secs, beliefs: bels, review: null });
    const step = nextStep(p.steps);
    webinarInProgress = { id: building.id, title: building.title, step, stepLabel: STEPS.find((s) => s.key === step)?.label ?? step };
    // "Pictures to gather" (§6.3), the same list Foundation shows, as a Today action until it is complete.
    const [context, kit] = await Promise.all([contextFor(building), db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, building.workspaceId), eq(schema.brandKits.userId, building.userId)) })]);
    const resolved = await resolveDeckSlots(building.id, deckSlides(context, kit ?? null), { workspaceId: building.workspaceId, userId: building.userId });
    const hasLogo = Boolean(kit?.logoImageId) || Boolean(await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.workspaceId, building.workspaceId), eq(schema.deckImages.userId, building.userId), eq(schema.deckImages.kind, "logo")) }));
    const list = shotList(resolved, hasLogo);
    if (resolved.length && !list.done) shotListSnapshot = { webinarId: building.id, title: building.title, gathered: list.gathered, total: list.total };
  }
  // A webinar already marked ready or scheduled whose checks have since broken: the status does not fall back on its own, so Today says so.
  let webinarBroken: Snapshot["webinarBroken"] = null;
  const live = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.userId, userId), inArray(schema.webinars.status, ["ready", "scheduled"]), eq(schema.webinars.isExample, false)), orderBy: desc(schema.webinars.createdAt) });
  if (live) {
    const [secs, bels, comps, known] = await Promise.all([
      db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, live.id) }),
      db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, live.id) }),
      live.offerId ? db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, live.offerId) }) : Promise.resolve([]),
      knownFor(userId, workspaceId),
    ]);
    const stale = statusStale(live.status, buildChecks({ webinar: live, sections: secs, beliefs: bels, components: comps, known, review: null }));
    const daysAway = live.scheduledAt ? Math.round((new Date(`${live.scheduledAt.slice(0, 10)}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000) : null;
    if (stale.stale) webinarBroken = { id: live.id, title: live.title, status: live.status, note: stale.note, daysAway };
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
    shotList: shotListSnapshot,
    webinarBroken,
  };
  const actions: Action[] = nextBestActions(snapshot);
  // Set your brand kit (rev 568): a member with no kit of their own sees the nudge on Today until they save one.
  const brandKitStarter = !(await db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, workspaceId), eq(schema.brandKits.userId, userId)) }));

  const upcomingTasks = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, userId), inPlay, ne(schema.tasks.status, "done"), sql`${schema.tasks.dueDate} between ${tomorrow} and ${addDays(today, 7)}`),
    orderBy: asc(schema.tasks.dueDate),
    limit: 6,
  });
  const openTasks = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.userId, userId), inPlay, ne(schema.tasks.status, "done")),
    orderBy: [asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)],
    limit: 40,
  });

  return {
    brandKitStarter,
    log: log ?? null,
    streak: streak.running,
    points,
    tier: tierProgress(points),
    focusTasks,
    dueTasks,
    overdueTasks,
    upcomingTasks,
    taskOrigins: await taskOrigins([...focusTasks, ...dueTasks, ...overdueTasks, ...upcomingTasks]),
    road: await pathwayRoad(userId),
    openTasks,
    /** The last lock-in day's unfinished Top 3, offered first and unticked in the picker. */
    stillOpen: await stillOpenFocus(v),
    contentDue: [...contentOverdue, ...contentDue],
    /** Posts with a channel that did not send in the last two weeks (friction walk C1): the banner on Today, with its fix. */
    failedPosts: await failedPostsFor(v, userId, today),
    followUps,
    inbound,
    pathwayNext,
    curriculumDay,
    goal: goal ? { ...goal, actual: goal.unit === "$" && goal.period === "This month" ? await monthCash(workspaceId, userId, today) : goal.actual } : null,
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

/**
 * This month's cash collected, summed from the evening closes (friction walk N1, 7 Oct: Today's goal bar read a running total
 * that Settings or an older month could carry, while Numbers summed the month's logs; both now read the same sum).
 */
async function monthCash(workspaceId: string, userId: string, today: string): Promise<number> {
  const month = today.slice(0, 7);
  const logs = await logsBetween(workspaceId, userId, `${month}-01`, `${month}-31`);
  return logs.reduce((a, l) => a + (l.cashCollected ?? 0), 0);
}

/** The posts of the last fourteen days with a channel that did not send, newest first: the content and its outcomes. */
async function failedPostsFor(v: Viewer, userId: string, today: string): Promise<{ id: string; title: string; outcomes: ChannelOutcome[] }[]> {
  const since = addDays(today, -14);
  const rows = await db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.userId, userId), inArray(schema.contentVariants.externalStatus, ["failed", "deleted", "manual"]), sql`substr(${schema.contentVariants.createdAt}, 1, 10) >= ${since}`), orderBy: desc(schema.contentVariants.createdAt) });
  if (!rows.length) return [];
  const items = await db.query.contentItems.findMany({ where: inArray(schema.contentItems.id, [...new Set(rows.map((r) => r.contentItemId))]) });
  const now = nowFor(v);
  const out: { id: string; title: string; outcomes: ChannelOutcome[] }[] = [];
  for (const item of items) {
    const outcomes = outcomesFor(rows.filter((r) => r.contentItemId === item.id), now).filter((o) => o.state === "failed");
    if (outcomes.length) out.push({ id: item.id, title: item.title, outcomes });
  }
  return out;
}
