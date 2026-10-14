"use server";

/** The Aqueduct's two remembered choices (rev 711): "Pause the water" and the period, each the member's own. */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { PERIODS } from "@/lib/engine/aqueduct";

export async function setAqueductPausedAction(paused: boolean): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto) return;
  await db.update(schema.memberships).set({ aqueductPaused: paused === true }).where(eq(schema.memberships.id, v.membership.id));
}

/** The period: the last 30 days against the 30 before, or 7 against 7. */
export async function setAqueductPeriodAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto) return;
  const days = Number(str(formData, "period"));
  if (!(PERIODS as readonly number[]).includes(days)) return;
  await db.update(schema.memberships).set({ aqueductPeriod: days }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
}
