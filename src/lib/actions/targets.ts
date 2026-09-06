"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { TARGET_METRICS } from "@/lib/engine/targets";
import { ctx, num, refresh, str } from "./common";

/** Saves the month's targets. Zero clears a target. */
export async function setTargetsAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const month = str(formData, "month");
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  for (const m of TARGET_METRICS) {
    const target = num(formData, m.key);
    const existing = await db.query.targets.findFirst({ where: and(eq(schema.targets.userId, userId), eq(schema.targets.month, month), eq(schema.targets.metric, m.key)) });
    if (!target && existing) await db.delete(schema.targets).where(eq(schema.targets.id, existing.id));
    else if (target && existing) await db.update(schema.targets).set({ target }).where(eq(schema.targets.id, existing.id));
    else if (target) await db.insert(schema.targets).values({ id: newId(), workspaceId, userId, month, metric: m.key, target });
  }
  refresh();
}
