"use server";

/**
 * The first arrival's one write (H-472): the seen stamp (once, on the ceremony's end, Skip or the button) on the member's own
 * row or the team member's own row. A coach switched into a client stamps nothing for them. The replay from Settings is a
 * link to Today with ?arrival=replay, which the Today page reads; nothing is written for it.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ctx } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";

export async function markFirstArrivalSeenAction(): Promise<void> {
  const { v } = await ctx({ whileSwitched: "noop", team: "noop" });
  if (v.switchedInto) return;
  if (v.team) {
    await db.update(schema.teamMembers).set({ firstArrivalSeenAt: nowIso() }).where(and(eq(schema.teamMembers.id, v.team.teamMemberId), eq(schema.teamMembers.teamUserId, v.actor.id)));
    return;
  }
  if (v.membership.firstArrivalSeenAt) return;
  await db.update(schema.memberships).set({ firstArrivalSeenAt: nowIso() }).where(and(eq(schema.memberships.id, v.membership.id), eq(schema.memberships.workspaceId, v.workspace.id)));
}
