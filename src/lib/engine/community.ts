/**
 * The coach's community connection (handoff revs 150 to 154): HelixOS posts into the coach's GoHighLevel community through the
 * Social Planner, from the team account. Pure: dates are "YYYY-MM-DD" in the coach's own time zone, times "HH:MM".
 */
import { addDays, startOfWeek, weekday } from "@/lib/dates";
import { MONTH_QUESTIONS, revenueLabel, seasonLabel } from "@/lib/engine/month-intentions";

/** Danno's current Monday post, word for word: the default until the coach edits it. */
export const DEFAULT_MONDAY_TEXT =
  "It's important to set our intention. Choose ONE word that you will decide to embody this week. Next we are planning our 3-1-3 goals. It looks like the following: What are THREE trackable key results I'd like to achieve this week. What is ONE initiative I can work on to work toward my bigger objective/goal. What are THREE tasks that I need to accomplish this week to move the needle forward. When we create bite-sized goal-planning activities, we are much more likely to achieve them and connect them to our greater picture. Declare your goals here and let's keep each other accountable. Share below @everyone so we can check in with you and keep your momentum going strong.";
export const DEFAULT_POST_TIME = "08:00";
/** The Social Planner's community limits (the live Create post page, read 28 Sep): a title up to 1,000, a caption up to 100,000. */
export const TITLE_MAX = 1000;
export const TEXT_MAX = 100000;
export const TEST_TITLE = "HelixOS test, please ignore";
/** The test post's text, with its send time, so each test is its own post in the planner's list (28 Sep: several tests a minute apart). */
/** The Monday text sent as a test (rev 169), to see its layout in the test channel; its send time on a last line tells tests apart. */
export const mondayTestText = (text: string, sentAtIso: string): string => `${text}\n\n(A test of the Monday text from HelixOS, sent ${sentAtIso.slice(0, 16).replace("T", " ")} UTC. Please ignore it; it will be deleted.)`;
export const testText = (sentAtIso: string): string => `A test from HelixOS, to check the connection (sent ${sentAtIso.slice(0, 16).replace("T", " ")} UTC). Please ignore it; it will be deleted.`;

/* ───────── The first-of-the-month post (1 Oct, Danno's priority 1) ───────── */

/** 1️⃣ to 1️⃣1️⃣: the emoji numerals the October post numbers its questions with (rev 328). */
export const emojiNumeral = (n: number): string => String(n).split("").map((d) => `${d}\uFE0F\u20E3`).join("");
/** The seasons spelled inline in the question, as the October post has them. */
const MONTH_QUESTION_LINES = MONTH_QUESTIONS.map((q, i) => {
  const text = q.key === "personalSeason" ? "What personal season are you in? (self, wealth, relationships, or spirituality)" : q.key === "businessSeason" ? "What season is your business in? (marketing, sales, fulfillment, or maybe operations)" : q.q;
  return `${emojiNumeral(i + 1)} ${text}`;
});
/**
 * The month post's default text until the coach edits it, in the shape of Danno's October post (rev 328, read off the live
 * thread): a two-line opener, the eleven questions numbered with emoji numerals and the seasons spelled inline, four short
 * paragraphs on why planning the month matters, then @everyone. Danno pastes his own wording over it on the Community posts page.
 */
export const DEFAULT_MONTH_TEXT = [
  "A new month, a fresh page.\nBefore the week-by-week work starts, let's set the whole month on purpose.",
  MONTH_QUESTION_LINES.join("\n"),
  "Why plan the month? Because a month is long enough to move something real, and short enough to stay honest about it.",
  "The word you choose becomes the lens for every decision you make this month, and the fear you name loses half its grip the moment it is written down.",
  "A revenue goal with a why behind it, and a plan to reach it, turns hope into a schedule.",
  "Post your eleven answers below so we can hold you to them and cheer you on through the month. @everyone",
].join("\n\n");
const monthName = (monthOf: string): string => new Date(`${monthOf}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
/** "Set Your Intentions October 2026": the title pattern of Danno's live post (rev 328), month and year, no dates. */
export const monthTitle = (monthOf: string): string => `Set Your Intentions ${monthName(monthOf)} ${monthOf.slice(0, 4)}`;
/** The month after ("2026-12" → "2027-01"). */
export function nextMonth(monthOf: string): string {
  const y = Number(monthOf.slice(0, 4));
  const m = Number(monthOf.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
/** The next month post's month: this month's while the 1st's post time hasn't passed, else next month's. */
export function upcomingMonth(today: string, nowTime: string, postTime: string): string {
  const month = today.slice(0, 7);
  return today.slice(8, 10) === "01" && nowTime < postTime ? month : nextMonth(month);
}
/** Whether the month post is due now: on the 1st, from the coach's time until the day ends. A 1st missed is Post now, as a Monday is. */
export const monthDue = (today: string, nowTime: string, postTime: string): boolean => today.slice(8, 10) === "01" && nowTime >= postTime;
/** The coach's month text, or the default when it's empty. */
export const monthText = (custom: string | null | undefined): string => (custom?.trim() ? custom.trim() : DEFAULT_MONTH_TEXT);
/** The month text sent as a test, to see its layout in the test channel; its send time on a last line tells tests apart. */
export const monthTestText = (text: string, sentAtIso: string): string => `${text}\n\n(A test of the month text from HelixOS, sent ${sentAtIso.slice(0, 16).replace("T", " ")} UTC. Please ignore it; it will be deleted.)`;

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
export function communityDetails(accountId: string, title: string, postAs: PostAs, notify = false): CommunityDetails {
  // notifyAllGroupMembers is what the community's own composer sends for "Notify all group members" (rev 187, read from its
  // request on 29 Sep). It is always sent, and false unless asked: a test post never notifies anyone.
  return { title: title.slice(0, TITLE_MAX), postAsUser: { [accountId]: { id: postAs.id, name: postAs.name, avatar: postAs.avatar ?? "" } }, notifyAllGroupMembers: notify };
}
export type CommunityDetails = { title: string; postAsUser: Record<string, { id: string; name: string; avatar: string }>; notifyAllGroupMembers: boolean };

/**
 * @everyone as the community's own composer stores it (rev 203, read from Danno's 9/28 post): a broadcast mention, which shows
 * as a tag. Typed as plain text it is only words.
 */
export const EVERYONE_MENTION = `<span data-label="everyone" data-icon-type="emoji" data-mention-type="broadcast" data-type="mention" class="min-h-6"><span class="mention-text truncate min-w-0">@everyone</span></span>`;

/**
 * The post's text as the community shows it (rev 169): its content is HTML, so plain text would run together in one block. The
 * text is escaped first; a blank line starts a new paragraph and a single return is a line break. With `mentionEveryone` (the
 * real Monday post only, rev 203), a standalone @everyone becomes the broadcast mention; never in a test, which could ping
 * every member. "x@everyone" or an address is left as it is.
 */
export function communityHtml(text: string, opts: { mentionEveryone?: boolean } = {}): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\s+$/g, ""))
    .filter((p) => p.trim())
    .map((p) => `<p>${p.split("\n").map((line) => (opts.mentionEveryone ? esc(line).replace(/(^|[^\w@.])@everyone(?![\w@])/g, `$1${EVERYONE_MENTION}`) : esc(line))).join("<br>")}</p>`)
    .join("");
}
/** A post's words with any HTML taken back out, so a post sent as HTML and its plain text compare equal. */
export function plainOf(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/<br\s*\/?>|<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The community's own post id, never the planner's (rev 499, 5 Oct): the first automatic Monday post saved its link with the
 * Social Planner's id, which opens "Post not available". An id equal to the planner's is no community id yet: wait for it.
 */
export const communityPostId = (postId: string | null | undefined, plannerId: string | null | undefined): string | null => (postId && postId !== plannerId ? postId : null);
/** A link built on the planner's id is no link: members would land on "Post not available". */
export const communityLink = (link: string | null | undefined, plannerId: string | null | undefined): string | null => (link && !(plannerId && link.includes(plannerId)) ? link : null);

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

/** Points for sharing the month's eleven answers to the month's thread (1 Oct): the same, once per month. */
export const monthShareRef = (monthOf: string): string => `share:month:${monthOf}`;
/**
 * The member's month as a ready-made comment: the eleven answers in the post's own numbered shape (rev 328), one per line,
 * the revenue goal included (Danno, rev 346: it is set together on the call, so it can be public).
 */
export function monthShareText(m: { word: string; personalSeason: string; fear: string; habit: string; skill: string; impact: string; businessSeason: string; revenueGoal: number; revenueWhy: string; plan: string; proudLast: string; proudEnd: string }): string {
  const answers = [
    `My word: ${m.word.trim()}`,
    `Personal season: ${seasonLabel(m.personalSeason)}`,
    `Fear or limiting belief to overcome: ${m.fear.trim()}`,
    `Habit to start: ${m.habit.trim()}`,
    `Skill to develop: ${m.skill.trim()}`,
    `Impact: ${m.impact.trim()}`,
    `Business season: ${seasonLabel(m.businessSeason)}`,
    `Revenue goal: ${revenueLabel(m.revenueGoal)}. ${m.revenueWhy.trim()}`,
    `Plan: ${m.plan.trim()}`,
    `Most proud of last month: ${m.proudLast.trim()}`,
    `At the end of the month, proud of: ${m.proudEnd.trim()}`,
  ];
  return answers.map((a, i) => `${emojiNumeral(i + 1)} ${a}`).join("\n");
}
/** Where the month's share goes: this month's post, once it's out with its link. Never an older month's post. */
export function monthShareTarget(post: { monthOf: string | null; status: string; link: string | null; ghlPostId?: string | null } | null | undefined, monthOf: string): { link: string } | { reason: string } {
  if (!post || post.monthOf !== monthOf || post.status === "skipped") return { reason: "This month's post isn't up yet. Check back after the 1st." };
  const link = communityLink(post.link, post.ghlPostId);
  if (!link || (post.status !== "posted" && post.status !== "sent")) return { reason: "This month's post isn't up yet. Check back later today." };
  return { link };
}

/**
 * Where "Share to the thread" goes: this week's Monday post, once it's out and HelixOS has its link. Never an older week's post.
 */
export function shareTarget(post: { weekOf: string | null; status: string; link: string | null; ghlPostId?: string | null } | null | undefined, weekOf: string): { link: string } | { reason: string } {
  if (!post || post.weekOf !== weekOf || post.status === "skipped") return { reason: "This week's post isn't up yet. Check back after Monday's post goes out." };
  const link = communityLink(post.link, post.ghlPostId);
  if (!link || (post.status !== "posted" && post.status !== "sent")) return { reason: "This week's post isn't up yet. Check back later today." };
  return { link };
}

/* ───────── Reading a post back (28 Sep, live) ───────── */

type PlannerLike = { id: string; status: string | null; summary: string | null; accountIds: string[]; createdAt: string | null };
/**
 * The planner's post for one of ours when its create reply carried no id (seen live on 28 Sep): same channel, same text, sent
 * within a few minutes, and of several, the one created nearest our send. None when nothing fits.
 */
export function pickPlannerPost<T extends PlannerLike>(posts: T[], want: { accountId: string; summary: string; sentAtIso: string }): T | null {
  // The planner holds the HTML that was sent (rev 169), or plain text for posts before it; the row keeps the plain text.
  const ws = (x: string | null) => (x ?? "").replace(/\s+/g, " ").trim();
  const norm = (x: string | null) => (/^\s*<p>/i.test(x ?? "") ? plainOf(x) : ws(x));
  const text = ws(want.summary);
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
