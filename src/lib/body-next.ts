/**
 * Next time's weight (rev 486), one write for the post-workout read's "Use next time" and the connector's body_set_next_weight:
 * the weight the member will actually load becomes the routine's target for that exercise, and when they set something other
 * than the suggestion, the step they took (what they'll load minus what they lifted) becomes that exercise's step from then on.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { stepFromEdit } from "@/lib/engine/body-reads";

export type NextSaved = { routineName: string; exerciseName: string; weight: number; learnedStep: number | null };

export async function saveNextWeight(workspaceId: string, userId: string, o: { routineId: string; exerciseId: string; weight: number; suggested: number | null; top: number | null }): Promise<NextSaved | { error: string }> {
  const ownR = and(eq(schema.bodyRoutines.workspaceId, workspaceId), eq(schema.bodyRoutines.userId, userId));
  const ownE = and(eq(schema.bodyExercises.workspaceId, workspaceId), eq(schema.bodyExercises.userId, userId));
  const [routine, exercise] = await Promise.all([
    db.query.bodyRoutines.findFirst({ where: and(eq(schema.bodyRoutines.id, o.routineId), ownR) }),
    db.query.bodyExercises.findFirst({ where: and(eq(schema.bodyExercises.id, o.exerciseId), ownE) }),
  ]);
  if (!routine || !exercise) return { error: "That routine or exercise isn't there any more." };
  if (!routine.items.some((i) => i.exerciseId === exercise.id)) return { error: `${exercise.name} isn't in ${routine.name}.` };
  if (!(o.weight > 0 && o.weight < 5000)) return { error: "That weight doesn't look right." };
  await db.update(schema.bodyRoutines).set({ items: routine.items.map((i) => (i.exerciseId === exercise.id ? { ...i, weight: o.weight } : i)) }).where(and(eq(schema.bodyRoutines.id, routine.id), ownR));
  const step = stepFromEdit(o.top, o.weight, o.suggested);
  if (step != null) await db.update(schema.bodyExercises).set({ step }).where(and(eq(schema.bodyExercises.id, exercise.id), ownE));
  return { routineName: routine.name, exerciseName: exercise.name, weight: o.weight, learnedStep: step };
}
