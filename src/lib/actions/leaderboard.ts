"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { pageConfigFromForm, parseExport, readHidden } from "@/lib/engine/leaderboard";
import { checkFeed, feedForMembership, removeFeedKey, saveExport, saveFeedSettings, savePageConfig } from "@/lib/leaderboard";

/** One of this coach's clients, by membership, or the coach's own membership (their own program, H-29). */
async function programOf(coach: { workspace: { id: string }; membership: { id: string } }, membershipId: string) {
  if (membershipId === coach.membership.id) return db.query.memberships.findFirst({ where: eq(schema.memberships.id, membershipId) });
  return db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id), eq(schema.memberships.role, "client")) });
}

/**
 * Connect and check (rev 639): the coach pastes the client's eLoyalty key on their /coach row. It is sealed at once and only its
 * last four are ever shown; a blank key keeps the saved one. Then the check runs and says, in words, what it found.
 */
export async function saveLeaderboardAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const m = await programOf(coach, str(formData, "membershipId"));
  if (!m) return;
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
  const feed = await feedForMembership(m, m.businessName || u?.name || "leaderboard");
  const saved = await saveFeedSettings(feed, { key: str(formData, "key"), host: str(formData, "host"), templateId: str(formData, "templateId"), templateIdAlt: str(formData, "templateIdAlt") });
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

/** Remove key: the key and the held board go at once; the feed falls back to the pasted export, or answers 503. */
export async function removeLeaderboardKeyAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  await removeFeedKey(str(formData, "id"), coach.workspace.id);
  refresh();
}

/** The hide list, one eLoyalty customer id per line: the owner's and their coach's to set (H-33), never a team member's. */
export async function saveLeaderboardHiddenAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ team: "refuse" });
  await db.update(schema.leaderboardFeeds).set({ hidden: readHidden(str(formData, "hidden")), updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.membershipId, v.membership.id));
  refresh();
}

const own = async (membershipId: string) => db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, membershipId) });

/** The hosted page's settings (H-28): copy, the pass link, tiers, rewards and the sample marks. The owner's, their team's and their coach's (H-33). */
export async function saveLeaderboardPageAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ team: "allow" });
  const feed = await own(v.membership.id);
  if (!feed) return;
  const fields: Record<string, string> = {};
  for (const k of ["eyebrow", "headline", "headlineEm", "quote", "intro", "footer", "passUrl", "unit", "tiers", "rewards", "tiersSample", "rewardsSample", "showZero"]) fields[k] = str(formData, k);
  await savePageConfig(feed.id, v.workspace.id, pageConfigFromForm(fields));
  refresh();
}

/**
 * The pasted export (H-28): read on the server, now, and only "First L.", lifetime and available kept; the paste itself,
 * every email, phone and id in it, is gone when this returns. A blank paste clears the saved export.
 */
export async function saveLeaderboardExportAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ team: "allow" });
  const feed = await own(v.membership.id);
  if (!feed) return;
  const text = str(formData, "export").slice(0, 400_000);
  const asOf = str(formData, "asOf").slice(0, 40) || null;
  if (!text) {
    await saveExport(feed.id, v.workspace.id, null, null);
  } else {
    const { rows } = parseExport(text, feed.hidden);
    await saveExport(feed.id, v.workspace.id, rows, asOf);
  }
  refresh();
}
