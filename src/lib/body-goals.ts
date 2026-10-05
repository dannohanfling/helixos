/**
 * Goals' reads and writes (rev 508 §5), for the Goals page, Today, the week, the end-of-day read, the coach's view and the
 * connector. Every read and write is the member's own (workspace and user). A goal's series is read from where its numbers
 * already live: the scale's day figures, waist entries, a lift's sets, habit ticks, days with a set, nights' sleep.
 */
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { BodyGoal, BodyGoalKind } from "@/db/schema";
import { goalStatus, goalTitle, levelAt, statusLine, topGoals, type GoalStatus, type Point } from "@/lib/engine/body-goals";
import { isMetricKey } from "@/lib/engine/body-scale";
import { kept } from "@/lib/engine/body-habits";
import { toUnit, type WeightUnit } from "@/lib/engine/body-training";
import { dayFigures, groupReadings } from "@/lib/queries/body";
import { addDays, daysBetween, formatDate, nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

type Member = { workspaceId: string; userId: string };
const D = { addDays, daysBetween };
const short = (d: string) => formatDate(d, { month: "short", day: "numeric" });
const own = <T extends { workspaceId: unknown; userId: unknown }>(t: T, m: Member) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));

export type GoalView = { goal: BodyGoal; title: string; line: string; status: GoalStatus; name: string | null };

/** Where each kind's key comes from. */
export const goalKey = (kind: BodyGoalKind, metric: string | null, refId: string | null) => (kind === "scale" ? (metric ?? "weight") : kind === "lift" || kind === "habit" ? `${kind}:${refId}` : kind);

/** The points a goal reads, from `from` on (the window the pace needs, or its start if earlier). */
async function seriesFor(m: Member, g: BodyGoal, from: string): Promise<Point[]> {
  if (g.kind === "scale" || g.kind === "waist" || g.kind === "sleep") {
    const rows = await db.query.bodyDaily.findMany({ where: and(own(schema.bodyDaily, m), gte(schema.bodyDaily.date, from)), orderBy: asc(schema.bodyDaily.date) });
    if (g.kind === "scale") {
      if (!isMetricKey(g.key)) return [];
      return dayFigures(groupReadings(rows)).flatMap((f) => (f.values[g.key as never] != null ? [{ date: f.date, value: f.values[g.key as never] as number }] : []));
    }
    const key = g.kind === "waist" ? "waist" : "sleep_h";
    // One value a day: the last entry of the day.
    const byDay = new Map<string, number>();
    for (const r of rows) if (r.key === key) byDay.set(r.date, r.value);
    return [...byDay].map(([date, value]) => ({ date, value }));
  }
  if (g.kind === "lift") {
    if (!g.refId) return [];
    const sets = await db.query.bodySets.findMany({ where: and(own(schema.bodySets, m), eq(schema.bodySets.exerciseId, g.refId)), orderBy: asc(schema.bodySets.date) });
    const best = new Map<string, number>();
    for (const s of sets) {
      if (s.weight == null || s.reps < (g.reps ?? 1)) continue;
      const lb = toUnit(s.weight, s.unit, "lb");
      if (lb > (best.get(s.date) ?? 0)) best.set(s.date, lb);
    }
    return [...best].map(([date, value]) => ({ date, value }));
  }
  if (g.kind === "habit") {
    if (!g.refId) return [];
    const habit = await db.query.bodyHabits.findFirst({ where: and(own(schema.bodyHabits, m), eq(schema.bodyHabits.id, g.refId)) });
    if (!habit) return [];
    const logs = await db.query.bodyHabitLogs.findMany({ where: and(own(schema.bodyHabitLogs, m), eq(schema.bodyHabitLogs.habitId, g.refId), gte(schema.bodyHabitLogs.date, from)) });
    return logs.filter((l) => kept(habit, l.value)).map((l) => ({ date: l.date, value: 1 }));
  }
  const sets = await db.query.bodySets.findMany({ where: and(own(schema.bodySets, m), gte(schema.bodySets.date, from)), columns: { date: true } });
  return [...new Set(sets.map((s) => s.date))].map((date) => ({ date, value: 1 }));
}

/** The member's live goals with their pace, oldest first; archived ones only when asked. */
export async function goalsFor(m: Member, today: string, unit: WeightUnit, opts: { archived?: boolean } = {}): Promise<GoalView[]> {
  const goals = await db.query.bodyGoals.findMany({ where: and(own(schema.bodyGoals, m), opts.archived ? undefined : isNull(schema.bodyGoals.archivedAt)), orderBy: asc(schema.bodyGoals.createdAt) });
  if (!goals.length) return [];
  const [exercises, habits] = await Promise.all([db.query.bodyExercises.findMany({ where: own(schema.bodyExercises, m), columns: { id: true, name: true } }), db.query.bodyHabits.findMany({ where: own(schema.bodyHabits, m), columns: { id: true, name: true } })]);
  const out: GoalView[] = [];
  for (const g of goals) {
    const start = g.startDate ?? g.createdAt.slice(0, 10);
    const from = [addDays(today, -35), addDays(start, -14)].sort()[0];
    const points = await seriesFor(m, g, from);
    const status = goalStatus(g, points, today, D);
    const name = g.kind === "lift" ? (exercises.find((e) => e.id === g.refId)?.name ?? null) : g.kind === "habit" ? (habits.find((h) => h.id === g.refId)?.name ?? null) : null;
    out.push({ goal: g, name, status, title: goalTitle(g, name, unit, short), line: statusLine(g, status, unit, short) });
  }
  return out;
}

export type GoalInput = { kind: BodyGoalKind; metric?: string | null; refId?: string | null; reps?: number | null; target: number; by?: string | null; startValue?: number | null };

/**
 * Sets a goal (one per key): a new one starts from the 7-day average today unless a start is given; setting one again keeps
 * its start unless a new start is given, and brings an archived one back. The target and start are in the stored unit.
 */
export async function setGoal(m: Member, input: GoalInput, today: string): Promise<BodyGoal> {
  const key = goalKey(input.kind, input.metric ?? null, input.refId ?? null);
  const existing = await db.query.bodyGoals.findFirst({ where: and(own(schema.bodyGoals, m), eq(schema.bodyGoals.key, key)) });
  const fresh = !existing || Boolean(existing.archivedAt);
  let startValue = input.startValue ?? (fresh ? null : existing!.startValue);
  if (startValue == null && fresh) {
    const probe = { kind: input.kind, key, refId: input.refId ?? null, reps: input.reps ?? null, target: input.target, by: null, startValue: null, startDate: today, createdAt: today, archivedAt: null } as BodyGoal;
    const points = await seriesFor(m, probe, addDays(today, -35));
    startValue = input.kind === "lift" ? (points.length ? Math.max(...points.map((p) => p.value)) : null) : input.kind === "habit" || input.kind === "training" ? null : levelAt(points, today, D);
  }
  const values = { kind: input.kind, refId: input.refId ?? null, reps: input.kind === "lift" ? (input.reps ?? 1) : null, target: input.target, by: input.by ?? null, startValue: startValue == null ? null : Math.round(startValue * 100) / 100, ...(fresh || input.startValue != null ? { startDate: today } : {}), archivedAt: null };
  if (existing) await db.update(schema.bodyGoals).set(values).where(eq(schema.bodyGoals.id, existing.id));
  else await db.insert(schema.bodyGoals).values({ id: newId(), ...m, key, ...values });
  return (await db.query.bodyGoals.findFirst({ where: and(own(schema.bodyGoals, m), eq(schema.bodyGoals.key, key)) }))!;
}

/** Archive or bring back; an archived goal leaves Today, the week and the read, and stays on Goals under Archived. */
export async function archiveGoal(m: Member, id: string, back = false): Promise<void> {
  await db.update(schema.bodyGoals).set({ archivedAt: back ? null : nowIso() }).where(and(own(schema.bodyGoals, m), eq(schema.bodyGoals.id, id)));
}

/** A waist measurement, in inches, as the day's entry (a second one that day replaces the first). */
export async function logWaist(m: Member, date: string, inches: number): Promise<void> {
  const prior = await db.query.bodyDaily.findMany({ where: and(own(schema.bodyDaily, m), eq(schema.bodyDaily.date, date), eq(schema.bodyDaily.key, "waist")) });
  for (const p of prior) await db.delete(schema.bodyDaily).where(eq(schema.bodyDaily.id, p.id));
  await db.insert(schema.bodyDaily).values({ id: newId(), ...m, date, key: "waist", value: Math.round(inches * 100) / 100, source: "manual", readingId: newId(), time: null });
}

/** The latest waist entry, for the Goals page's box. */
export async function lastWaist(m: Member): Promise<{ date: string; value: number } | null> {
  const rows = await db.query.bodyDaily.findMany({ where: and(own(schema.bodyDaily, m), eq(schema.bodyDaily.key, "waist")), orderBy: asc(schema.bodyDaily.date), columns: { date: true, value: true } });
  return rows.at(-1) ?? null;
}

/** The goals that need it most, for Today's card and the read: the member's own unit, two by default. */
export async function goalsNow(m: Member, today: string, n = 2): Promise<GoalView[]> {
  const settings = await db.query.bodySettings.findFirst({ where: own(schema.bodySettings, m), columns: { weightUnit: true } });
  if (!settings) return [];
  return topGoals(await goalsFor(m, today, settings.weightUnit), n);
}

/** The lifts and habits a goal can be of, for the Goals page's pickers: live exercises, and every habit. */
export async function goalPickers(m: Member) {
  const [exercises, habits] = await Promise.all([db.query.bodyExercises.findMany({ where: and(own(schema.bodyExercises, m), isNull(schema.bodyExercises.archivedAt)), columns: { id: true, name: true } }), db.query.bodyHabits.findMany({ where: own(schema.bodyHabits, m), columns: { id: true, name: true } })]);
  return { exercises, habits };
}
