/**
 * The coach's community connection (handoff revs 150 to 154): HelixOS posts into the coach's GoHighLevel community through the
 * Social Planner, from the team account. Pure: dates are "YYYY-MM-DD" in the coach's own time zone, times "HH:MM".
 */
import { addDays, startOfWeek, weekday } from "@/lib/dates";

/** Danno's current Monday post, word for word: the default until the coach edits it. */
export const DEFAULT_MONDAY_TEXT =
  "It's important to set our intention. Choose ONE word that you will decide to embody this week. Next we are planning our 3-1-3 goals. It looks like the following: What are THREE trackable key results I'd like to achieve this week. What is ONE initiative I can work on to work toward my bigger objective/goal. What are THREE tasks that I need to accomplish this week to move the needle forward. When we create bite-sized goal-planning activities, we are much more likely to achieve them and connect them to our greater picture. Declare your goals here and let's keep each other accountable. Share below @everyone so we can check in with you and keep your momentum going strong.";
export const DEFAULT_POST_TIME = "08:00";
/** The Social Planner's community limits (the live Create post page, read 28 Sep): a title up to 1,000, a caption up to 100,000. */
export const TITLE_MAX = 1000;
export const TEXT_MAX = 100000;
export const TEST_TITLE = "HelixOS test, please ignore";
/** The test post's text, with its send time, so each test is its own post in the planner's list (28 Sep: several tests a minute apart). */
export const testText = (sentAtIso: string): string => `A test from HelixOS, to check the connection (sent ${sentAtIso.slice(0, 16).replace("T", " ")} UTC). Please ignore it; it will be deleted.`;

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** "Set Your Intentions 9/28-10/4": the week's Monday to its Sunday. */
export const mondayTitle = (weekOf: string): string => `Set Your Intentions ${md(weekOf)}-${md(addDays(weekOf, 6))}`;

/** The next Monday post's week: this week's while Monday's post time hasn't passed, else next week's. */
export function upcomingWeek(today: string, nowTime: string, postTime: string): string {
  const monday = startOfWeek(today);
  return today === monday && nowTime < postTime ? monday : addDays(monday, 7);
}

/** "8:05" or "08:05" to "08:05"; null when it isn't a time of day. */
export function normalTime(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Whether the week's Monday post is due now: on that Monday, from the coach's post time until the day ends. A Monday missed
 * entirely (the job didn't run, or the connection was on hold) is not posted later in the week by itself: the coach sees it
 * and presses Post now, so a late post is always somebody's decision.
 */
export const mondayDue = (today: string, nowTime: string, postTime: string): boolean => weekday(today) === 1 && nowTime >= postTime;

/** The coach's text, or the default when it's empty. */
export const mondayText = (custom: string | null | undefined): string => (custom?.trim() ? custom.trim() : DEFAULT_MONDAY_TEXT);

export type PostAs = { id: string; name: string; avatar?: string | null };
/**
 * The community part of a Create post body. `postAsUser` maps the community account to the team user who posts: a GoHighLevel
 * user, never a community member (members are contacts, and nothing is ever posted in a member's name).
 */
export function communityDetails(accountId: string, title: string, postAs: PostAs): { title: string; postAsUser: Record<string, { id: string; name: string; avatar: string }> } {
  return { title: title.slice(0, TITLE_MAX), postAsUser: { [accountId]: { id: postAs.id, name: postAs.name, avatar: postAs.avatar ?? "" } } };
}

/** The link to a published post, from the coach's pattern ("…?postId={postId}"), or null until both are known. */
export function postLink(pattern: string | null | undefined, platformPostId: string | null | undefined): string | null {
  if (!pattern?.includes("{postId}") || !platformPostId) return null;
  return pattern.replaceAll("{postId}", encodeURIComponent(platformPostId));
}
/** A pattern the coach may save: an https address with {postId} in it. */
export const validPattern = (p: string): boolean => /^https:\/\/[^\s]+$/.test(p) && p.includes("{postId}");
/** A link the coach pastes for one post: any https address. */
export const validLink = (u: string): boolean => /^https:\/\/[^\s]+$/.test(u);
/** The community's own post id (24 hex) in a pasted post link: ".../posts/6aba9e02b152d012a960d2f9". Null when there isn't one. */
export function postIdFromLink(link: string): string | null {
  const m = /\/posts\/([0-9a-f]{24})(?=[/?#]|$)/i.exec(link);
  return m ? m[1].toLowerCase() : null;
}
/** The pattern a pasted post link gives its channel: the same address with {postId} where the id is. Null without an id. */
export function patternFromLink(link: string): string | null {
  const id = postIdFromLink(link);
  if (!id) return null;
  return link.replace(/[?#].*$/, "").replace(new RegExp(`/posts/${id}$`, "i"), "/posts/{postId}");
}

/**
 * GoHighLevel's reply when the account itself is on hold (26 Sep: locked for a failed payment). The rule is to stop and say
 * so, never to retry, so this is checked before anything else on every failure.
 */
export function isAccountHold(r: { status?: number; detail?: string }): boolean {
  if (r.status === 402 || r.status === 423) return true;
  return /on hold|suspend|locked|deactivat|past due|payment|billing|inactive (account|location|sub-?account)|account (is )?(disabled|inactive)/i.test(r.detail ?? "");
}
export const HOLD_REASON = "GoHighLevel says this account is on hold (for example, a failed payment). HelixOS has stopped posting and won't retry. Sort it out in GoHighLevel, then press Resume.";

/** The planner's status word, in the coach's words. "unknown" is ours: sent, but HelixOS can't see whether it went out. */
export type CommunityStatus = "scheduled" | "sent" | "posted" | "failed" | "skipped" | "unknown";
export const UNKNOWN_REASON = "HelixOS can't see whether this went out. Check the community: if it's there, press It's live; if not, press It didn't go out, and Post now comes back.";
export function fromPlanner(status: string): CommunityStatus {
  const s = status.toLowerCase();
  if (s === "published") return "posted";
  if (s === "failed" || s === "deleted") return "failed";
  return "sent";
}

/* ───────── Piece 2: "Share to the thread" ───────── */

/** Points for sharing the week's 3-1-3 to the thread: once per week, on the tap (rev 153: 15, type "community"). */
export const SHARE_POINTS = 15;
export const shareRef = (weekOf: string): string => `share:${weekOf}`;

/**
 * The member's 3-1-3 as a ready-made comment: the word, the key results, the initiative and the tasks, nothing else. No
 * revenue and nothing from the monthly intention: those stay private.
 */
export function shareText(week: { word: string; keyResults: { text: string }[]; initiative: string; tasks: { title: string }[] }): string {
  const list = (xs: string[]) => xs.filter((x) => x.trim()).map((x, i) => `${i + 1}. ${x.trim()}`).join("\n");
  return [`My word: ${week.word.trim()}`, `Key results:\n${list(week.keyResults.map((k) => k.text))}`, `Initiative: ${week.initiative.trim()}`, `Tasks:\n${list(week.tasks.map((t) => t.title))}`].join("\n\n");
}

/**
 * Where "Share to the thread" goes: this week's Monday post, once it's out and HelixOS has its link. Never an older week's post.
 */
export function shareTarget(post: { weekOf: string | null; status: string; link: string | null } | null | undefined, weekOf: string): { link: string } | { reason: string } {
  if (!post || post.weekOf !== weekOf || post.status === "skipped") return { reason: "This week's post isn't up yet. Check back after Monday's post goes out." };
  if (!post.link || (post.status !== "posted" && post.status !== "sent")) return { reason: "This week's post isn't up yet. Check back later today." };
  return { link: post.link };
}

/* ───────── Reading a post back (28 Sep, live) ───────── */

type PlannerLike = { id: string; status: string | null; summary: string | null; accountIds: string[]; createdAt: string | null };
/**
 * The planner's post for one of ours when its create reply carried no id (seen live on 28 Sep): same channel, same text, sent
 * within a few minutes, and of several, the one created nearest our send. None when nothing fits.
 */
export function pickPlannerPost<T extends PlannerLike>(posts: T[], want: { accountId: string; summary: string; sentAtIso: string }): T | null {
  const norm = (x: string | null) => (x ?? "").replace(/\s+/g, " ").trim();
  const text = norm(want.summary);
  const sent = new Date(want.sentAtIso).getTime();
  const near = posts
    .filter((p) => p.accountIds.includes(want.accountId) && norm(p.summary) === text && p.createdAt)
    .map((p) => ({ p, d: Math.abs(new Date(String(p.createdAt)).getTime() - sent) }))
    .filter((x) => Number.isFinite(x.d) && x.d <= 10 * 60000)
    .sort((a, b) => a.d - b.d);
  return near[0]?.p ?? null;
}

/** The link pattern for a channel: each channel has its own address (its slug doesn't follow renames), set per channel. */
export function patternFor(patterns: Record<string, string> | null | undefined, legacy: { pattern: string | null; channel: string | null }, accountId: string | null): string | null {
  if (!accountId) return null;
  return patterns?.[accountId] ?? (legacy.channel === accountId ? legacy.pattern : null);
}

/** The planner's own words for a failed post, for the coach (redacted of anything token-shaped by the caller), or a plain fallback. */
export const failedReason = (planner: string | null | undefined): string => (planner?.trim() ? `GoHighLevel says: ${planner.trim().slice(0, 400)}` : "The Social Planner marked it failed without a reason.");
