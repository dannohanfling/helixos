"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx } from "@/lib/action-helpers";

/** Records that the member has seen the celebration for reaching this tier, so it shows once. */
export async function markTierCelebratedAction(level: number): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop", team: "noop" });
  // A coach switched into a client's HelixOS (rev 216) and a team member (Danno, 6 Oct) never mark anything seen for them.
  if (v.switchedInto || v.team) return;
  const current = v.membership.celebratedTierLevel ?? -1;
  if (!Number.isInteger(level) || level <= current) return;
  await db.update(schema.memberships).set({ celebratedTierLevel: level }).where(eq(schema.memberships.id, v.membership.id));
}
