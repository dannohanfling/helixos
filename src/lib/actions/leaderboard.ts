"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { readHidden } from "@/lib/engine/leaderboard";
import { checkFeed, feedForMembership, removeFeedKey, saveFeedSettings } from "@/lib/leaderboard";

/** One of this coach's clients, by membership. */
async function clientOf(workspaceId: string, membershipId: string) {
  return db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client")) });
}

/**
 * Connect and check (rev 639): the coach pastes the client's eLoyalty key on their /coach row. It is sealed at once and only its
 * last four are ever shown; a blank key keeps the saved one. Then the check runs and says, in words, what it found.
 */
export async function saveLeaderboardAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const m = await clientOf(coach.workspace.id, str(formData, "membershipId"));
  if (!m) return;
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  const feed = await feedForMembership(m, m.businessName || u?.name || "leaderboard");
  const saved = await saveFeedSettings(feed, { key: str(formData, "key"), host: str(formData, "host"), templateId: str(formData, "templateId") });
  if (saved.keyEncrypted) await checkFeed(saved);
  refresh();
}

/** Check again: the same check, on the key already saved. */
export async function checkLeaderboardAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const feed = await db.query.leaderboardFeeds.findFirst({ where: and(eq(schema.leaderboardFeeds.id, str(formData, "id")), eq(schema.leaderboardFeeds.workspaceId, coach.workspace.id)) });
  if (feed) await checkFeed(feed);
  refresh();
}

/** Remove key: the key and the held board go at once; the feed answers 503 until a key is saved again. */
export async function removeLeaderboardKeyAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  await removeFeedKey(str(formData, "id"), coach.workspace.id);
  refresh();
}

/** The client's own hide list, one eLoyalty customer id per line: theirs to set, never a team member's or a switched coach's. */
export async function saveLeaderboardHiddenAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ whileSwitched: "refuse", team: "refuse", reason: "The leaderboard's hide list is {first}'s own to set." });
  await db.update(schema.leaderboardFeeds).set({ hidden: readHidden(str(formData, "hidden")), updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.membershipId, v.membership.id));
  refresh();
}
