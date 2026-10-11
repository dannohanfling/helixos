/**
 * Logging sets (rev 653): the one write behind Training's Log set, body_log_set and body_log_exercise, so a set logged by voice is
 * the same row as one typed on the page. The day's session is made on first use; a set after Finish reopens it. Notes and the
 * warm-up mark live on the set. Every read and write here is the member's own, keyed by workspace and user.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import type { WeightUnit } from "@/lib/engine/body-training";

const own = <T extends { workspaceId: unknown; userId: unknown }>(t: T, workspaceId: string, userId: string) => and(eq(t.workspaceId as never, workspaceId), eq(t.userId as never, userId));

export type NewSet = { weight: number | null; unit: WeightUnit; reps: number; warmup?: boolean; note?: string | null };

/** The day's session, made on first use, from no routine. One per date. */
export async function daySession(workspaceId: string, userId: string, date: string): Promise<schema.BodySession> {
  await db
    .insert(schema.bodySessions)
    .values({ id: newId(), workspaceId, userId, date, routineId: null, routineName: null })
    .onConflictDoNothing({ target: [schema.bodySessions.workspaceId, schema.bodySessions.userId, schema.bodySessions.date] });
  return (await db.query.bodySessions.findFirst({ where: and(own(schema.bodySessions, workspaceId, userId), eq(schema.bodySessions.date, date)) }))!;
}

/** Sets of one exercise on a day, in the order given, into its session; reopens a finished session. */
export async function logSets(workspaceId: string, userId: string, date: string, exerciseId: string, sets: NewSet[]): Promise<{ session: schema.BodySession; reopened: boolean; ids: string[] }> {
  const session = await daySession(workspaceId, userId, date);
  const ids: string[] = [];
  // One at a time: created_at has whole seconds, and the rowid keeps the order they were said in.
  for (const s of sets) {
    const id = newId();
    ids.push(id);
    await db.insert(schema.bodySets).values({ id, workspaceId, userId, sessionId: session.id, exerciseId, date, weight: s.weight, unit: s.unit, reps: s.reps, warmup: !!s.warmup, note: s.note?.trim() ? s.note.trim().slice(0, 300) : null });
  }
  // A set after "Finish workout" reopens the session (phase 3): finished means nothing more was logged.
  const reopened = !!session.completedAt && sets.length > 0;
  if (reopened) await db.update(schema.bodySessions).set({ completedAt: null }).where(and(eq(schema.bodySessions.id, session.id), own(schema.bodySessions, workspaceId, userId)));
  return { session, reopened, ids };
}

/** The last set of an exercise on a day (rowid breaks a tie in created_at), or null. */
export async function lastSetOf(workspaceId: string, userId: string, date: string, exerciseId: string) {
  return (
    (await db.query.bodySets.findFirst({ where: and(own(schema.bodySets, workspaceId, userId), eq(schema.bodySets.date, date), eq(schema.bodySets.exerciseId, exerciseId)), orderBy: [desc(schema.bodySets.createdAt), desc(sql`rowid`)] })) ?? null
  );
}

/** A note on a set (rev 653), or on the day's session; an empty note clears it. */
export async function noteSet(workspaceId: string, userId: string, setId: string, note: string | null | undefined, warmup?: boolean): Promise<void> {
  await db
    .update(schema.bodySets)
    .set({ ...(note === undefined ? {} : { note: note?.trim() ? note.trim().slice(0, 300) : null }), ...(warmup === undefined ? {} : { warmup }) })
    .where(and(eq(schema.bodySets.id, setId), own(schema.bodySets, workspaceId, userId)));
}
export async function noteSession(workspaceId: string, userId: string, sessionId: string, note: string): Promise<void> {
  await db.update(schema.bodySessions).set({ note: note.trim().slice(0, 500) || null }).where(and(eq(schema.bodySessions.id, sessionId), own(schema.bodySessions, workspaceId, userId)));
}

/** Every set of the member's on and after a date, oldest first, for the warm-up dry run. */
export async function setsSince(workspaceId: string, userId: string, from: string) {
  return db.query.bodySets.findMany({ where: and(own(schema.bodySets, workspaceId, userId), sql`${schema.bodySets.date} >= ${from}`), orderBy: [asc(schema.bodySets.date), asc(schema.bodySets.createdAt), asc(sql`rowid`)] });
}

/** Mark sets as warm-ups (only the member's own ids count). */
export async function markWarmups(workspaceId: string, userId: string, ids: string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const r = await db.update(schema.bodySets).set({ warmup: true }).where(and(eq(schema.bodySets.id, id), own(schema.bodySets, workspaceId, userId)));
    n += r.rowsAffected ?? 0;
  }
  return n;
}
