/**
 * Merging exercises (rev 507), one way for the Routines page and the connector: a preview first, then every set of the merged
 * exercise moves onto the kept one (dates and order kept), routines and the health log's restrictions point at the kept one,
 * the kept one keeps its step (or takes the merged one's when it has none), and the merged one is archived, never deleted.
 * What moved is recorded, so Undo puts it all back for 7 days.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { mergePreview, mergeRoutineItems, undoOpen, type MergePreview } from "@/lib/engine/body-merge";
import { bodySettingsFor } from "@/lib/queries/body";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";

const own = <T extends { workspaceId: unknown; userId: unknown }>(t: T, workspaceId: string, userId: string) => and(eq(t.workspaceId as never, workspaceId), eq(t.userId as never, userId));

async function pair(workspaceId: string, userId: string, mergedId: string, keptId: string) {
  if (mergedId === keptId) return { error: "Pick another exercise to merge into." } as const;
  const [merged, kept] = await Promise.all([
    db.query.bodyExercises.findFirst({ where: and(eq(schema.bodyExercises.id, mergedId), own(schema.bodyExercises, workspaceId, userId)) }),
    db.query.bodyExercises.findFirst({ where: and(eq(schema.bodyExercises.id, keptId), own(schema.bodyExercises, workspaceId, userId)) }),
  ]);
  if (!merged || !kept || merged.archivedAt || kept.archivedAt) return { error: "One of those exercises isn't there any more." } as const;
  return { merged, kept } as const;
}

export async function previewMerge(workspaceId: string, userId: string, mergedId: string, keptId: string): Promise<{ error: string } | (MergePreview & { mergedName: string; keptName: string })> {
  const p = await pair(workspaceId, userId, mergedId, keptId);
  if ("error" in p) return { error: p.error! };
  const settings = await bodySettingsFor(workspaceId, userId);
  const [mSets, kSets] = await Promise.all([
    db.query.bodySets.findMany({ where: and(eq(schema.bodySets.exerciseId, p.merged.id), own(schema.bodySets, workspaceId, userId)) }),
    db.query.bodySets.findMany({ where: and(eq(schema.bodySets.exerciseId, p.kept.id), own(schema.bodySets, workspaceId, userId)) }),
  ]);
  const preview = mergePreview(mSets, kSets, { mergedName: p.merged.name, keptName: p.kept.name, unit: settings?.weightUnit ?? "lb", kind: p.kept.kind });
  return { ...preview, mergedName: p.merged.name, keptName: p.kept.name };
}

export async function mergeExercises(workspaceId: string, userId: string, mergedId: string, keptId: string): Promise<{ error: string } | { mergeId: string; text: string }> {
  const preview = await previewMerge(workspaceId, userId, mergedId, keptId);
  if ("error" in preview) return preview;
  const p = (await pair(workspaceId, userId, mergedId, keptId)) as { merged: schema.BodyExercise; kept: schema.BodyExercise };
  const [sets, routines, health] = await Promise.all([
    db.query.bodySets.findMany({ columns: { id: true }, where: and(eq(schema.bodySets.exerciseId, p.merged.id), own(schema.bodySets, workspaceId, userId)) }),
    db.query.bodyRoutines.findMany({ where: own(schema.bodyRoutines, workspaceId, userId) }),
    db.query.bodyHealth.findMany({ where: own(schema.bodyHealth, workspaceId, userId) }),
  ]);
  const routineChanges = routines.flatMap((r) => {
    const items = mergeRoutineItems(r.items, p.merged.id, p.kept.id);
    return items ? [{ routineId: r.id, before: r.items, after: items }] : [];
  });
  const healthChanges = health.filter((h) => h.restricted.includes(p.merged.id)).map((h) => ({ healthId: h.id, before: h.restricted, after: [...new Set(h.restricted.map((x) => (x === p.merged.id ? p.kept.id : x)))] }));
  const mergeId = newId();
  await db.insert(schema.bodyExerciseMerges).values({ id: mergeId, workspaceId, userId, keptId: p.kept.id, mergedId: p.merged.id, setIds: sets.map((s) => s.id), routines: routineChanges.map((r) => ({ routineId: r.routineId, items: r.before })), health: healthChanges.map((h) => ({ healthId: h.healthId, restricted: h.before })), keptStep: p.kept.step });
  for (let i = 0; i < sets.length; i += 200) await db.update(schema.bodySets).set({ exerciseId: p.kept.id }).where(and(inArray(schema.bodySets.id, sets.slice(i, i + 200).map((s) => s.id)), own(schema.bodySets, workspaceId, userId)));
  for (const r of routineChanges) await db.update(schema.bodyRoutines).set({ items: r.after }).where(and(eq(schema.bodyRoutines.id, r.routineId), own(schema.bodyRoutines, workspaceId, userId)));
  for (const h of healthChanges) await db.update(schema.bodyHealth).set({ restricted: h.after }).where(and(eq(schema.bodyHealth.id, h.healthId), own(schema.bodyHealth, workspaceId, userId)));
  if (p.kept.step == null && p.merged.step != null) await db.update(schema.bodyExercises).set({ step: p.merged.step }).where(eq(schema.bodyExercises.id, p.kept.id));
  await db.update(schema.bodyExercises).set({ archivedAt: nowIso() }).where(eq(schema.bodyExercises.id, p.merged.id));
  return { mergeId, text: preview.text.replace(/^Move/, "Moved").replace("; PR becomes", "; the PR is now").replace("; PR stays", "; the PR stays") };
}

/** The merge still open to undo for an archived exercise, with what it went into. */
export async function openMerges(workspaceId: string, userId: string): Promise<(schema.BodyExerciseMerge & { keptName: string; mergedName: string })[]> {
  const rows = await db.query.bodyExerciseMerges.findMany({ where: and(own(schema.bodyExerciseMerges, workspaceId, userId), isNull(schema.bodyExerciseMerges.undoneAt)), orderBy: desc(schema.bodyExerciseMerges.createdAt) });
  const open = rows.filter((m) => undoOpen(m.createdAt));
  if (!open.length) return [];
  const names = new Map((await db.query.bodyExercises.findMany({ columns: { id: true, name: true }, where: own(schema.bodyExercises, workspaceId, userId) })).map((e) => [e.id, e.name]));
  return open.map((m) => ({ ...m, keptName: names.get(m.keptId) ?? "an exercise", mergedName: names.get(m.mergedId) ?? "an exercise" }));
}

/** Put a merge back: the sets, routines, restrictions and step as they were, and the merged exercise in the library again. */
export async function undoMerge(workspaceId: string, userId: string, mergeId: string): Promise<{ error: string } | { text: string }> {
  const m = await db.query.bodyExerciseMerges.findFirst({ where: and(eq(schema.bodyExerciseMerges.id, mergeId), own(schema.bodyExerciseMerges, workspaceId, userId)) });
  if (!m || m.undoneAt) return { error: "That merge is already undone." };
  if (!undoOpen(m.createdAt)) return { error: "Undo is open for 7 days after a merge, and this one is older." };
  for (let i = 0; i < m.setIds.length; i += 200) await db.update(schema.bodySets).set({ exerciseId: m.mergedId }).where(and(inArray(schema.bodySets.id, m.setIds.slice(i, i + 200)), own(schema.bodySets, workspaceId, userId)));
  for (const r of m.routines) await db.update(schema.bodyRoutines).set({ items: r.items }).where(and(eq(schema.bodyRoutines.id, r.routineId), own(schema.bodyRoutines, workspaceId, userId)));
  for (const h of m.health) await db.update(schema.bodyHealth).set({ restricted: h.restricted }).where(and(eq(schema.bodyHealth.id, h.healthId), own(schema.bodyHealth, workspaceId, userId)));
  await db.update(schema.bodyExercises).set({ step: m.keptStep }).where(and(eq(schema.bodyExercises.id, m.keptId), own(schema.bodyExercises, workspaceId, userId)));
  await db.update(schema.bodyExercises).set({ archivedAt: null }).where(and(eq(schema.bodyExercises.id, m.mergedId), own(schema.bodyExercises, workspaceId, userId)));
  await db.update(schema.bodyExerciseMerges).set({ undoneAt: nowIso() }).where(eq(schema.bodyExerciseMerges.id, m.id));
  return { text: `Undone: ${m.setIds.length} set${m.setIds.length === 1 ? "" : "s"} back on their own exercise.` };
}
