"use server";

/**
 * The streak flame's one write (H-558): the streak day whose surge has played, on the member's own row, so the surge plays
 * once per day. A coach switched into a client stamps nothing; a team member is refused (they have no pill).
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx } from "@/lib/action-helpers";

export async function markStreakSurgeSeenAction(day: string): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop" });
  if (v.switchedInto) return;
  // Only today's streak day or yesterday's (inside the late close-out window); never a day ahead.
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day > v.today) return;
  await db.update(schema.memberships).set({ streakSurgeSeenOn: day }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id)));
}
