/**
 * Body's Airtable history (B5, rev 237 phase 7): reading the member's HumanOS base and writing the approved plan. The token
 * arrives with the request and goes nowhere else (src/lib/airtable.ts). Only the Journal, Exercises and Routines tables are
 * read. Writes are matched so a re-run adds nothing twice: a weigh-in by its Journal row, a day by its date, an exercise or a
 * routine by its name.
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { readTables, type BaseAccess } from "@/lib/airtable";
import { HUMANOS_TABLES, humanosSource, readingIdFor, type Existing, type HistoryPlan, type HumanosSource } from "@/lib/engine/body-airtable";
import type { MetricKey } from "@/lib/engine/body-scale";
import { newId } from "@/lib/ids";

export async function readHumanos(access: BaseAccess): Promise<{ source: HumanosSource; missing: string[] }> {
  const r = await readTables(access, HUMANOS_TABLES);
  return { source: humanosSource(r.found), missing: r.missing };
}

const lc = (s: string) => s.trim().toLowerCase();

/** What the member already holds, so the dry run says new or already in. */
export async function existingHistory(workspaceId: string, userId: string): Promise<Existing> {
  const [exercises, routines, sessions, daily, dayTypes] = await Promise.all([
    db.query.bodyExercises.findMany({ where: and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId)) }),
    db.query.bodyRoutines.findMany({ where: and(eq(schema.bodyRoutines.workspaceId, workspaceId), eq(schema.bodyRoutines.userId, userId)) }),
    db.query.bodySessions.findMany({ where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId)), columns: { date: true } }),
    db.query.bodyDaily.findMany({ where: and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), eq(schema.bodyDaily.source, "airtable")), columns: { readingId: true } }),
    db.query.bodyDayTypes.findMany({ where: and(eq(schema.bodyDayTypes.workspaceId, workspaceId), eq(schema.bodyDayTypes.userId, userId)), columns: { id: true, name: true } }),
  ]);
  // Rev 296: history that didn't come through this importer (the connector, the forms, a wearable) means the member's record is already here.
  const [ownSessions, ownWeights] = await Promise.all([
    db.query.bodySessions.findFirst({ where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), or(isNull(schema.bodySessions.note), ne(schema.bodySessions.note, "From Airtable"))), columns: { id: true } }),
    db.query.bodyDaily.findFirst({ where: and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), eq(schema.bodyDaily.key, "weight"), ne(schema.bodyDaily.source, "airtable")), columns: { id: true } }),
  ]);
  return {
    exercises: new Map(exercises.filter((e) => !e.archivedAt).map((e) => [lc(e.name), e.id])),
    routines: new Set(routines.map((r) => lc(r.name))),
    routineIds: new Map(routines.filter((r) => !r.archivedAt).map((r) => [lc(r.name), r.id])),
    sessionDates: new Set(sessions.map((s) => s.date)),
    readingIds: new Set(daily.map((d) => d.readingId)),
    dayTypes: new Map(dayTypes.map((t) => [lc(t.name), t.id])),
    ownHistory: !!(ownSessions || ownWeights),
  };
}

/** Write the approved plan: new exercises first (the rest name them), then routines, the days with their sets, and the weigh-ins. */
export async function applyHistory(plan: HistoryPlan, existing: Existing, workspaceId: string, userId: string): Promise<{ written: number }> {
  let written = 0;
  // Day types only (rev 296): each planned day takes its day type, already in or not; nothing else is written.
  if (plan.dayTypesOnly) {
    const only = plan.sessions.filter((s) => s.dayTypeId).map((s) => ({ id: newId(), workspaceId, userId, date: s.date, dayTypeId: s.dayTypeId!, off: false }));
    for (let i = 0; i < only.length; i += 200) await db.insert(schema.bodyDays).values(only.slice(i, i + 200)).onConflictDoUpdate({ target: [schema.bodyDays.workspaceId, schema.bodyDays.userId, schema.bodyDays.date], set: { dayTypeId: sql`excluded.day_type_id`, off: false } });
    return { written: only.length };
  }
  const ids = new Map(existing.exercises);
  const exercises: (typeof schema.bodyExercises.$inferInsert)[] = [];
  for (const e of plan.exercises) {
    if (ids.has(lc(e.name))) continue;
    const id = newId();
    ids.set(lc(e.name), id);
    exercises.push({ id, workspaceId, userId, name: e.name.slice(0, 80), kind: "weight" });
  }
  if (exercises.length) await db.insert(schema.bodyExercises).values(exercises);
  written += exercises.length;

  const routines: (typeof schema.bodyRoutines.$inferInsert)[] = [];
  const routineIds = new Map(existing.routineIds ?? []);
  for (const r of plan.routines) {
    if (r.status !== "new" || existing.routines.has(lc(r.name))) continue;
    const items = r.items.map((i) => ({ exerciseId: ids.get(lc(i.exerciseName)) ?? "", sets: i.sets, reps: i.reps })).filter((i) => i.exerciseId);
    if (!items.length) continue;
    const id = newId();
    routineIds.set(lc(r.name), id);
    routines.push({ id, workspaceId, userId, name: r.name.slice(0, 80), dayTypeId: null, items });
  }
  if (routines.length) await db.insert(schema.bodyRoutines).values(routines);
  written += routines.length;

  const sessions: (typeof schema.bodySessions.$inferInsert)[] = [];
  const sets: (typeof schema.bodySets.$inferInsert)[] = [];
  const days: (typeof schema.bodyDays.$inferInsert)[] = [];
  for (const s of plan.sessions) {
    if (s.status !== "new" || existing.sessionDates.has(s.date)) continue;
    const sessionId = newId();
    // Marked as imported (Danno, 1 Oct): the note says so on Training; the day links to its routine and takes the matching day type.
    sessions.push({ id: sessionId, workspaceId, userId, date: s.date, routineId: (s.routineName && routineIds.get(lc(s.routineName))) || null, routineName: s.routineName, completedAt: `${s.date}T12:00:00.000Z`, note: "From Airtable" });
    if (s.dayTypeId) days.push({ id: newId(), workspaceId, userId, date: s.date, dayTypeId: s.dayTypeId, off: false });
    for (const e of s.exercises) {
      const exerciseId = ids.get(lc(e.name));
      if (!exerciseId) continue;
      for (const x of e.sets) sets.push({ id: newId(), workspaceId, userId, sessionId, exerciseId, date: s.date, weight: x.weight, unit: "lb", reps: x.reps });
    }
  }
  for (let i = 0; i < sessions.length; i += 200) await db.insert(schema.bodySessions).values(sessions.slice(i, i + 200)).onConflictDoNothing({ target: [schema.bodySessions.workspaceId, schema.bodySessions.userId, schema.bodySessions.date] });
  for (let i = 0; i < sets.length; i += 400) await db.insert(schema.bodySets).values(sets.slice(i, i + 400));
  for (let i = 0; i < days.length; i += 200) await db.insert(schema.bodyDays).values(days.slice(i, i + 200)).onConflictDoUpdate({ target: [schema.bodyDays.workspaceId, schema.bodyDays.userId, schema.bodyDays.date], set: { dayTypeId: sql`excluded.day_type_id`, off: false } });
  written += sessions.length + sets.length;

  const rows: (typeof schema.bodyDaily.$inferInsert)[] = [];
  for (const w of plan.weighIns) {
    const readingId = readingIdFor(w.recordId);
    if (w.status !== "new" || existing.readingIds.has(readingId)) continue;
    for (const [key, value] of Object.entries(w.values) as [MetricKey, number][]) rows.push({ id: newId(), workspaceId, userId, date: w.date, key, value, source: "airtable", readingId, time: null });
  }
  for (let i = 0; i < rows.length; i += 400) await db.insert(schema.bodyDaily).values(rows.slice(i, i + 400));
  written += plan.weighIns.filter((w) => w.status === "new").length;
  return { written };
}
