"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso, nowWallInTz } from "@/lib/dates";
import { opt, str } from "@/lib/action-helpers";
import { connectionFor, refreshAccounts } from "@/lib/ghl";
import { checkPost, coachTz, postMonday, postTest, settingsFor } from "@/lib/community";
import { DEFAULT_MONDAY_TEXT, TEXT_MAX, mondayTitle, normalTime, upcomingWeek, validLink, validPattern } from "@/lib/engine/community";

/** Back to the community page, with a note or an error, at the part of the page it is about. */
function back(anchor: string, note: { saved?: string; error?: string } = {}): never {
  const q = note.error ? `?error=${encodeURIComponent(note.error)}` : note.saved ? `?saved=${encodeURIComponent(note.saved)}` : "";
  redirect(`/coach/community${q}#${anchor}`);
}

/** One channel's link pattern set (or cleared when empty), the other channels' kept. */
function withPattern(patterns: Record<string, string>, channel: string, pattern: string): Record<string, string> {
  const next = { ...patterns };
  if (pattern) next[channel] = pattern;
  else delete next[channel];
  return next;
}

/** The workspace's settings, made on first use with this coach as the one whose GoHighLevel connection posts. */
async function settingsOrNew(workspaceId: string, coachUserId: string) {
  const s = await settingsFor(workspaceId);
  if (s) return s;
  await db.insert(schema.communitySettings).values({ id: newId(), workspaceId, coachUserId }).onConflictDoNothing();
  return (await settingsFor(workspaceId))!;
}

/**
 * The setup: the channel (one of the accounts the coach's own connection lists, never typed), the Monday post on or off, the
 * time, the text, who it is from, and how a post's id becomes a link. Saving makes the saving coach the one whose connection posts.
 */
export async function saveCommunitySettingsAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const conn = await connectionFor(v.user.id);
  const s = await settingsOrNew(v.workspace.id, v.user.id);
  const channel = str(formData, "channel");
  const account = conn?.accounts.find((a) => a.id === channel);
  if (channel && !account) back("setup", { error: "Pick the channel from the list. If it isn't there, press Check again." });
  const time = normalTime(str(formData, "postTime") || "08:00");
  if (!time) back("setup", { error: "Write the time as hours and minutes, like 08:00." });
  const text = str(formData, "mondayText").trim();
  if (text.length > TEXT_MAX) back("setup", { error: "The Monday text is longer than the community allows." });
  const pattern = str(formData, "linkPattern").trim();
  if (pattern && !validPattern(pattern)) back("setup", { error: "The link pattern is a full https address with {postId} where the post's id goes." });
  const on = formData.get("mondayOn") === "on";
  if (on && !channel) back("setup", { error: "Pick the channel before turning the Monday post on." });
  await db
    .update(schema.communitySettings)
    .set({
      coachUserId: v.user.id,
      channelAccountId: channel || null,
      channelName: account?.name ?? null,
      mondayOn: on,
      postTime: time!,
      // The default text is kept as "not customised", so a later change to the default reaches a coach who never edited it.
      mondayText: text && text !== DEFAULT_MONDAY_TEXT ? text : null,
      postAsId: opt(formData, "postAsId"),
      postAsName: opt(formData, "postAsName"),
      // The pattern is the chosen channel's own (each channel's address has its own slug); the other channels' are kept.
      linkPatterns: channel ? withPattern(s.linkPatterns, channel, pattern) : s.linkPatterns,
      linkPattern: null,
      updatedAt: nowIso(),
    })
    .where(and(eq(schema.communitySettings.id, s.id), eq(schema.communitySettings.workspaceId, v.workspace.id)));
  back("setup", { saved: "Saved." });
}

/** Reads the coach's connected accounts again, so a community channel connected in GoHighLevel shows up in the list. */
export async function refreshCommunityChannelsAction(): Promise<void> {
  const v = await requireCoach();
  const conn = await connectionFor(v.user.id);
  if (!conn) back("setup", { error: "Connect GoHighLevel on Settings → Publishing first." });
  const r = await refreshAccounts(conn!);
  back("setup", r.ok ? { saved: `Found ${r.data.length} connected accounts.` } : { error: r.error });
}

/** One test post to the chosen channel, with the result on screen: the settling run for who posts and what a link looks like. */
export async function sendCommunityTestAction(): Promise<void> {
  const v = await requireCoach();
  const s = await settingsFor(v.workspace.id);
  if (!s?.channelAccountId) back("setup", { error: "Pick the channel and save before sending a test post." });
  const row = await postTest(s!);
  back("test", row.status === "failed" ? { error: row.error ?? "The test post didn't go out." } : { saved: "Test post sent. Press Check again in a minute to see it published." });
}

/** Reads one sent post back from the planner. */
export async function checkCommunityPostAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const s = await settingsFor(v.workspace.id);
  const row = await db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.id, str(formData, "postId")), eq(schema.communityPosts.workspaceId, v.workspace.id)) });
  if (!s || !row) back("log");
  const after = await checkPost(s!, row!);
  back(row!.kind === "test" ? "test" : "log", { saved: after.status === "posted" ? "Published." : after.status === "failed" ? undefined : "Still on its way." , error: after.status === "failed" ? (after.error ?? "It failed.") : undefined });
}

/** Next Monday's post before it goes out: its own text for that week, or skipped. Only a week that hasn't been sent can change. */
export async function saveNextMondayAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const s = await settingsOrNew(v.workspace.id, v.user.id);
  const tz = await coachTz(s);
  const week = upcomingWeek(v.today, nowWallInTz(tz).slice(11, 16), s.postTime);
  if (str(formData, "weekOf") !== week) back("next", { error: "That week has changed since the page loaded. Look again." });
  const intent = str(formData, "intent");
  const text = str(formData, "body").trim();
  if (text.length > TEXT_MAX) back("next", { error: "The text is longer than the community allows." });
  await db.insert(schema.communityPosts).values({ id: newId(), workspaceId: v.workspace.id, coachUserId: s.coachUserId, kind: "monday", weekOf: week, title: mondayTitle(week), status: "scheduled" }).onConflictDoNothing();
  const row = await db.query.communityPosts.findFirst({ where: and(eq(schema.communityPosts.workspaceId, v.workspace.id), eq(schema.communityPosts.kind, "monday"), eq(schema.communityPosts.weekOf, week)) });
  if (!row || !["scheduled", "skipped"].includes(row.status)) back("next", { error: "That week's post has already gone out." });
  const set =
    intent === "skip"
      ? { status: "skipped" as const }
      : intent === "unskip"
        ? { status: "scheduled" as const }
        : { body: text && text !== (s.mondayText ?? DEFAULT_MONDAY_TEXT) ? text : null };
  await db.update(schema.communityPosts).set({ ...set, updatedAt: nowIso() }).where(and(eq(schema.communityPosts.id, row!.id), eq(schema.communityPosts.workspaceId, v.workspace.id)));
  back("next", { saved: intent === "skip" ? "Skipped. Nothing goes out that Monday." : intent === "unskip" ? "Back on for that Monday." : "Saved for that Monday." });
}

/** Post now: a week whose post failed, or this week's when Monday passed without one. Never a week already sent or posted. */
export async function postCommunityNowAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const s = await settingsFor(v.workspace.id);
  if (!s?.channelAccountId) back("log", { error: "Pick the channel first." });
  const weekOf = str(formData, "weekOf");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOf) || weekOf > v.today) back("log", { error: "Only a week that has started can be posted now." });
  const r = await postMonday(s!, weekOf, { retry: true });
  back("log", r.ok ? { saved: `${mondayTitle(weekOf)} sent.` } : { error: r.error ?? "It didn't go out." });
}

/** The link to one post, pasted by the coach when there's no pattern yet (or it's different). */
export async function setCommunityLinkAction(formData: FormData): Promise<void> {
  const v = await requireCoach();
  const link = str(formData, "link").trim();
  if (link && !validLink(link)) back("log", { error: "Paste the post's full https link." });
  await db.update(schema.communityPosts).set({ link: link || null, updatedAt: nowIso() }).where(and(eq(schema.communityPosts.id, str(formData, "postId")), eq(schema.communityPosts.workspaceId, v.workspace.id)));
  back("log", { saved: "Link saved." });
}

/** After a hold is sorted out in GoHighLevel: posting may resume. Nothing missed is sent by this; Post now does that. */
export async function resumeCommunityAction(): Promise<void> {
  const v = await requireCoach();
  await db.update(schema.communitySettings).set({ pausedReason: null, updatedAt: nowIso() }).where(eq(schema.communitySettings.workspaceId, v.workspace.id));
  back("setup", { saved: "Resumed." });
}
