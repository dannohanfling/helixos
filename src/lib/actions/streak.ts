"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { applyRecount } from "@/lib/streak";

/** The streak recount's Apply (H-289 §4): the coach's own tap, in their own workspace, after reading the dry run. */
export async function applyStreakRecountAction(): Promise<void> {
  const v = await requireCoach();
  const r = await applyRecount(v.workspace.id, v.workspace.timezone);
  refresh();
  redirect(`/coach/late-closes?applied=${r.points}&days=${r.days}&members=${r.members}`);
}

/** "Got it" on Today's one line about the recount: the member's own, seen once. */
export async function streakRecountSeenAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", reason: "The streak is {first}'s own." });
  await db.update(schema.memberships).set({ streakRecountSeenAt: nowIso() }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
}
