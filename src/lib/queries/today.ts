import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { taskOrigins } from "@/lib/queries/tasks";
import { syncFieldTasks } from "@/lib/queries/pathway";
import type { Viewer } from "@/lib/auth";
import { addDays } from "@/lib/dates";
import { nextBestActions, type Action, type Snapshot } from "@/lib/engine/nba";
import { tierProgress } from "@/lib/engine/tiers";
import { roadLine, simplePath } from "@/lib/engine/pathway";
import { closeTargetFor, logFor, paidStreakDays, repairsUsed, streakFor, todayActivity } from "./daily";
import { ensurePrimaryGoal } from "./plan";
import { closeKpisOf, primaryGoalBar } from "./kpi";
import { nowFor, outcomesFor, type ChannelOutcome } from "@/lib/engine/channel-outcome";
import { bonusFor, brokenStreak, type DayBonus } from "@/lib/engine/streak";
import { settleStreak } from "@/lib/streak";
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
  // The one goal is the Primary business goal with its KPI (BG1, BG2): made on first read, never while a coach is switched in.
  if (!v.switchedInto) await ensurePrimaryGoal({ workspaceId, userId }, today);
  const who = { today, hour, tz: v.tz, days: v.membership.workDays };
  // The streak's settle (H-289 §3): an active day whose bonus never landed (never closed) is paid when Today next loads. The
  // member's own: never while a coach is switched in or a team member is here.
  if (!v.switchedInto && !v.team) await settleStreak(workspaceId, userId, who);

  const [log, streak, points, focusTasks, dueTasks, overdueTasks, contentDue, contentOverdue, followUps, inbound, revisions, pathwayNext, curriculumDay, goal, everLockedIn, lastEnergyLog] =
    await Promise.all([
      logFor(workspaceId, userId, today),
      streakFor(workspaceId, userId, who),
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
      // The last energy before today (H-164 §2): the lock-in's default, so one tap locks the day in.
      db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId), lt(schema.dailyLogs.date, today), isNotNull(schema.dailyLogs.energy)), orderBy: desc(schema.dailyLogs.date) }),
    ]);

  // The close card's day (rev 731): yesterday before 04:00 while it is open, or the last close-out again within 6 hours with
  // no lock-in since; otherwise today. Its log, activity and KPI boxes are that day's. Independent reads run together (H-164 §9).
  const [used, activity, closeFor, paidStreak, clientRecords, building, live, brandKit, upcomingTasks, openTasks] = await Promise.all([
    repairsUsed(workspaceId, userId, today.slice(0, 7)),
    todayActivity(workspaceId, userId, today),
    closeTargetFor(workspaceId, userId, today, hour),
    paidStreakDays(workspaceId, userId),
    db.query.clientRecords.findMany({ where: and(eq(schema.clientRecords.userId, userId), eq(schema.clientRecords.status, "active")) }),
    db.query.webinars.findFirst({ where: and(eq(schema.webinars.userId, userId), inArray(schema.webinars.status, ["draft", "building"]), eq(schema.webinars.isExample, false)), orderBy: desc(schema.webinars.createdAt) }),
    db.query.webinars.findFirst({ where: and(eq(schema.webinars.userId, userId), inArray(schema.webinars.status, ["ready", "scheduled"]), eq(schema.webinars.isExample, false)), orderBy: desc(schema.webinars.createdAt) }),
    db.query.brandKits.findFirst({ where: and(eq(schema.brandKits.workspaceId, workspaceId), eq(schema.brandKits.userId, userId)) }),
    db.query.tasks.findMany({
      where: and(eq(schema.tasks.userId, userId), inPlay, ne(schema.tasks.status, "done"), sql`${schema.tasks.dueDate} between ${tomorrow} and ${addDays(today, 7)}`),
      orderBy: asc(schema.tasks.dueDate),
      limit: 6,
    }),
    db.query.tasks.findMany({
      where: and(eq(schema.tasks.userId, userId), inPlay, ne(schema.tasks.status, "done")),
      orderBy: [asc(schema.tasks.dueDate), asc(schema.tasks.createdAt)],
      limit: 40,
    }),
  ]);
  // The break notice (H-289): read as of the streak's day, over the member's active days and their own work days.
  const broken = log?.eveningDoneAt ? null : brokenStreak(streak.activity.active, streak.asOf, streak.days);
  // What the close card's day pays as its streak bonus if closed now (the weekday ladder or the weekend's +40).
  // Already paid for that day (the welcome's open, H-312): the close adds no streak bonus, so the card promises none.
  const closeBonus: DayBonus = paidStreak.has(closeFor.date) ? { points: 0, reason: "", streakDay: 0 } : bonusFor(streak.activity.ladder, closeFor.date, streak.days);
  const [closeLog, closeActivity] = await Promise.all([closeFor.date === today ? log : logFor(workspaceId, userId, closeFor.date), closeFor.date === today ? activity : todayActivity(workspaceId, userId, closeFor.date)]);
  const repairsLeft = Math.max(0, 1 - used);
  const clientsDueCheckin = clientRecords.filter((c) => {
    const base = c.lastCheckinAt ?? c.startDate;
    return !base || addDays(base, c.checkinCadenceDays) <= today;
  }).length;
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
    eveningDone: Boolean(closeLog?.eveningDoneAt),
    lateClose: closeFor.late ? closeFor.date : null,
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
  const brandKitStarter = !brandKit;
  // The last reads, independent of one another, together (H-164 §9: they ran one after another).
  const [origins, road, stillOpen, failedPosts, goalBarRead, closeKpis] = await Promise.all([
    taskOrigins([...focusTasks, ...dueTasks, ...overdueTasks, ...upcomingTasks]),
    pathwayRoad(userId),
    stillOpenFocus(v),
    failedPostsFor(v, userId, today),
    goalBar(workspaceId, userId, today, goal),
    v.switchedInto ? Promise.resolve([]) : closeKpisOf({ workspaceId, userId }, closeFor.date),
  ]);

  return {
    brandKitStarter,
    /** The last energy before today, the lock-in's default (H-164 §2); null for a first day. */
    lastEnergy: lastEnergyLog?.energy ?? null,
    log: log ?? null,
    streak: streak.running,
    /** The weekday ladder the streak engine counts from, for the evening close's line about tomorrow (H-327). */
    streakLadder: streak.activity.ladder,
    points,
    tier: tierProgress(points),
    focusTasks,
    dueTasks,
    overdueTasks,
    upcomingTasks,
    taskOrigins: origins,
    road,
    openTasks,
    /** The last lock-in day's unfinished Top 3, offered first and unticked in the picker. */
    stillOpen,
    contentDue: [...contentOverdue, ...contentDue],
    /** Posts with a channel that did not send in the last two weeks (friction walk C1): the banner on Today, with its fix. */
    failedPosts,
    followUps,
    inbound,
    pathwayNext,
    curriculumDay,
    /** The Primary business goal and its first KPI (BG2): the bar reads the plan; before the mirror exists, the goals row itself. */
    goal: goalBarRead,
    /** The KPIs the close asks for (BG2), with today's value if one was typed. */
    closeKpis,
    /** The day the close card is for, and that day's log (rev 731); `late` titles it "Close yesterday". */
    close: { ...closeFor, log: closeLog ?? null, activity: closeActivity },
    /** Never locked in: Today shows the welcome card instead of the next-action block. */
    firstSession: !everLockedIn,
    /** When the running streak is 0 and something was lost: what, when, and whether one grace day mends it. */
    broken,
    closeBonus,
    repairsLeft,
    /** What the app already saw today, to pre-fill the close. */
    activity,
    actions,
    snapshot,
  };
}

/**
 * Today's goal bar (BG2): the Primary business goal's first KPI, read for the day (a "$" goal sums this month's closes, as
 * the friction walk's N1 had it; a goal in another unit reads the values typed for it). Without the mirror yet, the goals row.
 */
async function goalBar(workspaceId: string, userId: string, today: string, legacy: { title: string; actual: number; target: number; unit: string } | null | undefined) {
  const bar = await primaryGoalBar({ workspaceId, userId }, today);
  if (bar) return bar;
  return legacy ? { recordId: null, title: legacy.title, name: "", actual: legacy.actual, target: legacy.target, unit: legacy.unit, pace: "none" as const } : null;
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
