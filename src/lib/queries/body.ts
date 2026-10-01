/**
 * Body reads. Every read of a Body table in the app is here (a unit test holds that), and every read of someone else's Body data
 * goes through bodyAccess first: a coach sees a client's Body only while the client's share switch is on (rev 179, privacy).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { addDays, daysBetween, formatDate, rangeDays, startOfWeek, todayInTz } from "@/lib/dates";
import { belowPar, daysLeft, dueSoon, yieldFor } from "@/lib/engine/body-pantry";
import { fmtHabitValue, habitsWeek, kept, dueOn, streak, weekDots, type Dot } from "@/lib/engine/body-habits";
import { fmtHours, isRecoveryKey, sleepAverages, sleepWeek, type Night, type RecoveryKey } from "@/lib/engine/body-recovery";
import { weekday } from "@/lib/dates";
import { METRIC_DEFS, habitKey, isHabitKey, pairUp, verdict, type Fold, type Grain, type MetricDef, type Point } from "@/lib/engine/body-correlate";
import { shoppingList, type ShopFood } from "@/lib/engine/body-shopping";
import { calendarWeeks, perWeek, type Bounds } from "@/lib/engine/body-range";
import { change, coachBodyText, goalPace, nutritionWeek, weighWeek, type CoachBodyCell, type WeekDay } from "@/lib/engine/body-week";
import { METRICS, avg7, dayFigure, fmtMetric, isMetricKey, trendStats, withDerived, type MetricKey, type Reading } from "@/lib/engine/body-scale";
import { bestSet, fmtSet, heatLevel, historyOf, lastTime, nextSetDefaults, prFlags, routineForDay, sessionPlan, weekTally, type WeightUnit } from "@/lib/engine/body-training";
import { MACROS, bodyAccessFor, bodyAiAllowedFor, capUse, dayMarks, dayTypeIdFor, formatBodyForAi, hasBands, nextRefeed, portionMacros, sumMacros, summaryLine, whatFits, worstMark, type BodyAccess, type Bands, type Macro, type Macros } from "@/lib/engine/body";

/**
 * Body ships dark (rev 195): a member whose Body is off gets a 404 from every Body page and from the Body export, as if Body did
 * not exist. Every Body page calls this first (a unit test holds that).
 */
export function requireBodyEnabled(v: Viewer): void {
  if (!v.membership.bodyEnabled) notFound();
}

/**
 * The workspace owner: its earliest coach membership still active (HelixOS has no owner column; the coach who set the workspace up
 * comes first). Only they get the "Show Body (beta) for me" switch on Settings (rev 209, item 4).
 */
export async function workspaceOwnerId(workspaceId: string): Promise<string | null> {
  const first = await db.query.memberships.findFirst({
    columns: { id: true },
    where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "coach"), isNull(schema.memberships.removedAt)),
    orderBy: [asc(schema.memberships.createdAt), asc(schema.memberships.id)],
  });
  return first?.id ?? null;
}
export const isWorkspaceOwner = async (v: Viewer): Promise<boolean> => v.role === "coach" && (await workspaceOwnerId(v.workspace.id)) === v.membership.id;

export async function bodySettingsFor(workspaceId: string, userId: string): Promise<schema.BodySettings | null> {
  return (await db.query.bodySettings.findFirst({ where: and(eq(schema.bodySettings.workspaceId, workspaceId), eq(schema.bodySettings.userId, userId)) })) ?? null;
}

/**
 * May this viewer read this member's Body data, and as whom. The member is named by user id; their membership must be in the
 * viewer's workspace. Null means no: the caller shows nothing, not even whether there is anything.
 */
export async function bodyAccess(v: Viewer, memberUserId: string): Promise<BodyAccess> {
  if (memberUserId === v.user.id) return v.membership.bodyEnabled ? "self" : null;
  if (v.role !== "coach") return null;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, memberUserId)) });
  const s = m?.bodyEnabled ? await bodySettingsFor(v.workspace.id, memberUserId) : null;
  return bodyAccessFor({ viewerUserId: v.user.id, viewerRole: v.role, viewerWorkspaceId: v.workspace.id, memberUserId, memberWorkspaceId: m?.workspaceId ?? null, memberRemoved: !!m?.removedAt, memberEnabled: !!m?.bodyEnabled, shared: !!s?.shareWithCoach });
}

/**
 * A coach's view of a client's Body, by membership id. Null when there is no such client here or their Body is switched off (the
 * page is a 404, as if Body did not exist); "private" while they don't share; their user id, name and today while they do.
 */
export async function sharedClient(v: Viewer, membershipId: string): Promise<null | { shared: false } | { shared: true; userId: string; name: string; today: string }> {
  if (v.role !== "coach") return null;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, v.workspace.id)) });
  if (!m || !m.bodyEnabled) return null;
  if ((await bodyAccess(v, m.userId)) !== "coach") return { shared: false };
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  // The client's own day, in their timezone, so "today" on the coach's view is the client's today.
  return { shared: true, userId: m.userId, name: u?.name ?? "Client", today: todayInTz(m.timezone || v.workspace.timezone) };
}

/** A day type's bands: only the macros the member has entered both ends for. A blank day type has none. */
export function bandsOf(t: schema.BodyDayType): Bands {
  const pairs: Record<Macro, [number | null, number | null]> = { cal: [t.calMin, t.calMax], p: [t.pMin, t.pMax], f: [t.fMin, t.fMax], c: [t.cMin, t.cMax] };
  const out: Bands = {};
  for (const m of MACROS) {
    const [min, max] = pairs[m];
    if (min !== null && max !== null) out[m] = { min, max };
  }
  return out;
}

export async function dayTypesFor(workspaceId: string, userId: string) {
  return db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)), orderBy: [asc(schema.bodyDayTypes.order), asc(schema.bodyDayTypes.createdAt)] });
}

export type MealWithTotals = schema.BodyMeal & { totals: Macros; lines: { food: schema.BodyFood; qty: number }[]; missing: number };

/** The member's library: foods, and saved meals with their totals worked out from the foods as they are now. */
export async function bodyLibrary(workspaceId: string, userId: string, opts: { archived?: boolean } = {}) {
  const [foods, meals] = await Promise.all([
    db.query.bodyFoods.findMany({ where: and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId), opts.archived ? undefined : isNull(schema.bodyFoods.archivedAt)), orderBy: asc(schema.bodyFoods.name) }),
    db.query.bodyMeals.findMany({ where: and(eq(schema.bodyMeals.workspaceId, workspaceId), eq(schema.bodyMeals.userId, userId), opts.archived ? undefined : isNull(schema.bodyMeals.archivedAt)), orderBy: asc(schema.bodyMeals.name) }),
  ]);
  // An archived food still counts in a meal that uses it: archiving hides it from the picker, it doesn't break a meal.
  const allFoods = opts.archived ? foods : await db.query.bodyFoods.findMany({ where: and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)) });
  const byId = new Map(allFoods.map((f) => [f.id, f]));
  const withTotals: MealWithTotals[] = meals.map((m) => {
    const lines = m.items.flatMap((i) => (byId.has(i.foodId) ? [{ food: byId.get(i.foodId)!, qty: i.qty }] : []));
    return { ...m, lines, missing: m.items.length - lines.length, totals: sumMacros(lines.map((l) => portionMacros({ ...l.food, qty: l.qty }))) };
  });
  return { foods, meals: withTotals };
}

/** Everything one day's page needs: its day type and bands, what was eaten, the marks, what's left, what fits, caps, comments. */
export async function bodyDay(workspaceId: string, userId: string, date: string, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const [dayTypes, entries, override, comments, library, anyEntry, lately, shelf] = await Promise.all([
    dayTypesFor(workspaceId, userId),
    db.query.bodyEntries.findMany({ where: and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId), eq(schema.bodyEntries.date, date)), orderBy: asc(schema.bodyEntries.createdAt) }),
    db.query.bodyDays.findFirst({ where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), eq(schema.bodyDays.date, date)) }),
    db.query.bodyComments.findMany({ where: and(eq(schema.bodyComments.workspaceId, workspaceId), eq(schema.bodyComments.userId, userId), eq(schema.bodyComments.date, date)), orderBy: asc(schema.bodyComments.createdAt) }),
    bodyLibrary(workspaceId, userId),
    db.query.bodyEntries.findFirst({ columns: { id: true }, where: and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId)) }),
    db.query.bodyEntries.findMany({ columns: { items: true }, where: and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId), gte(schema.bodyEntries.date, addDays(today, -14))), orderBy: desc(schema.bodyEntries.createdAt), limit: 80 }),
    db.query.bodyPantry.findMany({ columns: { foodId: true, useBy: true }, where: and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId)) }),
  ]);
  // Pantry (phase 5): what to use within two days, named, and preferred in what fits.
  const soonItems = dueSoon(shelf, today, daysBetween);
  const useSoonFoods = [...new Set(soonItems.map((it) => it.foodId))].flatMap((id) => {
    const f = library.foods.find((x) => x.id === id);
    return f ? [{ foodId: id, name: f.name, days: Math.min(...soonItems.filter((it) => it.foodId === id).map((it) => it.days)) }] : [];
  });
  const prefer = new Set(useSoonFoods.map((x) => x.foodId));
  // Recent foods (rev 238): the ones logged in the last two weeks, newest first, go on top of the log picker.
  const live = new Set(library.foods.map((f) => f.id));
  const recentFoodIds = [...new Set(lately.flatMap((e) => e.items.map((i) => i.foodId)).filter((id): id is string => !!id && live.has(id)))].slice(0, 8);
  const refeed = { dayTypeId: settings.refeedDayTypeId, anchor: settings.refeedAnchor, everyDays: settings.refeedEveryDays };
  const typeId = dayTypeIdFor(date, settings.weekPattern, refeed, override?.dayTypeId ?? null);
  const dayType = dayTypes.find((t) => t.id === typeId) ?? null;
  const totals = sumMacros(entries.map((e) => ({ cal: e.cal, p: e.p, f: e.f, c: e.c })));
  const floors = { cal: settings.calFloor, f: settings.fatFloor };
  const final = date < today;
  // No bands yet (a blank start): totals only, no marks, nothing left to show and nothing to fit.
  const typeBands = dayType ? bandsOf(dayType) : null;
  const bands = hasBands(typeBands) ? typeBands : null;
  const marks = bands ? dayMarks(totals, bands, { floors, overOk: settings.overOk, final }) : null;
  const left = bands ? Object.fromEntries(MACROS.flatMap((m) => (bands[m] ? [[m, { min: bands[m]!.min - totals[m], max: bands[m]!.max - totals[m] }]] : []))) as Partial<Record<Macro, { min: number; max: number }>> : null;
  const fits = bands ? whatFits(totals, bands, library.meals.filter((m) => !m.missing).map((m) => ({ ...m, foodIds: m.lines.map((l) => l.food.id) })), { floors, overOk: settings.overOk, prefer }) : [];
  // The fill-in checklist (rev 192): shown at the top of /body until targets, a food and a first logged meal exist.
  const checklist = { ai: !!settings.aiAskedAt, targets: dayTypes.some((t) => hasBands(bandsOf(t))), dayTypes: dayTypes.length > 1, foods: library.foods.length > 0, meals: library.meals.length > 0, logged: !!anyEntry };
  const sodium = entries.reduce((a, e) => a + e.items.reduce((b, i) => b + (i.sodium ?? 0) * i.qty, 0), 0);
  // A weekly cap (rev 231) counts the whole week's lines and names the day it opens again.
  const weekStart = startOfWeek(date);
  const weekEntries = settings.caps.some((c) => c.per === "week")
    ? await db.query.bodyEntries.findMany({ columns: { items: true }, where: and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId), gte(schema.bodyEntries.date, weekStart), lte(schema.bodyEntries.date, addDays(weekStart, 6))) })
    : [];
  const caps = capUse(settings.caps, entries.flatMap((e) => e.items.map((i) => ({ capTag: i.capTag, qty: i.qty }))), { lines: weekEntries.flatMap((e) => e.items.map((i) => ({ capTag: i.capTag, qty: i.qty }))), nextWeekStart: addDays(weekStart, 7) });
  const authors = comments.length ? await db.query.users.findMany({ columns: { id: true, name: true }, where: inArray(schema.users.id, [...new Set(comments.map((c) => c.authorUserId))]) }) : [];
  const authorName = new Map(authors.map((a) => [a.id, a.name]));
  return {
    settings,
    flag: override?.flag ?? null,
    dayTypes,
    dayType,
    overridden: !!override?.dayTypeId,
    entries,
    totals,
    bands,
    marks,
    worst: marks ? worstMark(marks) : null,
    left,
    fits,
    caps,
    sodium,
    final,
    nextRefeed: nextRefeed(today, refeed),
    comments: comments.map((c) => ({ ...c, author: authorName.get(c.authorUserId) ?? "Coach" })),
    library,
    recentFoodIds,
    checklist,
    dueSoon: useSoonFoods,
  };
}
export type BodyDayView = NonNullable<Awaited<ReturnType<typeof bodyDay>>>;

/**
 * Body on Today: the one-tap "Log a meal" shortcut (rev 238) once Body is set up, and the line "Lift day · 780 of 1,400–1,500 cal ·
 * 110 of 180–200 P" beside it once today's day type has targets (rev 192). Null while Body is off or not set up.
 */
export async function todayBody(v: Viewer) {
  if (!v.membership.bodyEnabled) return null;
  const [d, hd] = await Promise.all([bodyDay(v.workspace.id, v.user.id, v.today, v.today), habitsDay(v.workspace.id, v.user.id, v.today, v.today)]);
  if (!d) return null;
  // The one-tap chips (B7, placed by rev 201): only the habits due today, done-type ones toggle in place, measured ones open Practices.
  const habits = hd.habits.filter((h) => h.due).slice(0, 8).map((h) => ({ id: h.id, name: h.name, kind: h.kind, kept: h.kept, valueText: h.valueText, streak: h.streak }));
  return { dayType: d.dayType?.name ?? null, line: d.bands ? summaryLine(d.totals, d.bands, d.marks) : null, reminder: d.bands ? (d.dayType?.reminder ?? null) : null, habits, flag: d.flag };
}

/* ───────── B2, workouts (rev 182) ───────── */

/** The member's exercises and routines (archived left out unless asked), with each routine's lines resolved to exercises. */
export async function trainingLibrary(workspaceId: string, userId: string) {
  const [all, routines] = await Promise.all([
    db.query.bodyExercises.findMany({ where: and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId)), orderBy: asc(schema.bodyExercises.name) }),
    db.query.bodyRoutines.findMany({ where: and(eq(schema.bodyRoutines.workspaceId, workspaceId), eq(schema.bodyRoutines.userId, userId), isNull(schema.bodyRoutines.archivedAt)), orderBy: asc(schema.bodyRoutines.name) }),
  ]);
  const byId = new Map(all.map((e) => [e.id, e]));
  return {
    exercises: all.filter((e) => !e.archivedAt),
    byId,
    // A routine keeps an archived exercise it already had: archiving hides it from pickers, it doesn't break a routine.
    routines: routines.map((r) => ({ ...r, lines: r.items.flatMap((i) => (byId.has(i.exerciseId) ? [{ ...i, exercise: byId.get(i.exerciseId)! }] : [])) })),
  };
}
export type TrainingLibrary = Awaited<ReturnType<typeof trainingLibrary>>;

/** Sets in the order they were logged: created_at has whole seconds, so two quick sets tie and SQLite's rowid breaks it. */
const setOrder = [asc(schema.bodySets.createdAt), asc(sql`rowid`)];

/** Every set of these exercises, oldest first: what last time, the PR and the history read from. */
async function setsOf(workspaceId: string, userId: string, exerciseIds: string[]) {
  if (!exerciseIds.length) return [];
  return db.query.bodySets.findMany({
    where: and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId), inArray(schema.bodySets.exerciseId, exerciseIds)),
    orderBy: [asc(schema.bodySets.date), ...setOrder],
  });
}

/**
 * One day of Training: its day type and reminder, whether it's marked Off, the session if started, and for each exercise in view
 * (the routine's, in order, then any other logged that day) its target, today's sets with PR flags, last time, the PR and what
 * the next set's form opens with. Null while Body isn't set up.
 */
export async function trainingDay(workspaceId: string, userId: string, date: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const unit: WeightUnit = settings.weightUnit;
  const [types, day, session, lib] = await Promise.all([
    dayTypesFor(workspaceId, userId),
    db.query.bodyDays.findFirst({ where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), eq(schema.bodyDays.date, date)) }),
    db.query.bodySessions.findFirst({ where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), eq(schema.bodySessions.date, date)) }),
    trainingLibrary(workspaceId, userId),
  ]);
  const refeed = { dayTypeId: settings.refeedDayTypeId, anchor: settings.refeedAnchor, everyDays: settings.refeedEveryDays };
  const typeId = dayTypeIdFor(date, settings.weekPattern, refeed, day?.dayTypeId ?? null);
  const dayType = types.find((t) => t.id === typeId) ?? null;
  const routine = session?.routineId ? (lib.routines.find((r) => r.id === session.routineId) ?? null) : null;
  const daySets = session
    ? await db.query.bodySets.findMany({ where: and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId), eq(schema.bodySets.sessionId, session.id)), orderBy: setOrder })
    : [];
  const ids = [...new Set([...(routine?.lines.map((l) => l.exerciseId) ?? []), ...daySets.map((s) => s.exerciseId)])].filter((id) => lib.byId.has(id));
  const history = await setsOf(workspaceId, userId, ids);
  // Phase 3: the routine's lines against what's logged, and whether the session was finished.
  const plan = sessionPlan(routine?.lines ?? [], daySets);
  const exercises = ids.map((id) => {
    const exercise = lib.byId.get(id)!;
    const all = history.filter((s) => s.exerciseId === id);
    const flags = prFlags(all, unit);
    const today = all.map((s, i) => ({ ...s, pr: flags[i] })).filter((s) => s.date === date);
    const before = all.filter((s) => s.date < date);
    const last = lastTime(before, date);
    // The PR as of this day, the day's own sets included (rev 293): a PR set today is today's PR, not last month's.
    const pr = bestSet(all.filter((s) => s.date <= date), unit);
    return {
      exercise,
      target: routine?.lines.find((l) => l.exerciseId === id) ?? null,
      today,
      last: last.map((s) => fmtSet(s, unit, exercise.kind)),
      lastDate: last[0]?.date ?? null,
      pr: pr ? { text: fmtSet(pr, unit, exercise.kind), date: pr.date } : null,
      next: nextSetDefaults(today, last, unit),
    };
  });
  return {
    settings,
    unit,
    dayType,
    reminder: dayType?.reminder ?? null,
    off: !!day?.off,
    session,
    routineName: session?.routineName ?? null,
    completedAt: session?.completedAt ?? null,
    note: session?.note ?? null,
    plan,
    exercises,
    library: lib,
    suggested: routineForDay(lib.routines, typeId),
  };
}
export type TrainingDayView = NonNullable<Awaited<ReturnType<typeof trainingDay>>>;

/**
 * Consistency (phase 3): the last 12 weeks as a heatmap (a day's heat from its sets; Off and finished sessions named in the
 * title), and this week's tally: days with a set logged, of the days whose day type has a routine tied to it.
 */
export async function trainingWeeks(workspaceId: string, userId: string, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const weekStart = startOfWeek(today);
  const from = addDays(weekStart, -7 * 11);
  const [sets, days, sessions, lib] = await Promise.all([
    db.query.bodySets.findMany({ columns: { date: true }, where: and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId), gte(schema.bodySets.date, from)) }),
    db.query.bodyDays.findMany({ columns: { date: true, off: true, dayTypeId: true }, where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), gte(schema.bodyDays.date, from)) }),
    db.query.bodySessions.findMany({ columns: { date: true, routineName: true, completedAt: true }, where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), gte(schema.bodySessions.date, from)) }),
    trainingLibrary(workspaceId, userId),
  ]);
  const setsOn = new Map<string, number>();
  for (const s of sets) setsOn.set(s.date, (setsOn.get(s.date) ?? 0) + 1);
  const dayRow = new Map(days.map((d) => [d.date, d]));
  const sessionOn = new Map(sessions.map((s) => [s.date, s]));
  const refeed = { dayTypeId: settings.refeedDayTypeId, anchor: settings.refeedAnchor, everyDays: settings.refeedEveryDays };
  const offered = (date: string) => !!routineForDay(lib.routines, dayTypeIdFor(date, settings.weekPattern, refeed, dayRow.get(date)?.dayTypeId ?? null));
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(from, i * 7)).map((monday) => ({
    monday,
    days: rangeDays(monday, addDays(monday, 6)).map((date) => {
      const n = setsOn.get(date) ?? 0;
      const sess = sessionOn.get(date);
      const what = dayRow.get(date)?.off ? "Off" : n ? `${n} set${n === 1 ? "" : "s"}${sess?.routineName ? ` · ${sess.routineName}` : ""}${sess?.completedAt ? " ✓" : ""}` : date > today ? "" : "nothing logged";
      return { date, level: heatLevel(n), title: `${formatDate(date, { weekday: "short", month: "short", day: "numeric" })}${what ? `: ${what}` : ""}` };
    }),
  }));
  const thisWeek = rangeDays(weekStart, addDays(weekStart, 6));
  return { weeks, weekStart, tally: weekTally(thisWeek, (d) => (setsOn.get(d) ?? 0) > 0, offered) };
}

/** One exercise's history: a point per session (oldest first), each session's sets, and the PR. Null if it isn't the member's. */
export async function exerciseHistory(workspaceId: string, userId: string, exerciseId: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const exercise = await db.query.bodyExercises.findFirst({ where: and(eq(schema.bodyExercises.id, exerciseId), eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId)) });
  if (!exercise) return null;
  const unit: WeightUnit = settings.weightUnit;
  const sets = await setsOf(workspaceId, userId, [exercise.id]);
  const flags = prFlags(sets, unit);
  const pr = bestSet(sets, unit);
  const dates = [...new Set(sets.map((s) => s.date))].sort().reverse();
  return {
    exercise,
    unit,
    points: historyOf(sets, unit),
    pr: pr ? { text: fmtSet(pr, unit, exercise.kind), date: pr.date } : null,
    sessions: dates.map((date) => ({ date, sets: sets.flatMap((s, i) => (s.date === date ? [{ text: fmtSet(s, unit, exercise.kind), pr: flags[i] }] : [])) })),
  };
}

/** The last week's sessions in words, for AI: "2026-09-29 Push A: Bench press 185 × 5, 185 × 5; Dips 12 reps". Newest first. */
export async function recentTraining(workspaceId: string, userId: string, today: string, days = 7) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return [];
  const from = addDays(today, -(days - 1));
  const [sessions, sets, lib, offDays] = await Promise.all([
    db.query.bodySessions.findMany({ where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), gte(schema.bodySessions.date, from)), orderBy: desc(schema.bodySessions.date) }),
    db.query.bodySets.findMany({ where: and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId), gte(schema.bodySets.date, from)), orderBy: setOrder }),
    trainingLibrary(workspaceId, userId),
    db.query.bodyDays.findMany({ columns: { date: true }, where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), eq(schema.bodyDays.off, true), gte(schema.bodyDays.date, from)) }),
  ]);
  const out = sessions.map((sess) => {
    const mine = sets.filter((s) => s.sessionId === sess.id);
    // The routine's order first, then anything else in the order it was done.
    const order = lib.routines.find((r) => r.id === sess.routineId)?.items.map((i) => i.exerciseId) ?? [];
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    const ids = [...new Set(mine.map((s) => s.exerciseId))].sort((a, b) => rank(a) - rank(b));
    const lines = ids.map((id) => {
      const ex = lib.byId.get(id);
      return `${ex?.name ?? "Exercise"} ${mine.filter((s) => s.exerciseId === id).map((s) => fmtSet(s, settings.weightUnit, ex?.kind ?? "weight")).join(", ")}`;
    });
    return { date: sess.date, routine: sess.routineName, lines, off: false };
  });
  for (const d of offDays) if (!out.some((o) => o.date === d.date)) out.push({ date: d.date, routine: null, lines: [], off: true });
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* ───────── Pantry (rev 237 phase 5) ───────── */

/**
 * The Pantry page: every item with its food and days to use-by, soonest first; what to use soon; what's below par (the shopping
 * list's seed); and each live food's cooked yield, entered or learned from its weighings.
 */
export async function pantryView(workspaceId: string, userId: string, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const [items, foods, weighings] = await Promise.all([
    db.query.bodyPantry.findMany({ where: and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId)) }),
    db.query.bodyFoods.findMany({ where: and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)), orderBy: asc(schema.bodyFoods.name) }),
    db.query.bodyYields.findMany({ where: and(eq(schema.bodyYields.workspaceId, workspaceId), eq(schema.bodyYields.userId, userId)), orderBy: desc(schema.bodyYields.createdAt) }),
  ]);
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const live = foods.filter((f) => !f.archivedAt);
  const rows = items
    .map((it) => ({ ...it, food: foodById.get(it.foodId) ?? null, days: daysLeft(it, today, daysBetween) }))
    .sort((a, b) => (a.useBy ?? "9999").localeCompare(b.useBy ?? "9999") || (a.food?.name ?? "").localeCompare(b.food?.name ?? ""));
  const soon = dueSoon(rows, today, daysBetween);
  const yields = live.map((f) => {
    const own = weighings.filter((w) => w.foodId === f.id);
    return { food: f, ...yieldFor(f, own), weighings: own.slice(0, 10) };
  });
  return { settings, items: rows, soon, gaps: belowPar(live, items), foods: live, yields, count: items.length };
}
export type PantryView = NonNullable<Awaited<ReturnType<typeof pantryView>>>;

/* ───────── Body composition (rev 237 phase 2) ───────── */

export type StoredReading = Reading & { readingId: string; source: schema.BodySource; createdAt: string };

/** Rows → readings, oldest first (date, then time, then when logged), a reading's numbers together under its readingId. */
export function groupReadings(rows: schema.BodyDailyRow[]): StoredReading[] {
  const byId = new Map<string, StoredReading>();
  for (const row of rows) {
    if (!isMetricKey(row.key)) continue;
    let x = byId.get(row.readingId);
    if (!x) byId.set(row.readingId, (x = { readingId: row.readingId, date: row.date, time: row.time, source: row.source, createdAt: row.createdAt, values: {} }));
    x.values[row.key] = row.value;
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.createdAt.localeCompare(b.createdAt));
}

/** Every reading of the member's, oldest first; from a date on when asked. */
export async function scaleReadings(workspaceId: string, userId: string, from?: string): Promise<StoredReading[]> {
  const rows = await db.query.bodyDaily.findMany({ where: and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId), from ? gte(schema.bodyDaily.date, from) : undefined) });
  return groupReadings(rows);
}

/** One figure per date, oldest first: the day's lowest-weight reading, whole, with fat-free mass derived when it lacked one. */
export function dayFigures(readings: StoredReading[]): StoredReading[] {
  const dates = [...new Set(readings.map((x) => x.date))].sort();
  return dates.map((d) => {
    const f = dayFigure(readings.filter((x) => x.date === d))!;
    return { ...f, values: withDerived(f.values) };
  });
}

/** One day's figure, for the Log page and the coach's day view. Null with no reading that day. */
export async function dayComposition(workspaceId: string, userId: string, date: string): Promise<StoredReading | null> {
  const rows = await db.query.bodyDaily.findMany({ where: and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId), eq(schema.bodyDaily.date, date)) });
  const f = dayFigure(groupReadings(rows));
  return f ? { ...f, values: withDerived(f.values) } : null;
}

/** The latest day's figure, whenever it was. */
export async function latestComposition(workspaceId: string, userId: string): Promise<StoredReading | null> {
  const last = await db.query.bodyDaily.findFirst({ columns: { date: true }, where: and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), orderBy: desc(schema.bodyDaily.date) });
  return last ? dayComposition(workspaceId, userId, last.date) : null;
}

/**
 * The Weigh-ins page: the latest figure, the last readings, and a trend card per primary metric over the range in view, each with
 * its day figures, the 7-day average alongside, the card's numbers and the goal. Null while Body isn't set up.
 */
export async function weighIns(workspaceId: string, userId: string, today: string, rangeDays: number | null) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const [all, goals] = await Promise.all([scaleReadings(workspaceId, userId), db.query.bodyGoals.findMany({ where: and(eq(schema.bodyGoals.workspaceId, workspaceId), eq(schema.bodyGoals.userId, userId)) })]);
  const figures = dayFigures(all).filter((f) => f.date <= today);
  const from = rangeDays ? addDays(today, -(rangeDays - 1)) : null;
  const inView = from ? figures.filter((f) => f.date >= from) : figures;
  const goalOf = new Map(goals.map((g) => [g.key, g]));
  const cards = METRICS.filter((m) => m.primary).map((metric) => {
    const points = inView.flatMap((f) => (f.values[metric.key] != null ? [{ date: f.date, value: f.values[metric.key]! }] : []));
    return { metric, points, average: points.map((p) => avg7(points, p.date, addDays)), stats: trendStats(points, today, addDays), goal: goalOf.get(metric.key) ?? null };
  });
  return { unit: settings.weightUnit, latest: figures[figures.length - 1] ?? null, todayFigure: figures.find((f) => f.date === today) ?? null, readings: all.slice(-40).reverse(), cards, goals, count: all.length, firstDate: all[0]?.date ?? null, from };
}
export type WeighInsView = NonNullable<Awaited<ReturnType<typeof weighIns>>>;

/** For AI: the latest figure and the 7-day average of weight, in words. Null with no readings. */
async function weighInsForAi(workspaceId: string, userId: string, today: string, unit: "lb" | "kg"): Promise<{ date: string; text: string; avg7: string | null } | null> {
  const all = await scaleReadings(workspaceId, userId, addDays(today, -13));
  const figures = dayFigures(all);
  const latest = figures[figures.length - 1];
  if (!latest) {
    const any = await latestComposition(workspaceId, userId);
    return any ? { date: any.date, text: figureText(any.values, unit), avg7: null } : null;
  }
  const weights = figures.flatMap((f) => (f.values.weight != null ? [{ date: f.date, value: f.values.weight }] : []));
  const a = avg7(weights, today, addDays);
  return { date: latest.date, text: figureText(latest.values, unit), avg7: a != null ? fmtMetric("weight", a, unit) : null };
}
const figureText = (values: Partial<Record<MetricKey, number>>, unit: "lb" | "kg") =>
  (["weight", "bf", "ffm", "smm_pct", "visceral", "water", "bmr", "met_age"] as MetricKey[]).flatMap((k) => (values[k] != null ? [`${fmtMetric(k, values[k]!, unit)} ${METRICS.find((m) => m.key === k)!.label.toLowerCase()}`] : [])).join(", ");

/** The last days with anything logged, newest first, for the recent strip: date, totals and the worst mark. */
export async function recentDays(workspaceId: string, userId: string, today: string, days = 7) {
  return daysInRange(workspaceId, userId, addDays(today, -(days - 1)), today, today);
}

/** Every day from `from` to `to`, newest first: its day type, bands, what was logged, the totals and the worst mark. */
export async function daysInRange(workspaceId: string, userId: string, from: string, to: string, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings || to < from) return [];
  const [entries, types, overrides] = await Promise.all([
    db.query.bodyEntries.findMany({ where: and(eq(schema.bodyEntries.workspaceId, workspaceId), eq(schema.bodyEntries.userId, userId), gte(schema.bodyEntries.date, from), lte(schema.bodyEntries.date, to)), orderBy: desc(schema.bodyEntries.date) }),
    dayTypesFor(workspaceId, userId),
    db.query.bodyDays.findMany({ where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), gte(schema.bodyDays.date, from), lte(schema.bodyDays.date, to)) }),
  ]);
  const refeed = { dayTypeId: settings.refeedDayTypeId, anchor: settings.refeedAnchor, everyDays: settings.refeedEveryDays };
  const out = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const list = entries.filter((e) => e.date === d);
    const typeId = dayTypeIdFor(d, settings.weekPattern, refeed, overrides.find((o) => o.date === d)?.dayTypeId ?? null);
    const t = types.find((x) => x.id === typeId) ?? null;
    const totals = sumMacros(list.map((e) => ({ cal: e.cal, p: e.p, f: e.f, c: e.c })));
    const typeBands = t ? bandsOf(t) : null;
    const bands = hasBands(typeBands) ? typeBands : null;
    const final = d < today;
    const marks = bands && list.length ? dayMarks(totals, bands, { floors: { cal: settings.calFloor, f: settings.fatFloor }, overOk: settings.overOk, final }) : null;
    out.push({ date: d, dayType: t?.name ?? null, logged: list.length, totals, bands, final, worst: marks ? worstMark(marks) : null, flag: overrides.find((o) => o.date === d)?.flag ?? null });
  }
  return out;
}

/* ───────── The weekly rollup (rev 237 phase 6) ───────── */

/** One week's training, for the rollup: days with a set logged, of the days a routine was offered; the sets; the PRs. */
async function trainingWeek(workspaceId: string, userId: string, monday: string, settings: schema.BodySettings) {
  const sunday = addDays(monday, 6);
  const [sets, days, lib] = await Promise.all([
    db.query.bodySets.findMany({ columns: { id: true, date: true, exerciseId: true }, where: and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId), gte(schema.bodySets.date, monday), lte(schema.bodySets.date, sunday)) }),
    db.query.bodyDays.findMany({ columns: { date: true, dayTypeId: true }, where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), gte(schema.bodyDays.date, monday), lte(schema.bodyDays.date, sunday)) }),
    trainingLibrary(workspaceId, userId),
  ]);
  const refeed = { dayTypeId: settings.refeedDayTypeId, anchor: settings.refeedAnchor, everyDays: settings.refeedEveryDays };
  const dayRow = new Map(days.map((d) => [d.date, d]));
  const tally = weekTally(rangeDays(monday, sunday), (d) => sets.some((s) => s.date === d), (d) => !!routineForDay(lib.routines, dayTypeIdFor(d, settings.weekPattern, refeed, dayRow.get(d)?.dayTypeId ?? null)));
  // A PR is judged against everything before it, so the week's exercises need their whole history.
  const ids = [...new Set(sets.map((s) => s.exerciseId))];
  const history = await setsOf(workspaceId, userId, ids);
  let prs = 0;
  for (const id of ids) {
    const own = history.filter((s) => s.exerciseId === id);
    const flags = prFlags(own, settings.weightUnit);
    prs += own.filter((s, i) => flags[i] && s.date >= monday && s.date <= sunday).length;
  }
  return { sessions: tally.done, planned: tally.planned, sets: sets.length, prs };
}

/**
 * The week of `monday` (Mon–Sun) beside the week before: nutrition averages and days in band, the training tally, the average
 * weight and its change, and how the weight goal is pacing. Computed from the days, never stored. Null while Body isn't set up.
 */
export async function bodyWeek(workspaceId: string, userId: string, monday: string, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const sunday = addDays(monday, 6);
  const to = sunday < today ? sunday : today;
  const prevMonday = addDays(monday, -7);
  const [days, prevDays, training, prevTraining, readings, goals, recovery] = await Promise.all([
    daysInRange(workspaceId, userId, monday, to, today),
    daysInRange(workspaceId, userId, prevMonday, addDays(monday, -1), today),
    trainingWeek(workspaceId, userId, monday, settings),
    trainingWeek(workspaceId, userId, prevMonday, settings),
    scaleReadings(workspaceId, userId, addDays(today, -40) < prevMonday ? addDays(today, -40) : prevMonday),
    db.query.bodyGoals.findMany({ where: and(eq(schema.bodyGoals.workspaceId, workspaceId), eq(schema.bodyGoals.userId, userId)) }),
    recoveryWeek(workspaceId, userId, monday, today),
  ]);
  const asWeekDay = (d: (typeof days)[number]): WeekDay => ({ date: d.date, logged: d.logged, totals: d.totals, bands: d.bands, worst: d.worst, final: d.final });
  const figures = dayFigures(readings).filter((f) => f.values.weight != null && f.date <= today).map((f) => ({ date: f.date, weight: f.values.weight! }));
  const inWeek = (from: string, until: string) => figures.filter((f) => f.date >= from && f.date <= until);
  const weigh = weighWeek(inWeek(monday, sunday));
  const prevWeigh = weighWeek(inWeek(prevMonday, addDays(monday, -1)));
  const weightGoal = goals.find((g) => g.key === "weight") ?? null;
  const latest = figures[figures.length - 1] ?? null;
  const pace = goalPace(weightGoal ? { target: weightGoal.target, by: weightGoal.by } : null, latest?.weight ?? null, avg7(figures.map((f) => ({ date: f.date, value: f.weight })), today, addDays), avg7(figures.map((f) => ({ date: f.date, value: f.weight })), addDays(today, -28), addDays), today, daysBetween);
  return {
    settings,
    monday,
    sunday,
    isCurrent: monday <= today && today <= sunday,
    days: [...days].reverse(),
    nutrition: nutritionWeek(days.map(asWeekDay)),
    prevNutrition: nutritionWeek(prevDays.map(asWeekDay)),
    training,
    prevTraining,
    weigh: { ...weigh, prevAvg: prevWeigh.avg, change: change(weigh.avg, prevWeigh.avg), latest },
    pace,
    sleep: recovery.sleep,
    habits: recovery.habits,
  };
}
export type BodyWeekView = NonNullable<Awaited<ReturnType<typeof bodyWeek>>>;

/**
 * The one check every AI prompt that could include Body data goes through (rev 219). Read fresh on every call, so switching it off
 * stops it on the very next request. Only the member's own session: a coach, or a coach switched into the client's HelixOS, never.
 */
export async function canAiUseBody(v: Viewer, memberUserId: string): Promise<boolean> {
  // A coach switched into a client's HelixOS (rev 216) is never the member, whatever the viewer's user says.
  if (v.switchedInto || v.actor.id !== v.user.id) return false;
  if (memberUserId !== v.user.id) return false;
  const s = await bodySettingsFor(v.workspace.id, memberUserId);
  return bodyAiAllowedFor({ viewerUserId: v.user.id, memberUserId, memberEnabled: v.membership.bodyEnabled, aiUse: !!s?.aiUse });
}

/**
 * The member's Body data as a short block of numbers and text for an AI prompt, or null when AI may not use it. The only way Body
 * data reaches AI (a unit test holds that): targets, the last 7 days' totals, today's logged foods and meals, saved meal names.
 * Never photos, private notes or a coach's comments.
 */
export async function bodyAiContext(v: Viewer): Promise<string | null> {
  if (!(await canAiUseBody(v, v.user.id))) return null;
  const [d, recent, types, training] = await Promise.all([bodyDay(v.workspace.id, v.user.id, v.today, v.today), recentDays(v.workspace.id, v.user.id, v.today), dayTypesFor(v.workspace.id, v.user.id), recentTraining(v.workspace.id, v.user.id, v.today)]);
  if (!d) return null;
  const [weighIn, recovery] = await Promise.all([weighInsForAi(v.workspace.id, v.user.id, v.today, d.settings.weightUnit), recoveryForAi(v.workspace.id, v.user.id, v.today)]);
  return formatBodyForAi({
    today: v.today,
    dayTypes: types.map((t) => ({ name: t.name, bands: bandsOf(t) })),
    days: recent.map((r) => ({ date: r.date, dayType: r.dayType, totals: r.totals, logged: r.logged })),
    todayEntries: d.entries.map((e) => ({ slot: e.slot, name: e.name, items: e.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })), totals: { cal: e.cal, p: e.p, f: e.f, c: e.c } })),
    meals: d.library.meals.map((m) => m.name),
    training,
    weighIn,
    habits: recovery.habits,
    sleep: recovery.sleep,
  });
}

export async function shareHistory(workspaceId: string, userId: string) {
  return db.query.bodyShareEvents.findMany({ where: and(eq(schema.bodyShareEvents.workspaceId, workspaceId), eq(schema.bodyShareEvents.userId, userId)), orderBy: desc(schema.bodyShareEvents.createdAt), limit: 20 });
}

/** The coach's client page: whether this client shares Body, and if so the last week's one-line summary. Nothing when private. */
export async function coachBodySummary(v: Viewer, memberUserId: string, today: string) {
  if ((await bodyAccess(v, memberUserId)) !== "coach") return null;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, memberUserId)) });
  return { membershipId: m!.id, days: await recentDays(v.workspace.id, memberUserId, today) };
}

/**
 * The coach's client table (rev 237 phase 12): one Body cell per client who shares with this coach, by user id; nothing for the
 * rest, so the table can't tell a private client from one with Body off. Each by the client's own week and today: days in band
 * of the days judged so far, the last weigh-in, sessions so far. Never the health log, never habits.
 */
export async function coachBodyColumn(v: Viewer, clients: { userId: string; today: string }[]): Promise<Map<string, CoachBodyCell & { short: string; long: string }>> {
  const out = new Map<string, CoachBodyCell & { short: string; long: string }>();
  if (v.role !== "coach" || v.switchedInto) return out;
  for (const c of clients) {
    if ((await bodyAccess(v, c.userId)) !== "coach") continue;
    const monday = startOfWeek(c.today);
    const [days, sets, readings] = await Promise.all([
      daysInRange(v.workspace.id, c.userId, monday, c.today, c.today),
      db.query.bodySets.findMany({ columns: { date: true }, where: and(eq(schema.bodySets.workspaceId, v.workspace.id), eq(schema.bodySets.userId, c.userId), gte(schema.bodySets.date, monday), lte(schema.bodySets.date, c.today)) }),
      scaleReadings(v.workspace.id, c.userId, addDays(c.today, -400)),
    ]);
    const n = nutritionWeek(days.map((d) => ({ date: d.date, logged: d.logged, totals: d.totals, bands: d.bands, worst: d.worst, final: d.final })));
    const weighed = dayFigures(readings).filter((f) => f.values.weight != null && f.date <= c.today);
    const cell = { inBand: n.daysInBand, judged: n.daysJudged, lastWeighIn: weighed.at(-1)?.date ?? null, sessions: new Set(sets.map((s) => s.date)).size };
    out.set(c.userId, { ...cell, ...coachBodyText(cell, c.today, formatDate, daysBetween) });
  }
  return out;
}

/**
 * The coach's day view (Danno, 1 Oct): the client's night and recovery for the day and their habits that day, read only after
 * sharedClient said shared. Never the health log, which has no path to a coach.
 */
export async function coachDayExtras(workspaceId: string, userId: string, date: string, today: string) {
  const [night, h] = await Promise.all([nights(workspaceId, userId, date, date), habitsDay(workspaceId, userId, date, today)]);
  const n = night[0];
  const sleep = n && (n.sleep_h != null || n.sleep_score != null || n.recovery != null)
    ? { hours: n.sleep_h != null ? fmtHours(n.sleep_h) : null, score: n.sleep_score ?? null, recovery: n.recovery ?? null, strain: n.strain ?? null, rhr: n.rhr ?? null, hrv: n.hrv ?? null }
    : null;
  return { sleep, habits: h.habits.filter((x) => x.due || x.value != null).map((x) => ({ id: x.id, name: x.name, kept: x.kept, valueText: x.valueText, due: x.due })) };
}

/* ───────── Habits, sleep and the health log (rev 237 phase 8, B7) ───────── */

const habitDates = { addDays, weekday, startOfWeek };

/** A habit is due from the day it was added, or from its earliest log when the member logged earlier days by hand. */
function withSince<T extends { id: string; since?: string | null }>(habits: T[], logs: { habitId: string; date: string }[]): T[] {
  return habits.map((h) => {
    const first = logs.filter((l) => l.habitId === h.id).map((l) => l.date).sort()[0];
    return first && (!h.since || first < h.since) ? { ...h, since: first } : h;
  });
}

export async function habitsFor(workspaceId: string, userId: string, opts: { archived?: boolean; today?: string } = {}) {
  // `since` is the day it was added, never after the member's today (createdAt is UTC, which can be a day ahead of them).
  const rows = (await db.query.bodyHabits.findMany({ where: and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId)), orderBy: [asc(schema.bodyHabits.order), asc(schema.bodyHabits.createdAt)] })).map((h) => ({ ...h, since: opts.today && h.createdAt.slice(0, 10) > opts.today ? opts.today : h.createdAt.slice(0, 10) }));
  return opts.archived ? rows : rows.filter((h) => !h.archivedAt);
}

/**
 * The member's habits on a day: each with its value that day, whether it's due and kept, its streak (counted back from today) and
 * the week's dots; plus the week's tally so far. Positive framing is the page's job; this is the arithmetic.
 */
export async function habitsDay(workspaceId: string, userId: string, date: string, today: string) {
  const habits0 = await habitsFor(workspaceId, userId, { today });
  if (!habits0.length) return { habits: [], week: { due: 0, kept: 0 }, monday: startOfWeek(date) };
  const logs = await db.query.bodyHabitLogs.findMany({ where: and(and(eq(schema.bodyHabitLogs.workspaceId, workspaceId), eq(schema.bodyHabitLogs.userId, userId)), gte(schema.bodyHabitLogs.date, addDays(today, -400))) });
  const habits = withSince(habits0, logs);
  const monday = startOfWeek(date);
  const sunday = addDays(monday, 6);
  return {
    monday,
    habits: habits.map((h) => {
      const value = logs.find((l) => l.habitId === h.id && l.date === date)?.value ?? null;
      return { ...h, value, due: dueOn(h, weekday(date), date), kept: kept(h, value), streak: streak(h, logs, today, habitDates), dots: weekDots(h, logs, monday, today, habitDates) as Dot[], valueText: value != null ? fmtHabitValue(h, value) : "" };
    }),
    week: habitsWeek(habits, logs, monday, sunday < today ? sunday : today > sunday ? sunday : today, habitDates),
  };
}
export type HabitsDayView = Awaited<ReturnType<typeof habitsDay>>;

/** Due and kept over a Monday-to-date span, for the week page. */
async function habitsSpan(workspaceId: string, userId: string, from: string, to: string) {
  const habits = await habitsFor(workspaceId, userId, { today: to });
  if (!habits.length || to < from) return { due: 0, kept: 0 };
  const logs = await db.query.bodyHabitLogs.findMany({ where: and(and(eq(schema.bodyHabitLogs.workspaceId, workspaceId), eq(schema.bodyHabitLogs.userId, userId)), gte(schema.bodyHabitLogs.date, from), lte(schema.bodyHabitLogs.date, to)) });
  return habitsWeek(withSince(habits, logs), logs, from, to, habitDates);
}

/** The nights on record, oldest first: hours and the optional score, from the manual rows and any wearable's. */
async function nights(workspaceId: string, userId: string, from: string, to: string) {
  const rows = await db.query.bodyDaily.findMany({ where: and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), inArray(schema.bodyDaily.key, ["sleep_h", "sleep_score", "recovery", "strain", "rhr", "hrv"]), gte(schema.bodyDaily.date, from), lte(schema.bodyDaily.date, to)), orderBy: asc(schema.bodyDaily.date) });
  const byDate = new Map<string, Partial<Record<RecoveryKey, number>> & { date: string }>();
  for (const r of rows) {
    if (!isRecoveryKey(r.key)) continue;
    const d = byDate.get(r.date) ?? { date: r.date };
    d[r.key] = r.value;
    byDate.set(r.date, d);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The Sleep page: the last night, this week against last, the trend over 30 nights, and the last 14 nights to edit. */
export async function sleepView(workspaceId: string, userId: string, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const all = await nights(workspaceId, userId, addDays(today, -90), today);
  const slept = all.filter((n): n is typeof n & { sleep_h: number } => n.sleep_h != null);
  const asNight = (n: { date: string; sleep_h: number }): Night => ({ date: n.date, hours: n.sleep_h });
  const monday = startOfWeek(today);
  const inSpan = (from: string, to: string) => slept.filter((n) => n.date >= from && n.date <= to).map(asNight);
  const trend = slept.filter((n) => n.date >= addDays(today, -30)).map(asNight);
  const last = slept[slept.length - 1] ?? null;
  return {
    settings,
    last: last ? { date: last.date, hours: last.sleep_h, text: fmtHours(last.sleep_h), score: last.sleep_score ?? null } : null,
    week: sleepWeek(inSpan(monday, today)),
    prevWeek: sleepWeek(inSpan(addDays(monday, -7), addDays(monday, -1))),
    trend,
    averages: sleepAverages(trend, daysBetween),
    recent: [...all].reverse().slice(0, 14),
  };
}
export type SleepView = NonNullable<Awaited<ReturnType<typeof sleepView>>>;

/** The health log, open first (newest start first), each restricted exercise named. The member's alone: no coach path reads this. */
export async function healthLog(workspaceId: string, userId: string, today: string) {
  const [rows, exercises] = await Promise.all([
    db.query.bodyHealth.findMany({ where: and(eq(schema.bodyHealth.workspaceId, workspaceId), eq(schema.bodyHealth.userId, userId)), orderBy: desc(schema.bodyHealth.startedOn) }),
    db.query.bodyExercises.findMany({ where: and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId)) }),
  ]);
  const name = new Map(exercises.map((e) => [e.id, e.name]));
  const isOpen = (r: schema.BodyHealth) => !r.resolvedOn || r.resolvedOn > today;
  const shaped = rows.map((r) => ({ ...r, open: isOpen(r), restrictedNames: r.restricted.map((id) => name.get(id)).filter((n): n is string => !!n) }));
  return { open: shaped.filter((r) => r.open), resolved: shaped.filter((r) => !r.open), exercises: exercises.filter((e) => !e.archivedAt) };
}

/** Exercises an open injury restricts today, each with the injury's title: Training marks them. Member-only, like the log. */
export async function restrictedNow(workspaceId: string, userId: string, today: string): Promise<Map<string, string>> {
  const rows = await db.query.bodyHealth.findMany({ where: and(and(eq(schema.bodyHealth.workspaceId, workspaceId), eq(schema.bodyHealth.userId, userId)), isNull(schema.bodyHealth.resolvedOn)) });
  const later = await db.query.bodyHealth.findMany({ where: and(and(eq(schema.bodyHealth.workspaceId, workspaceId), eq(schema.bodyHealth.userId, userId)), gte(schema.bodyHealth.resolvedOn, addDays(today, 1))) });
  const out = new Map<string, string>();
  for (const r of [...rows, ...later]) for (const id of r.restricted) if (!out.has(id)) out.set(id, r.title);
  return out;
}

/** Sleep and habits for the week page (rev 237 phase 6 said they'd join): this week against last. */
export async function recoveryWeek(workspaceId: string, userId: string, monday: string, today: string) {
  const sunday = addDays(monday, 6);
  const to = sunday < today ? sunday : today;
  const prevMonday = addDays(monday, -7);
  const [thisN, prevN, habits, prevHabits] = await Promise.all([nights(workspaceId, userId, monday, to), nights(workspaceId, userId, prevMonday, addDays(monday, -1)), habitsSpan(workspaceId, userId, monday, to), habitsSpan(workspaceId, userId, prevMonday, addDays(monday, -1))]);
  const asNights = (ns: Awaited<ReturnType<typeof nights>>): Night[] => ns.filter((n): n is typeof n & { sleep_h: number } => n.sleep_h != null).map((n) => ({ date: n.date, hours: n.sleep_h }));
  const sleep = sleepWeek(asNights(thisN));
  const prevSleep = sleepWeek(asNights(prevN));
  return { sleep: { ...sleep, prevAvg: prevSleep.avg, change: change(sleep.avg, prevSleep.avg) }, habits: { ...habits, prevDue: prevHabits.due, prevKept: prevHabits.kept } };
}

/** Habits and sleep in words for the AI block (rev 219 allows both as numbers and short text). Never the health log. */
export async function recoveryForAi(workspaceId: string, userId: string, today: string): Promise<{ habits: string | null; sleep: string | null }> {
  const [hd, sv] = await Promise.all([habitsDay(workspaceId, userId, today, today), sleepView(workspaceId, userId, today)]);
  const due = hd.habits.filter((h) => h.due);
  const habits = due.length ? `${hd.week.kept} of ${hd.week.due} kept this week; today: ${due.map((h) => `${h.name} ${h.kept ? "✓" : h.value != null ? `${h.valueText} so far` : "not yet"}${h.streak ? ` (streak ${h.streak})` : ""}`).join(", ")}` : null;
  const sleep = sv?.last ? `${sv.last.date}: ${sv.last.text}${sv.last.score != null ? `, score ${sv.last.score}` : ""}${sv.week.avg != null ? `; this week ${fmtHours(sv.week.avg)} a night over ${sv.week.nights} night${sv.week.nights === 1 ? "" : "s"}` : ""}` : null;
  return { habits, sleep };
}

/* ───────── The correlation explorer (B10, rev 237 phase 9) ───────── */

export type InsightMetric = MetricDef;

/** The metrics on offer for this member: the fixed list plus each of their habits. */
export async function insightMetrics(workspaceId: string, userId: string): Promise<InsightMetric[]> {
  const habits = await habitsFor(workspaceId, userId);
  return [...METRIC_DEFS, ...habits.map((h): InsightMetric => ({ key: habitKey(h.name), label: `${h.name}${h.kind === "done" ? " (1 = kept)" : h.kind === "minutes" ? " (min)" : h.unit ? ` (${h.unit})` : ""}`, group: "Habits", fold: h.kind === "done" ? "sum" : "sum" }))];
}

/**
 * One date-keyed series over a range. Body from its own tables, business from the member's own daily log and tasks: nothing
 * crosses members. The health log is never a metric; its open ranges only serve the "leave out" option.
 */
async function seriesFor(workspaceId: string, userId: string, key: string, from: string, to: string, today: string, tz: string): Promise<Point[]> {
  if (isHabitKey(key)) {
    const habits = await habitsFor(workspaceId, userId, { today });
    const h = habits.find((x) => habitKey(x.name) === key);
    if (!h) return [];
    const logs = await db.query.bodyHabitLogs.findMany({ where: and(eq(schema.bodyHabitLogs.habitId, h.id), gte(schema.bodyHabitLogs.date, from), lte(schema.bodyHabitLogs.date, to)) });
    const value = new Map(logs.map((l) => [l.date, l.value]));
    const hs = withSince([h], logs)[0];
    // Every due day counts: a day without a log is a zero, so a skipped habit is data too.
    return rangeDays(from, to).filter((d) => dueOn(hs, weekday(d), d)).map((d) => ({ date: d, value: h.kind === "done" ? (kept(h, value.get(d)) ? 1 : 0) : (value.get(d) ?? 0) }));
  }
  if (key === "sleep_h" || key === "sleep_score") {
    const rows = await db.query.bodyDaily.findMany({ where: and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), eq(schema.bodyDaily.key, key), gte(schema.bodyDaily.date, from), lte(schema.bodyDaily.date, to)) });
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.date, r.value);
    return [...byDate.entries()].map(([date, value]) => ({ date, value }));
  }
  if (key === "weight" || key === "bf") {
    const readings = await scaleReadings(workspaceId, userId, from);
    return dayFigures(readings).filter((f) => f.date <= to && f.values[key] != null).map((f) => ({ date: f.date, value: f.values[key]! }));
  }
  if (["cal", "p", "f", "c", "fatOver", "inBand", "offPlan"].includes(key)) {
    const days = await daysInRange(workspaceId, userId, from, to, today);
    return days.flatMap((d) => {
      if (!d.logged) return [];
      if (key === "fatOver") return d.bands?.f ? [{ date: d.date, value: Math.max(0, d.totals.f - d.bands.f.max) }] : [];
      if (key === "inBand") return d.worst ? [{ date: d.date, value: d.worst === "in" || d.worst === "over_ok" ? 1 : 0 }] : [];
      if (key === "offPlan") return d.worst ? [{ date: d.date, value: d.worst === "in" || d.worst === "over_ok" ? 0 : 1 }] : [];
      return [{ date: d.date, value: d.totals[key as Macro] }];
    });
  }
  if (key === "session" || key === "sets") {
    const sets = await db.query.bodySets.findMany({ columns: { date: true }, where: and(and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId)), gte(schema.bodySets.date, from), lte(schema.bodySets.date, to)) });
    const count = new Map<string, number>();
    for (const x of sets) count.set(x.date, (count.get(x.date) ?? 0) + 1);
    return rangeDays(from, to).map((d) => ({ date: d, value: key === "session" ? (count.has(d) ? 1 : 0) : (count.get(d) ?? 0) }));
  }
  if (key === "tasksClosed") {
    const done = await db.query.tasks.findMany({ columns: { completedAt: true }, where: and(and(eq(schema.tasks.workspaceId, workspaceId), eq(schema.tasks.userId, userId)), eq(schema.tasks.status, "done")) });
    const count = new Map<string, number>();
    for (const t of done) {
      if (!t.completedAt) continue;
      const d = todayInTz(tz, new Date(t.completedAt));
      if (d >= from && d <= to) count.set(d, (count.get(d) ?? 0) + 1);
    }
    return rangeDays(from, to).map((d) => ({ date: d, value: count.get(d) ?? 0 }));
  }
  const biz = ["energy", "dmsStarted", "conversations", "callsBooked", "callsHeld", "posts", "offersMade", "newLeads", "cashCollected", "webinarRegs"] as const;
  if ((biz as readonly string[]).includes(key)) {
    const logs = await db.query.dailyLogs.findMany({ where: and(and(eq(schema.dailyLogs.workspaceId, workspaceId), eq(schema.dailyLogs.userId, userId)), gte(schema.dailyLogs.date, from), lte(schema.dailyLogs.date, to)) });
    const k = key as (typeof biz)[number];
    // Energy is a rating the member gives or doesn't; the counts are zero on a day with a log and nothing on a day without.
    return logs.flatMap((l) => (k === "energy" ? (l.energy != null ? [{ date: l.date, value: l.energy }] : []) : [{ date: l.date, value: l[k] }]));
  }
  return [];
}

/**
 * The dates to leave out of Patterns when asked: an open injury's days (the health log; only their dates leave this function)
 * and every day marked travelling or ill (rev 237 phase 15).
 */
async function flaggedDays(workspaceId: string, userId: string, from: string, to: string): Promise<Set<string>> {
  const [rows, marked] = await Promise.all([
    db.query.bodyHealth.findMany({ columns: { startedOn: true, resolvedOn: true }, where: and(eq(schema.bodyHealth.workspaceId, workspaceId), eq(schema.bodyHealth.userId, userId)) }),
    db.query.bodyDays.findMany({ columns: { date: true }, where: and(and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId)), isNotNull(schema.bodyDays.flag), gte(schema.bodyDays.date, from), lte(schema.bodyDays.date, to)) }),
  ]);
  const out = new Set<string>(marked.map((m) => m.date));
  for (const r of rows) for (const d of rangeDays(r.startedOn > from ? r.startedOn : from, r.resolvedOn && r.resolvedOn < to ? r.resolvedOn : to)) out.add(d);
  return out;
}

export type CorrelateInput = { a: string; b: string; lag: number; window: number; grain: Grain; excludeFlagged: boolean };

/** The explorer's answer: both series over the window, the pairs, and the readout by the rules. Null when a metric is unknown. */
export async function correlate(workspaceId: string, userId: string, today: string, tz: string, input: CorrelateInput) {
  const metrics = await insightMetrics(workspaceId, userId);
  const A = metrics.find((m) => m.key === input.a);
  const B = metrics.find((m) => m.key === input.b);
  if (!A || !B) return null;
  const lag = Math.max(0, Math.min(3, Math.round(input.lag)));
  const window = [4, 8, 12].includes(input.window) ? input.window : 8;
  const to = today;
  const from = addDays(startOfWeek(today), -7 * (window - 1));
  const [a, b, excluded] = await Promise.all([seriesFor(workspaceId, userId, A.key, addDays(from, -lag), to, today, tz), seriesFor(workspaceId, userId, B.key, from, to, today, tz), input.excludeFlagged ? flaggedDays(workspaceId, userId, from, to) : Promise.resolve(new Set<string>())]);
  const pairs = pairUp(a, b, { lag, grain: input.grain, foldA: A.fold as Fold, foldB: B.fold as Fold, exclude: excluded, addDays, startOfWeek });
  const read = verdict(pairs, A.label, B.label, input.grain === "weekly" ? "weeks" : "days");
  return { a: A, b: B, lag, window, grain: input.grain, from, to, seriesA: a.filter((p) => p.date >= from), seriesB: b, pairs, excluded: excluded.size, verdict: read, metrics };
}
export type CorrelateView = NonNullable<Awaited<ReturnType<typeof correlate>>>;

/* ───────── Shopping and Instacart (rev 237 phase 10) ───────── */

/** The week's plan, the list it gives with the shelf and the par levels, and the log of pushes. `skip` drops foods for this view only. */
export async function shoppingView(workspaceId: string, userId: string, today: string, skip: Set<string> = new Set()) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const monday = startOfWeek(today);
  const [library, plan, items, orders] = await Promise.all([
    bodyLibrary(workspaceId, userId),
    db.query.bodyPlan.findMany({ where: and(and(eq(schema.bodyPlan.workspaceId, workspaceId), eq(schema.bodyPlan.userId, userId)), eq(schema.bodyPlan.monday, monday)) }),
    db.query.bodyPantry.findMany({ where: and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId)) }),
    db.query.bodyOrders.findMany({ where: and(eq(schema.bodyOrders.workspaceId, workspaceId), eq(schema.bodyOrders.userId, userId)), orderBy: desc(schema.bodyOrders.createdAt), limit: 10 }),
  ]);
  const meals = library.meals.filter((m) => !m.archivedAt);
  const planned = plan.flatMap((p) => {
    const m = meals.find((x) => x.id === p.mealId);
    return m ? [{ meal: m, times: p.times }] : [];
  });
  const foods: ShopFood[] = library.foods.map((f) => ({ id: f.id, name: f.name, unit: f.unit, basis: f.basis, par: f.par, cookedYield: f.cookedYield, section: f.section }));
  const list = shoppingList(foods, planned.map((p) => ({ times: p.times, lines: p.meal.lines.map((l) => ({ foodId: l.food.id, qty: l.qty })) })), items, skip);
  return { settings, monday, meals, planned, list, orders, foods: library.foods };
}
export type ShoppingView = NonNullable<Awaited<ReturnType<typeof shoppingView>>>;

/* ───────── Longer views (rev 237 phase 10b): the same figures over a month, 90 days or a year ───────── */

const rangeDates = { addDays, startOfWeek };

/** Training over a range: sessions, sets and PRs, per-week bars, which routines ran how often, and the calendar strip of trained days. */
export async function trainingRange(workspaceId: string, userId: string, b: Bounds, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const [sets, sessions, days] = await Promise.all([
    db.query.bodySets.findMany({ columns: { id: true, date: true, exerciseId: true }, where: and(eq(schema.bodySets.workspaceId, workspaceId), eq(schema.bodySets.userId, userId), gte(schema.bodySets.date, b.from), lte(schema.bodySets.date, b.to)) }),
    db.query.bodySessions.findMany({ columns: { date: true, routineName: true, completedAt: true }, where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), gte(schema.bodySessions.date, b.from), lte(schema.bodySessions.date, b.to)) }),
    db.query.bodyDays.findMany({ columns: { date: true, off: true }, where: and(eq(schema.bodyDays.workspaceId, workspaceId), eq(schema.bodyDays.userId, userId), gte(schema.bodyDays.date, b.from), lte(schema.bodyDays.date, b.to)) }),
  ]);
  const setsOn = new Map<string, number>();
  for (const x of sets) setsOn.set(x.date, (setsOn.get(x.date) ?? 0) + 1);
  const trained = [...setsOn.keys()].sort();
  const ids = [...new Set(sets.map((x) => x.exerciseId))];
  const history = await setsOf(workspaceId, userId, ids);
  let prs = 0;
  for (const id of ids) {
    const own = history.filter((x) => x.exerciseId === id);
    const flags = prFlags(own, settings.weightUnit);
    prs += own.filter((x, i) => flags[i] && x.date >= b.from && x.date <= b.to).length;
  }
  const routines = new Map<string, number>();
  for (const sess of sessions) if (setsOn.has(sess.date)) routines.set(sess.routineName ?? "No routine", (routines.get(sess.routineName ?? "No routine") ?? 0) + 1);
  const sessionOn = new Map(sessions.map((x) => [x.date, x]));
  const offRow = new Map(days.map((d) => [d.date, d.off]));
  return {
    sessions: trained.length,
    sets: sets.length,
    prs,
    perWeekSessions: perWeek(trained.map((date) => ({ date, value: 1 })), b.from, b.to, "sum", rangeDates),
    perWeekSets: perWeek([...setsOn.entries()].map(([date, value]) => ({ date, value })), b.from, b.to, "sum", rangeDates),
    routines: [...routines.entries()].sort((x, y) => y[1] - x[1]).map(([name, times]) => ({ name, times })),
    weeks: calendarWeeks(b.from, b.to, today, rangeDates, (d) => heatLevel(setsOn.get(d) ?? 0), (d) => {
      const n = setsOn.get(d) ?? 0;
      const sess = sessionOn.get(d);
      const what = offRow.get(d) ? "Off" : n ? `${n} set${n === 1 ? "" : "s"}${sess?.routineName ? ` · ${sess.routineName}` : ""}${sess?.completedAt ? " ✓" : ""}` : d > today ? "" : "nothing logged";
      return `${formatDate(d, { weekday: "short", month: "short", day: "numeric" })}${what ? `: ${what}` : ""}`;
    }),
  };
}

/** Weigh-ins over a range: the day figures, the change from the first to the last (weight and body fat), and the latest. */
export async function weighRange(workspaceId: string, userId: string, b: Bounds) {
  const readings = await scaleReadings(workspaceId, userId, b.from);
  const figures = dayFigures(readings).filter((f) => f.date >= b.from && f.date <= b.to);
  const first = figures[0] ?? null;
  const last = figures[figures.length - 1] ?? null;
  const change = (key: MetricKey) => (first && last && first !== last && first.values[key] != null && last.values[key] != null ? Math.round((last.values[key]! - first.values[key]!) * 10) / 10 : null);
  return { days: figures.length, first, last, change: { weight: change("weight"), bf: change("bf") }, points: figures.flatMap((f) => (f.values.weight != null ? [{ date: f.date, value: f.values.weight }] : [])) };
}

/** Sleep over a range: each night, the average, nights at 7 h, the per-week average. */
export async function sleepRange(workspaceId: string, userId: string, b: Bounds) {
  const all = await nights(workspaceId, userId, b.from, b.to);
  const slept: Night[] = all.filter((n): n is typeof n & { sleep_h: number } => n.sleep_h != null).map((n) => ({ date: n.date, hours: n.sleep_h }));
  return { nights: slept, summary: sleepWeek(slept), perWeek: perWeek(slept.map((n) => ({ date: n.date, value: n.hours })), b.from, b.to, "mean", rangeDates), under: slept.filter((n) => n.hours < 7).length };
}

/** Habits over a range: per habit the due and kept days, the kept rate, the best run inside the range, and its heat strip. */
export async function habitsRange(workspaceId: string, userId: string, b: Bounds, today: string) {
  const habits0 = await habitsFor(workspaceId, userId, { today });
  if (!habits0.length) return { habits: [], due: 0, kept: 0 };
  const logs = await db.query.bodyHabitLogs.findMany({ where: and(and(eq(schema.bodyHabitLogs.workspaceId, workspaceId), eq(schema.bodyHabitLogs.userId, userId)), gte(schema.bodyHabitLogs.date, b.from), lte(schema.bodyHabitLogs.date, b.to)) });
  const habits = withSince(habits0, logs);
  const to = b.to < today ? b.to : today;
  let due = 0;
  let keptAll = 0;
  const rows = habits.map((h) => {
    const value = new Map(logs.filter((l) => l.habitId === h.id).map((l) => [l.date, l.value]));
    let d = 0;
    let k = 0;
    let run = 0;
    let best = 0;
    for (const date of rangeDays(b.from, to)) {
      if (!dueOn(h, weekday(date), date)) continue;
      d++;
      if (kept(h, value.get(date))) {
        k++;
        run++;
        best = Math.max(best, run);
      } else if (date !== today) run = 0;
    }
    due += d;
    keptAll += k;
    return {
      ...h,
      due: d,
      kept: k,
      best,
      weeks: calendarWeeks(b.from, b.to, today, rangeDates, (date) => (!dueOn(h, weekday(date), date) ? 1 : kept(h, value.get(date)) ? 3 : date === today ? 2 : 0), (date) => `${formatDate(date, { weekday: "short", month: "short", day: "numeric" })}: ${!dueOn(h, weekday(date), date) ? "not due" : kept(h, value.get(date)) ? `kept${value.get(date) != null && h.kind !== "done" ? ` (${fmtHabitValue(h, value.get(date)!)})` : ""}` : date === today ? "today" : "a gap"}`),
    };
  });
  return { habits: rows, due, kept: keptAll };
}

/** The rollup over any range: nutrition, training, weight, sleep and habits, the week page's tiles over a month, 90 days or a year. */
export async function bodyRange(workspaceId: string, userId: string, b: Bounds, today: string) {
  const settings = await bodySettingsFor(workspaceId, userId);
  if (!settings) return null;
  const [days, prevDays, training, weigh, sleep, habits] = await Promise.all([daysInRange(workspaceId, userId, b.from, b.to, today), daysInRange(workspaceId, userId, b.prevFrom, b.prevTo, today), trainingRange(workspaceId, userId, b, today), weighRange(workspaceId, userId, b), sleepRange(workspaceId, userId, b), habitsRange(workspaceId, userId, b, today)]);
  const asWeekDay = (d: (typeof days)[number]): WeekDay => ({ date: d.date, logged: d.logged, totals: d.totals, bands: d.bands, worst: d.worst, final: d.final });
  return { settings, bounds: b, nutrition: nutritionWeek(days.map(asWeekDay)), prevNutrition: nutritionWeek(prevDays.map(asWeekDay)), training: training!, weigh, sleep, habits };
}
export type BodyRangeView = NonNullable<Awaited<ReturnType<typeof bodyRange>>>;

/* ───────── WHOOP (rev 237 phase 11) ───────── */

/** The member's WHOOP connection for Body settings: connected when, last sync, last error; never a token. */
export async function whoopStatus(workspaceId: string, userId: string) {
  const d = await db.query.bodyDevices.findFirst({ columns: { connectedAt: true, lastSyncAt: true, lastError: true, providerUserId: true }, where: and(and(eq(schema.bodyDevices.workspaceId, workspaceId), eq(schema.bodyDevices.userId, userId)), eq(schema.bodyDevices.provider, "whoop")) });
  return d ? { connectedAt: d.connectedAt, lastSyncAt: d.lastSyncAt, lastError: d.lastError, known: !!d.providerUserId } : null;
}

/** The device's workouts on a day, for Training: sport, minutes, strain, heart rate. */
export async function activitiesOn(workspaceId: string, userId: string, date: string) {
  return db.query.bodyActivities.findMany({ where: and(eq(schema.bodyActivities.workspaceId, workspaceId), eq(schema.bodyActivities.userId, userId), eq(schema.bodyActivities.date, date)), orderBy: asc(schema.bodyActivities.startedAt) });
}
