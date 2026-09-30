/**
 * Pantry writes shared by the forms and the MCP tools (rev 237 phase 5): a logged line comes off the shelf. Reads live in
 * src/lib/queries/body.ts; the rules in src/lib/engine/body-pantry.ts. A Body module: it touches Body tables for the member
 * whose ids it's given, and nothing here is logged.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { takeFromPantry, yieldFor } from "@/lib/engine/body-pantry";

/**
 * Each logged line (the food, and its quantity in the food's unit as the food's basis) comes off the member's shelf: soonest
 * use-by first, a raw item shrinking by the food's yield when the food is counted cooked. Items reaching zero go. Foods with
 * nothing on the shelf, and lines with no food, change nothing.
 */
export async function consumePantry(workspaceId: string, userId: string, lines: { foodId: string | null; qty: number }[]): Promise<void> {
  const ids = [...new Set(lines.flatMap((l) => (l.foodId && l.qty > 0 ? [l.foodId] : [])))];
  if (!ids.length) return;
  const [foods, items, weighings] = await Promise.all([
    db.query.bodyFoods.findMany({ where: and(and(eq(schema.bodyFoods.workspaceId, workspaceId), eq(schema.bodyFoods.userId, userId)), inArray(schema.bodyFoods.id, ids)) }),
    db.query.bodyPantry.findMany({ where: and(and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId)), inArray(schema.bodyPantry.foodId, ids)) }),
    db.query.bodyYields.findMany({ where: and(and(eq(schema.bodyYields.workspaceId, workspaceId), eq(schema.bodyYields.userId, userId)), inArray(schema.bodyYields.foodId, ids)) }),
  ]);
  // The shelf as it stands, kept up to date across lines of the same food.
  const shelf = new Map(items.map((it) => [it.id, { ...it }]));
  for (const line of lines) {
    const food = foods.find((f) => f.id === line.foodId);
    if (!food || line.qty <= 0) continue;
    const factor = yieldFor(food, weighings.filter((w) => w.foodId === food.id)).factor;
    const onShelf = [...shelf.values()].filter((it) => it.foodId === food.id && it.qty > 0);
    for (const change of takeFromPantry(onShelf, food, line.qty, factor)) {
      const it = shelf.get(change.id)!;
      it.qty = change.qty;
      if (change.qty <= 0) await db.delete(schema.bodyPantry).where(and(eq(schema.bodyPantry.id, change.id), and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId))));
      else await db.update(schema.bodyPantry).set({ qty: change.qty }).where(and(eq(schema.bodyPantry.id, change.id), and(eq(schema.bodyPantry.workspaceId, workspaceId), eq(schema.bodyPantry.userId, userId))));
    }
  }
}
