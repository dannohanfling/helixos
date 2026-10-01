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
import { connectionFor, createPost, getPost, listPostsIn } from "@/lib/ghl";
import { logSync } from "@/lib/integrations";
import { readProofObject } from "@/lib/proof-storage";
import { putPublicMagnet } from "@/lib/storage";
import { redactSecrets } from "@/lib/engine/redact";
import { HOLD_REASON, TEST_TITLE, UNKNOWN_REASON, communityDetails, communityHtml, mondayTestText, failedReason, fromPlanner, isAccountHold, mondayDue, mondayText, mondayTitle, monthDue, monthShareTarget, monthShareText, monthTestText, monthText, monthTitle, patternFor, pickPlannerPost, postLink, shareTarget, shareText, testText } from "@/lib/engine/community";

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

/**
 * The post's graphic (rev 328: every monthly post ends with a 540 by 540 image), from the coach's Images library. The library
 * is the private store, which the Social Planner can't read, so the picked image is copied once to the public store under a
 * community/ key when the post is sent, and that URL goes in the planner's media field; the row keeps the key and URL. A copy
 * that fails (the store not set, the image gone) never stops the post: it goes without the graphic, and the row says so.
 */
async function graphicFor(s: CommunitySettings, row: CommunityPost): Promise<{ media: { url: string; type: string }[]; note: string | null }> {
  if (!row.imageId) return { media: [], note: null };
  if (row.imageUrl) return { media: [{ url: row.imageUrl, type: "image/png" }], note: null };
  const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, row.imageId), eq(schema.deckImages.workspaceId, s.workspaceId)) });
  if (!img) return { media: [], note: "The graphic picked for this post is no longer in the Images library, so it went without one." };
  try {
    const res = await readProofObject(img.blobUrl);
    if (!res.ok) throw new Error(`read ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const ext = img.mime === "image/jpeg" ? "jpg" : img.mime === "image/webp" ? "webp" : img.mime === "image/gif" ? "gif" : "png";
    const period = row.monthOf ?? row.weekOf ?? "test";
    const stored = await putPublicMagnet(s.workspaceId, "community", `${row.kind}-${period}.${ext}`, bytes, img.mime);
    if (!stored.url) throw new Error("no url");
    await db.update(schema.communityPosts).set({ imageKey: stored.key, imageUrl: stored.url, updatedAt: nowIso() }).where(eq(schema.communityPosts.id, row.id));
    return { media: [{ url: stored.url, type: img.mime }], note: null };
  } catch (e) {
    console.error("[community] graphic copy failed", JSON.stringify({ postId: row.id, detail: redactSecrets(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200) }));
    return { media: [], note: "The graphic couldn't be copied for the planner (is the file store set up?), so the post went without it." };
  }
}

/** One post to the community channel, from the team user. Says what went wrong in the coach's words, and whether it was a hold. */
async function send(s: CommunitySettings, title: string, body: string, notify: boolean, mentionEveryone: boolean, media: { url: string; type: string }[] = []): Promise<Sent> {
  if (!s.channelAccountId) return { ok: false, error: "Pick the community channel first.", hold: false };
  const conn = await connectionFor(s.coachUserId);
  if (!conn) return { ok: false, error: "Connect GoHighLevel on Settings → Publishing first.", hold: false };
  // Posted as (28 Sep, live): the community member contact id of a team member's own community profile. A GoHighLevel staff
  // user id never works there ("You are not part of this group"), so there is no fallback to the one on Publishing.
  const postAsId = s.postAsId?.trim();
  if (!postAsId) return { ok: false, error: "Add \"Posted as\": the community member contact ID of your own community profile.", hold: false };
  const coach = await db.query.users.findFirst({ where: eq(schema.users.id, s.coachUserId) });
  const postAs = { id: postAsId, name: s.postAsName?.trim() || coach?.name || "HelixOS" };
  // The community shows HTML (rev 169): the plain text the coach wrote goes out with its paragraphs and line breaks kept.
  const r = await createPost(conn, { accountId: s.channelAccountId, summary: communityHtml(body, { mentionEveryone }), type: "post", scheduleDate: null, media, community: { details: communityDetails(s.channelAccountId, title, postAs, notify), userId: postAsId } });
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
  // Only a real post (Monday's or the month's) ever notifies, and only as the row says (set when it was claimed): a test never does.
  // @everyone as a real mention on the real posts only (rev 203); a test keeps it as words. Independent of the notify flag.
  const real = row.kind !== "test";
  const graphic = await graphicFor(s, row);
  const r = await send(s, title, body, real && row.notifyAll, real, graphic.media);
  const now = nowIso();
  if (graphic.note) await db.update(schema.communityPosts).set({ checkNote: graphic.note, updatedAt: now }).where(eq(schema.communityPosts.id, row.id));
  const period = row.kind === "month" ? { monthOf: row.monthOf ?? undefined } : { weekOf: row.weekOf ?? undefined };
  if (r.ok) {
    await db.update(schema.communityPosts).set({ ghlPostId: r.ghlPostId, error: null, updatedAt: now }).where(eq(schema.communityPosts.id, row.id));
    await logSync({ workspaceId: s.workspaceId, userId: s.coachUserId, provider: "gohighlevel", direction: "out", event: `community.${row.kind}`, payload: { ...period, ghlPostId: r.ghlPostId ?? undefined }, status: "sent", note: `Sent to the community${r.ghlPostId ? ` · ${r.ghlPostId}` : ""}` });
  } else {
    if (r.hold) await pauseForHold(s);
    await db.update(schema.communityPosts).set({ status: "failed", error: r.error, updatedAt: now }).where(eq(schema.communityPosts.id, row.id));
    await logSync({ workspaceId: s.workspaceId, userId: s.coachUserId, provider: "gohighlevel", direction: "out", event: `community.${row.kind}`, payload: period, status: "failed", note: r.error });
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
    .set({ status: "sent", sentAt: now, error: null, accountId: s.channelAccountId, title, notifyAll: s.mondayNotify, imageId: s.mondayImageId, updatedAt: now })
    .where(and(eq(schema.communityPosts.workspaceId, s.workspaceId), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, weekOf), inArray(schema.communityPosts.status, [...claimable])))
    .returning();
  if (!claimed) return { ok: false, error: "That week's post has already gone out, or was skipped." };
  const body = claimed.body ?? mondayText(s.mondayText);
  await db.update(schema.communityPosts).set({ body }).where(eq(schema.communityPosts.id, claimed.id));
  const row = await sendRow(s, { ...claimed, body }, title, body);
  return { ok: row.status !== "failed", row, error: row.error ?? undefined };
}

/**
 * The month's post (1 Oct), sent once on the 1st: the same claim as the Monday post's, keyed by the month, with the coach's
 * month text, notify and @everyone as the Monday post has them. `retry` lets Post now claim a failed month as well.
 */
export async function postMonth(s: CommunitySettings, monthOf: string, opts: { retry?: boolean } = {}): Promise<{ ok: boolean; row?: CommunityPost; error?: string }> {
  if (s.pausedReason) return { ok: false, error: s.pausedReason };
  const title = monthTitle(monthOf);
  await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: s.workspaceId, coachUserId: s.coachUserId, kind: "month", monthOf, title, status: "scheduled" }).onConflictDoNothing();
  const claimable = opts.retry ? (["scheduled", "failed"] as const) : (["scheduled"] as const);
  const now = nowIso();
  const [claimed] = await db
    .update(schema.communityPosts)
    .set({ status: "sent", sentAt: now, error: null, accountId: s.channelAccountId, title, notifyAll: s.monthNotify, imageId: s.monthImageId, updatedAt: now })
    .where(and(eq(schema.communityPosts.workspaceId, s.workspaceId), eq(schema.communityPosts.kind, "month"), eq(schema.communityPosts.monthOf, monthOf), inArray(schema.communityPosts.status, [...claimable])))
    .returning();
  if (!claimed) return { ok: false, error: "That month's post has already gone out, or was skipped." };
  const body = claimed.body ?? monthText(s.monthText);
  await db.update(schema.communityPosts).set({ body }).where(eq(schema.communityPosts.id, claimed.id));
  const row = await sendRow(s, { ...claimed, body }, title, body);
  return { ok: row.status !== "failed", row, error: row.error ?? undefined };
}

/**
 * The coach's test post, to their chosen (test) channel: the run that settles who posts, and how a post's link is built. With
 * `mondayTitle`, it is the Monday text itself under that week's title (rev 169), to see its layout before the Monday post is
 * on; with `monthTitle`, the month text the same way. A test never notifies anyone, whatever the real posts' settings.
 */
export async function postTest(s: CommunitySettings, opts: { mondayTitle?: string; monthTitle?: string } = {}): Promise<CommunityPost> {
  const now = nowIso();
  const id = newId();
  const title = opts.mondayTitle ? `Test: ${opts.mondayTitle}` : opts.monthTitle ? `Test: ${opts.monthTitle}` : TEST_TITLE;
  const text = opts.mondayTitle ? mondayTestText(mondayText(s.mondayText), now) : opts.monthTitle ? monthTestText(monthText(s.monthText), now) : testText(now);
  // A Monday or month text test carries that post's graphic too, so the coach sees the whole post as it will go out.
  const imageId = opts.mondayTitle ? s.mondayImageId : opts.monthTitle ? s.monthImageId : null;
  await db.insert(schema.communityPosts).values({ id, workspaceId: s.workspaceId, coachUserId: s.coachUserId, kind: "test", title, body: text, accountId: s.channelAccountId, status: "sent", sentAt: now, notifyAll: false, imageId });
  const row = (await db.query.communityPosts.findFirst({ where: eq(schema.communityPosts.id, id) }))!;
  if (s.pausedReason) {
    await db.update(schema.communityPosts).set({ status: "failed", error: s.pausedReason }).where(eq(schema.communityPosts.id, id));
    return (await db.query.communityPosts.findFirst({ where: eq(schema.communityPosts.id, id) }))!;
  }
  return sendRow(s, row, title, text);
}

/**
 * What the planner says happened to a sent post (fixed 28 Sep, after the first live tests): published (with the community's
 * own post id and the link from that channel's pattern), failed with GoHighLevel's own words (and Post now offered again), or
 * still on its way. When the create reply carried no id, the post is found in the planner's list for that channel (same text,
 * sent nearest in time); one still not found ten minutes on is "unknown", never failed, until the coach says whether it went out.
 */
export async function checkPost(s: CommunitySettings, row: CommunityPost): Promise<CommunityPost> {
  // An "unknown" post keeps being looked for: a later read may still find it.
  if (row.status !== "sent" && row.status !== "unknown") return row;
  const now = nowIso();
  // Every write is to a post still waiting: a coach's own answer (It's live, a pasted link) made meanwhile is never undone.
  const waiting = and(eq(schema.communityPosts.id, row.id), inArray(schema.communityPosts.status, ["sent", "unknown"]));
  const reread = async () => (await db.query.communityPosts.findFirst({ where: eq(schema.communityPosts.id, row.id) }))!;
  const conn = await connectionFor(s.coachUserId);
  if (!conn) return row;
  let ghlPostId = row.ghlPostId;
  const sentAt = row.sentAt ?? `${row.updatedAt.replace(" ", "T")}Z`;
  if (!ghlPostId && row.accountId && row.body) {
    const from = new Date(new Date(sentAt).getTime() - 10 * 60000).toISOString();
    const to = new Date(Date.now() + 86400000).toISOString();
    const list = await listPostsIn(conn, { accountId: row.accountId, fromIso: from, toIso: to, limit: 100 });
    const hit = list.ok ? pickPlannerPost(list.data.posts, { accountId: row.accountId, summary: row.body, sentAtIso: sentAt }) : null;
    if (hit) {
      ghlPostId = hit.id;
      await db.update(schema.communityPosts).set({ ghlPostId, updatedAt: now }).where(waiting);
    }
  }
  if (!ghlPostId) {
    // Never Failed on a missing id alone (28 Sep: a post live in the community read "failed", and Post now would have posted it
    // twice). Ten minutes on it is "unknown": the coach looks in the community, and says whether it went out.
    const late = Date.now() - new Date(sentAt).getTime() > 10 * 60000;
    await db
      .update(schema.communityPosts)
      .set({ checkNote: "GoHighLevel gave no id for this post, and it isn't in the planner's list for this channel yet.", ...(late ? { status: "unknown" as const, error: UNKNOWN_REASON } : {}), updatedAt: now })
      .where(waiting);
    return reread();
  }
  const r = await getPost(conn, ghlPostId);
  if (!r.ok) {
    const fail = r as { error: string; status?: number; detail?: string };
    if (isAccountHold(fail)) await pauseForHold(s);
    await db.update(schema.communityPosts).set({ checkNote: `Reading it back failed: ${fail.error}`, updatedAt: now }).where(waiting);
    return reread();
  }
  const status = fromPlanner(r.data.status);
  const checkNote = `The planner says: ${r.data.status}${r.data.postId ? `, community post ${r.data.postId}` : ""}.`;
  const platformPostId = r.data.postId ?? row.platformPostId;
  const pattern = patternFor(s.linkPatterns, { pattern: s.linkPattern, channel: s.channelAccountId }, row.accountId);
  await db
    .update(schema.communityPosts)
    .set({
      status,
      platformPostId,
      link: row.link ?? postLink(pattern, platformPostId),
      authorShown: r.data.author ?? row.authorShown,
      postedAt: status === "posted" ? (r.data.publishedAt ?? now) : row.postedAt,
      // The coach sees GoHighLevel's own reason (this page is theirs), with anything token-shaped taken out.
      error: status === "failed" ? failedReason(redactSecrets(r.data.error ?? "")) : null,
      checkNote,
      updatedAt: now,
    })
    .where(waiting);
  return reread();
}

/**
 * The hourly job's part: in each workspace whose Monday post is on, post the week's on Monday from the coach's time, once;
 * whose month post is on, post the month's on the 1st from its own time, once; and read back every post still on its way.
 * A workspace on hold is left alone until the coach presses Resume.
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
      if (s.monthOn && s.channelAccountId) {
        const tz = await coachTz(s);
        const today = todayInTz(tz, now);
        const time = nowWallInTz(tz, now).slice(11, 16);
        if (monthDue(today, time, s.monthTime)) {
          const monthOf = today.slice(0, 7);
          const month = await db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, s.workspaceId), eq(schema.communityPosts.kind, "month"), eq(schema.communityPosts.monthOf, monthOf)) });
          if (!month || month.status === "scheduled") {
            const r = await postMonth(s, monthOf);
            out.push({ workspaceId: s.workspaceId, action: "month", ok: r.ok, note: r.error });
          }
        }
      }
      const waiting = await db.query.communityPosts.findMany({ where: and(eq(schema.communityPosts.workspaceId, s.workspaceId), inArray(schema.communityPosts.status, ["sent", "unknown"])), orderBy: [desc(schema.communityPosts.createdAt)], limit: 20 });
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

/**
 * This week's thread, for anyone to open (rev 175): the Monday post's link once it is published, before or after the member's
 * week is set. Nothing (never a broken link) until the post is published with a link.
 */
export async function threadLinkFor(workspaceId: string, weekOf: string): Promise<string | null> {
  const post = await db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, workspaceId), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, weekOf)) });
  return post?.status === "posted" && post.link ? post.link : null;
}

/**
 * "Share to the thread" for the month (1 Oct): the member's eleven answers as a comment, where it goes (this month's post,
 * never an older one), and whether they've already shared it this month.
 */
export async function monthShareFor(workspaceId: string, userId: string, m: Parameters<typeof monthShareText>[0] & { month: string }): Promise<{ text: string; monthOf: string; link: string | null; reason: string | null; shared: boolean }> {
  const [post, shared] = await Promise.all([
    db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, workspaceId), eq(schema.communityPosts.kind, "month"), eq(schema.communityPosts.monthOf, m.month)) }),
    db.query.communityShares.findFirst({ where: and(eq(schema.communityShares.workspaceId, workspaceId), eq(schema.communityShares.userId, userId), eq(schema.communityShares.monthOf, m.month)) }),
  ]);
  const target = monthShareTarget(post, m.month);
  return { text: monthShareText(m), monthOf: m.month, link: "link" in target ? target.link : null, reason: "reason" in target ? target.reason : null, shared: Boolean(shared) };
}

/** This month's thread, for anyone to open: the month post's link once it is published. Nothing (never a broken link) until then. */
export async function monthThreadLinkFor(workspaceId: string, monthOf: string): Promise<string | null> {
  const post = await db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, workspaceId), eq(schema.communityPosts.kind, "month"), eq(schema.communityPosts.monthOf, monthOf)) });
  return post?.status === "posted" && post.link ? post.link : null;
}
