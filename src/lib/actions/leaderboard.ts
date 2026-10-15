"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { pageConfigFromForm, parseExport, readHidden } from "@/lib/engine/leaderboard";
import { checkFeed, feedForMembership, removeFeedKey, saveExport, saveFeedSettings, savePageConfig, setFeedSlug } from "@/lib/leaderboard";
import { parseClExport } from "@/lib/engine/points-check";
import { clearPointsCheck, runPointsCheck } from "@/lib/points-check";

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

/**
 * The page address (H-109): the owner's, their team's and their coach's to set. A problem (shape, a reserved word, an address
 * another board has or had) sends them back to /loyalty with the reason beside the field; the old address keeps redirecting.
 */
export async function saveLeaderboardSlugAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ team: "allow" });
  const feed = await own(v.membership.id);
  if (!feed) return;
  const problem = await setFeedSlug(feed, str(formData, "slug"));
  if (problem) redirect(`/loyalty?slugError=${encodeURIComponent(problem)}#address`);
  refresh();
  redirect("/loyalty?slug=changed#address");
}

const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

/**
 * The points check (H-102, H-112): the coach uploads the client's Community Loyalty bot-user export once; it is read here,
 * in memory, to its pass fields, compared with eLoyalty (GET only), and thrown away. One sealed snapshot of "First L." and
 * numbers stays on the row. A problem comes back in words beside the form. Never a write to either system.
 */
export async function runPointsCheckAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const feed = await db.query.leaderboardFeeds.findFirst({ where: and(eq(schema.leaderboardFeeds.id, str(formData, "id")), eq(schema.leaderboardFeeds.workspaceId, coach.workspace.id)) });
  if (!feed) return;
  const back = (error?: string) => `/coach?connections=open${error ? `&pointsCheckError=${encodeURIComponent(error)}` : ""}#leaderboard-${feed.id}`;
  const file = formData.get("export");
  if (!(file instanceof File) || file.size === 0) redirect(back("Choose the export file first."));
  if (file.size > MAX_EXPORT_BYTES) redirect(back("That file is over 5MB."));
  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".txt") && !name.endsWith(".tsv")) redirect(back("Use the CSV export."));
  const text = Buffer.from(await file.arrayBuffer()).toString("utf8");
  const parsed = parseClExport(text);
  if (!parsed.columns.customerId && !parsed.columns.serial) redirect(back("That export has no Loyalty Customer ID or pass serial column; pin them in Community Loyalty and export again."));
  const r = await runPointsCheck(feed, parsed.records, { columns: parsed.columns, clRows: parsed.rows });
  if (!r.ok) redirect(back(r.error));
  refresh();
  redirect(back());
}

/** Clear the stored snapshot. */
export async function clearPointsCheckAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  await clearPointsCheck(str(formData, "id"), coach.workspace.id);
  refresh();
}
