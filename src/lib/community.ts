/**
 * The community connection's server side (handoff revs 150 to 154): the Monday post, the test post, and reading back what
 * happened to each. Every post goes through the Social Planner on the connection of the coach who set it up, from a team
 * user; nothing is ever posted in a member's name. A post is sent once: a row is claimed before the call, so two runs of the
 * hourly job, or a job and a click, can never send the same week twice. An account on hold stops everything, with no retry.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CommunityPost, CommunitySettings } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso, nowWallInTz, todayInTz } from "@/lib/dates";
import { connectionFor, createPost, getPost } from "@/lib/ghl";
import { logSync } from "@/lib/integrations";
import { redactSecrets } from "@/lib/engine/redact";
import { HOLD_REASON, TEST_TEXT, TEST_TITLE, communityDetails, fromPlanner, isAccountHold, mondayDue, mondayText, mondayTitle, postLink, shareTarget, shareText } from "@/lib/engine/community";

export const settingsFor = (workspaceId: string) => db.query.communitySettings.findFirst({ where: eq(schema.communitySettings.workspaceId, workspaceId) });

/** The coach's own zone: their membership's, else the workspace's. The Monday post goes out at their time of day. */
export async function coachTz(s: CommunitySettings): Promise<string> {
  const [m, ws] = await Promise.all([
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, s.coachUserId), eq(schema.memberships.workspaceId, s.workspaceId)) }),
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, s.workspaceId) }),
  ]);
  return m?.timezone || ws?.timezone || "UTC";
}

type Sent = { ok: true; ghlPostId: string | null } | { ok: false; error: string; hold: boolean };

/** One post to the community channel, from the team user. Says what went wrong in the coach's words, and whether it was a hold. */
async function send(s: CommunitySettings, title: string, body: string): Promise<Sent> {
  if (!s.channelAccountId) return { ok: false, error: "Pick the community channel first.", hold: false };
  const conn = await connectionFor(s.coachUserId);
  if (!conn) return { ok: false, error: "Connect GoHighLevel on Settings → Publishing first.", hold: false };
  const postAsId = s.postAsId?.trim() || conn.ghlUserId?.trim();
  if (!postAsId) return { ok: false, error: "Add the GoHighLevel user the posts come from (your GHL user ID on Settings → Publishing, or a team user here).", hold: false };
  const coach = await db.query.users.findFirst({ where: eq(schema.users.id, s.coachUserId) });
  const postAs = { id: postAsId, name: s.postAsName?.trim() || coach?.name || "HelixOS" };
  const r = await createPost(conn, { accountId: s.channelAccountId, summary: body, type: "post", scheduleDate: null, community: { details: communityDetails(s.channelAccountId, title, postAs), userId: postAsId } });
  if (r.ok) return { ok: true, ghlPostId: r.data.id };
  const fail = r as { error: string; status?: number; detail?: string };
  const hold = isAccountHold(fail);
  return { ok: false, error: hold ? HOLD_REASON : fail.error, hold };
}

/** A hold stops the workspace's posting until the coach presses Resume: nothing retries by itself. */
async function pauseForHold(s: CommunitySettings): Promise<void> {
  await db.update(schema.communitySettings).set({ pausedReason: HOLD_REASON, updatedAt: nowIso() }).where(eq(schema.communitySettings.id, s.id));
}

/** Sends a claimed row and records the outcome on it. */
async function sendRow(s: CommunitySettings, row: CommunityPost, title: string, body: string): Promise<CommunityPost> {
  const r = await send(s, title, body);
  const now = nowIso();
  if (r.ok) {
    await db.update(schema.communityPosts).set({ ghlPostId: r.ghlPostId, error: null, updatedAt: now }).where(eq(schema.communityPosts.id, row.id));
    await logSync({ workspaceId: s.workspaceId, userId: s.coachUserId, provider: "gohighlevel", direction: "out", event: `community.${row.kind}`, payload: { weekOf: row.weekOf, ghlPostId: r.ghlPostId ?? undefined }, status: "sent", note: `Sent to the community${r.ghlPostId ? ` · ${r.ghlPostId}` : ""}` });
  } else {
    if (r.hold) await pauseForHold(s);
    await db.update(schema.communityPosts).set({ status: "failed", error: r.error, updatedAt: now }).where(eq(schema.communityPosts.id, row.id));
    await logSync({ workspaceId: s.workspaceId, userId: s.coachUserId, provider: "gohighlevel", direction: "out", event: `community.${row.kind}`, payload: { weekOf: row.weekOf }, status: "failed", note: r.error });
  }
  return (await db.query.communityPosts.findFirst({ where: eq(schema.communityPosts.id, row.id) }))!;
}

/**
 * The week's Monday post, sent once. A row that doesn't exist yet is created; one that is "scheduled" (waiting, maybe with
 * this week's own text) is claimed by moving it to "sent" in the same statement that checks it, so only one caller wins.
 * `retry` lets the coach's Post now claim a failed week as well. Skipped, sent and posted weeks are never sent again.
 */
export async function postMonday(s: CommunitySettings, weekOf: string, opts: { retry?: boolean } = {}): Promise<{ ok: boolean; row?: CommunityPost; error?: string }> {
  if (s.pausedReason) return { ok: false, error: s.pausedReason };
  const title = mondayTitle(weekOf);
  await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: s.workspaceId, coachUserId: s.coachUserId, kind: "monday", weekOf, title, status: "scheduled" }).onConflictDoNothing();
  const claimable = opts.retry ? (["scheduled", "failed"] as const) : (["scheduled"] as const);
  const now = nowIso();
  const [claimed] = await db
    .update(schema.communityPosts)
    .set({ status: "sent", sentAt: now, error: null, accountId: s.channelAccountId, title, updatedAt: now })
    .where(and(eq(schema.communityPosts.workspaceId, s.workspaceId), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, weekOf), inArray(schema.communityPosts.status, [...claimable])))
    .returning();
  if (!claimed) return { ok: false, error: "That week's post has already gone out, or was skipped." };
  const body = claimed.body ?? mondayText(s.mondayText);
  await db.update(schema.communityPosts).set({ body }).where(eq(schema.communityPosts.id, claimed.id));
  const row = await sendRow(s, { ...claimed, body }, title, body);
  return { ok: row.status !== "failed", row, error: row.error ?? undefined };
}

/** The coach's test post, to their chosen (test) channel: the run that settles who posts, and how a post's link is built. */
export async function postTest(s: CommunitySettings): Promise<CommunityPost> {
  const now = nowIso();
  const id = newId();
  await db.insert(schema.communityPosts).values({ id, workspaceId: s.workspaceId, coachUserId: s.coachUserId, kind: "test", title: TEST_TITLE, body: TEST_TEXT, accountId: s.channelAccountId, status: "sent", sentAt: now });
  const row = (await db.query.communityPosts.findFirst({ where: eq(schema.communityPosts.id, id) }))!;
  if (s.pausedReason) {
    await db.update(schema.communityPosts).set({ status: "failed", error: s.pausedReason }).where(eq(schema.communityPosts.id, id));
    return (await db.query.communityPosts.findFirst({ where: eq(schema.communityPosts.id, id) }))!;
  }
  return sendRow(s, row, TEST_TITLE, TEST_TEXT);
}

/**
 * What the planner says happened to a sent post: published (with the community's own id, and a link when the coach's pattern
 * is set), failed with the reason, or still on its way. A post sent without an id that stays unknown for ten minutes is marked
 * failed with a sentence that sends the coach to look before pressing Post now, so nothing is ever doubled blind.
 */
export async function checkPost(s: CommunitySettings, row: CommunityPost): Promise<CommunityPost> {
  if (row.status !== "sent") return row;
  const now = nowIso();
  if (!row.ghlPostId) {
    const age = Date.now() - new Date(`${(row.sentAt ?? row.updatedAt).replace(" ", "T")}${(row.sentAt ?? row.updatedAt).includes("Z") ? "" : "Z"}`).getTime();
    if (age > 10 * 60000) await db.update(schema.communityPosts).set({ status: "failed", error: "GoHighLevel took the post but gave no id, so HelixOS can't see whether it went out. Look in the community before pressing Post now.", updatedAt: now }).where(eq(schema.communityPosts.id, row.id));
    return (await db.query.communityPosts.findFirst({ where: eq(schema.communityPosts.id, row.id) }))!;
  }
  const conn = await connectionFor(s.coachUserId);
  if (!conn) return row;
  const r = await getPost(conn, row.ghlPostId);
  if (!r.ok) {
    const fail = r as { error: string; status?: number; detail?: string };
    if (isAccountHold(fail)) await pauseForHold(s);
    return row;
  }
  const status = fromPlanner(r.data.status);
  const platformPostId = r.data.postId ?? row.platformPostId;
  await db
    .update(schema.communityPosts)
    .set({
      status,
      platformPostId,
      link: row.link ?? postLink(s.linkPattern, platformPostId),
      authorShown: r.data.author ?? row.authorShown,
      postedAt: status === "posted" ? (r.data.publishedAt ?? now) : row.postedAt,
      error: status === "failed" ? (r.data.error ? "The community didn't take the post. The reason is in GoHighLevel's Social Planner." : "The Social Planner marked it failed.") : null,
      updatedAt: now,
    })
    .where(eq(schema.communityPosts.id, row.id));
  return (await db.query.communityPosts.findFirst({ where: eq(schema.communityPosts.id, row.id) }))!;
}

/**
 * The hourly job's part: in each workspace whose Monday post is on, post the week's on Monday from the coach's time, once,
 * and read back every post still on its way. A workspace on hold is left alone until the coach presses Resume.
 */
export async function runCommunity(now: Date = new Date()): Promise<{ workspaceId: string; action: string; ok: boolean; note?: string }[]> {
  const out: { workspaceId: string; action: string; ok: boolean; note?: string }[] = [];
  const all = await db.query.communitySettings.findMany({ where: isNull(schema.communitySettings.pausedReason) });
  for (const s of all) {
    try {
      if (s.mondayOn && s.channelAccountId) {
        const tz = await coachTz(s);
        const today = todayInTz(tz, now);
        const time = nowWallInTz(tz, now).slice(11, 16);
        if (mondayDue(today, time, s.postTime)) {
          const week = await db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, s.workspaceId), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, today)) });
          if (!week || week.status === "scheduled") {
            const r = await postMonday(s, today);
            out.push({ workspaceId: s.workspaceId, action: "monday", ok: r.ok, note: r.error });
          }
        }
      }
      const waiting = await db.query.communityPosts.findMany({ where: and(eq(schema.communityPosts.workspaceId, s.workspaceId), eq(schema.communityPosts.status, "sent")), orderBy: [desc(schema.communityPosts.createdAt)], limit: 20 });
      const fresh = (await settingsFor(s.workspaceId)) ?? s;
      for (const row of waiting) await checkPost(fresh, row);
    } catch (e) {
      // The reason goes to the server log, redacted; the job's result says only that this workspace's run failed.
      console.error("[community] run failed", JSON.stringify({ workspaceId: s.workspaceId, detail: redactSecrets(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300) }));
      out.push({ workspaceId: s.workspaceId, action: "error", ok: false, note: "This workspace's community run failed; the reason is in the server log." });
    }
  }
  return out;
}

/**
 * "Share to the thread" for a member (piece 2): their 3-1-3 as a comment, where it goes (this week's Monday post, never an
 * older one), and whether they've already shared it this week.
 */
export async function shareFor(workspaceId: string, userId: string, week: { weekOf: string; word: string; keyResults: { text: string }[]; initiative: string; tasks: { title: string }[] }): Promise<{ text: string; weekOf: string; link: string | null; reason: string | null; shared: boolean }> {
  const [post, shared] = await Promise.all([
    db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, workspaceId), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, week.weekOf)) }),
    db.query.communityShares.findFirst({ where: and(eq(schema.communityShares.workspaceId, workspaceId), eq(schema.communityShares.userId, userId), eq(schema.communityShares.weekOf, week.weekOf)) }),
  ]);
  const target = shareTarget(post, week.weekOf);
  return { text: shareText(week), weekOf: week.weekOf, link: "link" in target ? target.link : null, reason: "reason" in target ? target.reason : null, shared: Boolean(shared) };
}
