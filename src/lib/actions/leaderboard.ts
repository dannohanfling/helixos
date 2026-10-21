"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { nowIso } from "@/lib/dates";
import { pageConfigFromForm, parseExport, readHidden } from "@/lib/engine/leaderboard";
import { checkFeed, feedForMembership, removeFeedKey, saveExport, saveFeedSettings, savePageConfig, setFeedSlug } from "@/lib/leaderboard";
import { clearPointsCheck, readExportUpload, runPointsCheck } from "@/lib/points-check";
import { open } from "@/lib/crypto";
import { type BoardRow } from "@/lib/engine/leaderboard";
import { customerForRef, deskAccess, deskRefusal } from "@/lib/engine/points-outbox";
import { drainFeed, liveBalance, queueMove, runDeskCheck } from "@/lib/points-outbox";

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
  const upload = await readExportUpload(formData.get("export"));
  if (!upload.ok) redirect(back(upload.error));
  const parsed = upload.parsed;
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

// ---------------------------------------------------------------------------------------------------------------------------
// The Points desk (H-493): moving Kindness Koins on a member's pass, for two people only, through the outbox.

const heldRows = (feed: schema.LeaderboardFeed): BoardRow[] => {
  try {
    return feed.cacheJson ? (JSON.parse(feed.cacheJson) as BoardRow[]) : [];
  } catch {
    return [];
  }
};

/**
 * One move from the desk on /loyalty: add or deduct, by the member's customer id, with a reason. Only the coach working in
 * the client's HelixOS, or a team member the coach named for it, gets past the first lines; the desk opens only after the
 * add-and-deduct check passed. A deduct is read against eLoyalty's live balance first and never goes below 0. The form's
 * one-time id makes a second press of the same form the same move, never a second one.
 */
export async function pointsDeskMoveAction(formData: FormData): Promise<void> {
  const { v } = await ctx({ team: "allow", whileSwitched: "log" });
  const back = (q: string): never => redirect(`/loyalty?${q}#desk`);
  const fail = (why: string): never => back(`deskError=${encodeURIComponent(why)}`);
  const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, v.membership.id) });
  if (!feed) return fail("No loyalty program is set up here.");
  const access = deskAccess({ switchedMode: v.switchedInto?.mode ?? null, teamUserId: v.team ? v.actor.id : null }, feed.deskUserIds);
  if (!access.ok) return fail(access.why);
  if (!feed.deskCheckOk) return fail("The desk opens once the add-and-deduct check has passed on your coach's page.");
  const customerId = customerForRef(feed.id, str(formData, "member"), heldRows(feed).map((r) => r.id));
  if (!customerId) return fail("Choose a member from the list.");
  const nonce = str(formData, "nonce");
  if (!/^[0-9a-z-]{8,64}$/i.test(nonce)) return fail("The form was out of date. Open the desk again and try once more.");
  const direction = str(formData, "direction");
  const amount = Number(str(formData, "amount"));
  const reason = str(formData, "reason");
  const key = open(feed.keyEncrypted);
  if (!key) return fail("No eLoyalty key is saved for this program.");
  const available = direction === "deduct" ? ((await liveBalance(feed, key, customerId))?.balance ?? null) : null;
  const refusal = deskRefusal({ direction, amount, reason, available });
  if (refusal) return fail(refusal);
  const move = await queueMove(feed, { customerId, delta: direction === "add" ? amount : -amount, reason, source: `desk:${nonce}`, byUserId: v.actor.id });
  if (move.status === "pending") await drainFeed(feed, new Date(), move.id);
  refresh();
  return back(`move=${encodeURIComponent(move.id)}`);
}

/** The coach's one feed in their own workspace (the caller has already refused a switched session). */
async function feedOfCoach(coach: { workspace: { id: string } }, formData: FormData) {
  return db.query.leaderboardFeeds.findFirst({ where: and(eq(schema.leaderboardFeeds.id, str(formData, "id")), eq(schema.leaderboardFeeds.workspaceId, coach.workspace.id)) });
}

/** Who on the client's team may use the desk (H-429: the community manager). Only live team members of that client count. */
export async function saveDeskAccessAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const feed = await feedOfCoach(coach, formData);
  if (!feed) return;
  const ticked = new Set(formData.getAll("deskUser").map(String));
  const team = await db.query.teamMembers.findMany({ where: and(eq(schema.teamMembers.ownerMembershipId, feed.membershipId), isNull(schema.teamMembers.removedAt)) });
  const deskUserIds = [...new Set(team.map((t) => t.teamUserId).filter((id) => ticked.has(id)))];
  await db.update(schema.leaderboardFeeds).set({ deskUserIds, updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feed.id));
  refresh();
}

/** The coach's pause: while on, every move waits in the outbox and nothing is sent. */
export async function setMovesPausedAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const feed = await feedOfCoach(coach, formData);
  if (!feed) return;
  await db.update(schema.leaderboardFeeds).set({ movesPaused: str(formData, "paused") === "on", updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feed.id));
  refresh();
}

/** The one add-and-deduct check on a team test pass (H-493 step 4): 1 deducted, 1 added back, both read back. */
export async function runDeskCheckAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const feed = await feedOfCoach(coach, formData);
  if (!feed) return;
  // "own" is the coach's own pass, offered only on the coach's own program (H-734 step E).
  const ownFeed = feed.membershipId === coach.membership.id;
  const me = ownFeed ? await db.query.memberships.findFirst({ where: eq(schema.memberships.id, coach.membership.id), columns: { eoCustomerId: true } }) : null;
  const ownCustomerId = me?.eoCustomerId ?? null;
  const customerId = str(formData, "member") === "own" ? ownCustomerId : customerForRef(feed.id, str(formData, "member"), heldRows(feed).map((r) => r.id));
  await runDeskCheck(feed, customerId ?? "", coach.actor.id, new Date(), { ownCustomerId });
  refresh();
  redirect(`/coach?connections=open#leaderboard-${feed.id}`);
}

/**
 * "Issue passes" on the coach's own program (H-622): lets clients press "Get my pass" on Rewards. Only on the coach's own
 * feed, and it turns on only when the program is connected, checked and has its template.
 */
export async function setIssuePassesAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  if (coach.switchedInto) return;
  const feed = await feedOfCoach(coach, formData);
  if (!feed || feed.membershipId !== coach.membership.id) return;
  const on = str(formData, "issuePasses") === "on";
  if (on && !(feed.keyEncrypted && feed.templateId && feed.lastCheckOk)) return;
  await db.update(schema.leaderboardFeeds).set({ issuePasses: on, updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feed.id));
  refresh();
}
