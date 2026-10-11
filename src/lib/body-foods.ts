/**
 * A found food saved to the member's foods (rev 653): the one write behind Find's Save and body_log_described_food. Per the
 * member's food unit; a food of the same name is updated (and brought back if archived), never doubled.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { foodFromFound, type FoundFood } from "@/lib/engine/body-find";

export async function saveFoundFood(workspaceId: string, userId: string, found: FoundFood, foodUnit: "oz" | "g"): Promise<schema.BodyFood> {
  const food = foodFromFound(found, foodUnit);
  const where = and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId), eq(schema.bodyFoods.name, food.name));
  const have = await db.query.bodyFoods.findFirst({ where });
  if (have) await db.update(schema.bodyFoods).set({ ...food, archivedAt: null }).where(eq(schema.bodyFoods.id, have.id));
  else await db.insert(schema.bodyFoods).values({ id: newId(), workspaceId, userId, ...food });
  return (await db.query.bodyFoods.findFirst({ where }))!;
}
