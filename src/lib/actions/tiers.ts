"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx } from "@/lib/action-helpers";

/** Records that the member has seen the celebration for reaching this tier, so it shows once. */
export async function markTierCelebratedAction(level: number): Promise<void> {
  const { v } = await ctx();
  const current = v.membership.celebratedTierLevel ?? -1;
  if (!Number.isInteger(level) || level <= current) return;
  await db.update(schema.memberships).set({ celebratedTierLevel: level }).where(eq(schema.memberships.id, v.membership.id));
}
