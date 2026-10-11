/**
 * The Monday scoreboard (rev 635, answered rev 639), the pure parts: which week it reports on, when it is due, the member's
 * email and the coach's roster in words, and the spoken version for Claude. The caller gathers the numbers
 * (src/lib/scoreboard.ts); nothing here reads the database, and no Body or health number is ever part of it.
 *
 * Every number says where it comes from: posts count once GoHighLevel confirms them (or the member marks a pasted one
 * posted); DMs and calls are the evening closes summed; comments and clients added are what the member logged.
 */
import { addDays, formatDate, weekday } from "@/lib/dates";
import { mondayOf } from "@/lib/engine/kpi";
import type { EmailCopy } from "@/lib/engine/reminder-copy";
import type { EmailSection } from "@/lib/engine/email-template";

export type Week = { from: string; to: string };
/** The week a Monday's scoreboard reports on: the one that just ended, Monday to Sunday in the member's own days. */
export const lastWeekOf = (today: string): Week => {
  const from = addDays(mondayOf(today), -7);
  return { from, to: addDays(from, 6) };
};
/** This week so far, for "read me my scoreboard" mid-week. */
export const thisWeekOf = (today: string): Week => ({ from: mondayOf(today), to: today });

/**
 * Due on a Monday at the member's own morning hour, once a week: the stamp is that Monday, so an hourly job that runs twice
 * sends nothing the second time. A forced run (the walk, or a coach test) skips the day and the hour, never the stamp.
 */
export function scoreboardDue(s: { today: string; hour: number; reminderHour: number; sentWeek: string | null; on: boolean }, force = false): boolean {
  if (!s.on) return false;
  if (s.sentWeek === mondayOf(s.today)) return false;
  return force || (weekday(s.today) === 1 && s.hour === s.reminderHour);
}

/** One short name per place a post goes, the same whether it went through GoHighLevel or was typed in on the board. */
const CHANNEL_NAME: Record<string, string> = { fb_personal: "Facebook personal", fb_page: "Facebook Page", fb_group: "your Facebook group", other_groups: "other groups", stories: "Stories", instagram: "Instagram", threads: "Threads", linkedin: "LinkedIn", email: "Email", skool: "Skool" };
const PLATFORM_NAME: Record<string, string> = { "FB Personal": "Facebook personal", "FB Group": "your Facebook group", Instagram: "Instagram", "IG Reels": "Instagram", Stories: "Stories", LinkedIn: "LinkedIn", "YT Short": "YouTube", Email: "Email", Skool: "Skool" };
export const channelName = (channel: string): string => CHANNEL_NAME[channel] ?? channel;
export const platformName = (platform: string): string => PLATFORM_NAME[platform] ?? platform;

export type Pace = "ahead" | "on" | "behind" | "done" | "none";
export type Scoreboard = {
  week: Week;
  /** Days in the week so far: 7 for a finished week. */
  days: number;
  posts: { byChannel: { label: string; count: number }[]; total: number; waiting: number };
  /** The per-post Comments the member typed (you logged). */
  comments: number;
  dms: { started: number; conversations: number };
  calls: number;
  closes: number;
  /** Clients added on Clients that week (you logged). */
  clientsAdded: number;
  lastIntention: { word: string; keyResults: { text: string; done: boolean | null }[]; tasks: { title: string; done: boolean }[]; reviewed: boolean } | null;
  thisIntention: { word: string; keyResults: string[] } | null;
  keyResults: { title: string; pace: Pace }[];
  kpis: { name: string; period: string; actual: string; target: string; pace: Pace }[];
};

const PACE_WORD: Record<Pace, string> = { ahead: "ahead", on: "on pace", behind: "behind", done: "done", none: "no target" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const range = (w: Week) => `${formatDate(w.from)} to ${formatDate(w.to)}`;

/** "1 ahead, 1 behind": the key results by pace, in that order, those with no target left out. */
export function paceTally(krs: { pace: Pace }[]): string {
  const order: Pace[] = ["done", "ahead", "on", "behind"];
  const parts = order.map((p) => [p, krs.filter((k) => k.pace === p).length] as const).filter(([, n]) => n > 0).map(([p, n]) => `${n} ${PACE_WORD[p]}`);
  return parts.join(", ") || "none with a target";
}

/** The scoreboard as the email's blocks: the numbers, the 3-1-3, then key results and KPIs. */
export function scoreboardSections(s: Scoreboard): EmailSection[] {
  const posts = s.posts.byChannel.length ? s.posts.byChannel.map((c) => `${c.count} ${c.label}`).join(", ") : "none";
  const numbers: EmailSection = {
    heading: `Your week, ${range(s.week)}`,
    rows: [
      { label: "Posts shipped", value: s.posts.total ? `${s.posts.total} (${posts})` : "0" },
      ...(s.posts.waiting ? [{ label: "Waiting for GoHighLevel to confirm", value: String(s.posts.waiting) }] : []),
      { label: "Comments (you logged)", value: String(s.comments) },
      { label: "DMs started", value: String(s.dms.started) },
      { label: "Conversations", value: String(s.dms.conversations) },
      { label: "Calls booked", value: String(s.calls) },
      { label: "Clients added (you logged)", value: String(s.clientsAdded) },
      { label: "Days closed", value: `${s.closes} of ${s.days}` },
    ],
    note: `Posts count once GoHighLevel confirms them, or when you mark a pasted post posted. DMs and calls come from your evening closes (${s.closes} of ${s.days} closed), so an unclosed day reads as zero.`,
  };
  const li = s.lastIntention;
  const lastRows = li
    ? [
        { label: "Word", value: li.word },
        ...li.keyResults.map((k) => ({ label: k.text, value: k.done === true ? "Done" : k.done === false ? "Not done" : "Not marked" })),
        ...li.tasks.map((t) => ({ label: t.title, value: t.done ? "Done" : "Open" })),
      ]
    : [];
  const intention: EmailSection = {
    heading: "Your 3-1-3",
    rows: [...lastRows, ...(s.thisIntention ? [{ label: "This week's word", value: s.thisIntention.word }, ...s.thisIntention.keyResults.map((k, i) => ({ label: `This week, key result ${i + 1}`, value: k }))] : [])],
    note: [li ? null : "No 3-1-3 was set last week.", s.thisIntention ? null : "This week's isn't set yet."].filter(Boolean).join(" ") || null,
  };
  const goals: EmailSection = {
    heading: "Key results and KPIs",
    rows: [...s.keyResults.map((k) => ({ label: k.title, value: PACE_WORD[k.pace] })), ...s.kpis.map((k) => ({ label: `${k.name} (${k.period})`, value: `${k.actual} of ${k.target}, ${PACE_WORD[k.pace]}` }))],
    note: s.keyResults.length || s.kpis.length ? "Where each stood at the end of the week." : "No key results or KPIs yet. Set them under Grow → Business goals.",
  };
  return [numbers, intention, goals];
}

/** The member's Monday email. One button: Open Today, or Set this week's 3-1-3 when it isn't set yet. */
export function scoreboardCopy(first: string, s: Scoreboard): EmailCopy {
  const setIt = !s.thisIntention;
  return {
    subject: `${first}, your week: ${plural(s.posts.total, "post")}, ${plural(s.dms.started, "DM")}, ${plural(s.calls, "call")}`,
    preheader: `Your scoreboard for ${range(s.week)}.`,
    greeting: `Morning, ${first}.`,
    stateLine: `Last week: ${plural(s.posts.total, "post")} shipped, ${plural(s.dms.started, "DM")} started, ${plural(s.calls, "call")} booked, ${s.closes} of ${s.days} days closed.`,
    asks: [],
    sections: scoreboardSections(s),
    buttonLabel: setIt ? "Set this week's 3-1-3" : "Open Today",
    pointsLine: "Your scoreboard comes every Monday.",
    path: setIt ? "/intentions#week" : "/today",
    footerText: "You can turn the Monday scoreboard off in Settings, under You.",
  };
}

/** "Maya T": a first name and the last initial, never more (the roster carries no contact detail). */
export function rosterName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "A client";
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)!.charAt(0).toUpperCase()}` : parts[0];
}

/** One client's line on the coach's roster. */
export function rosterLine(name: string, s: Scoreboard): string {
  const intention = s.lastIntention ? (s.lastIntention.reviewed ? "3-1-3 reviewed" : "3-1-3 not reviewed") : "no 3-1-3";
  const krs = s.keyResults.length ? `key results: ${paceTally(s.keyResults)}` : "no key results";
  return `${rosterName(name)}: ${plural(s.posts.total, "post")}, ${plural(s.dms.started, "DM")}, ${plural(s.calls, "call")}, closes ${s.closes} of ${s.days}, ${intention}, ${krs}`;
}

/** The coach's Monday roster: one line per active client, names only. One button: Open the Coach view. */
export function rosterCopy(first: string, week: Week, lines: string[]): EmailCopy {
  return {
    subject: `${first}, your clients' week (${range(week)})`,
    preheader: `${plural(lines.length, "client")}, last week in one line each.`,
    greeting: `Morning, ${first}.`,
    stateLine: lines.length ? `${plural(lines.length, "client")}, ${range(week)}.` : "No active clients last week.",
    asks: [],
    sections: [{ heading: "Your clients", rows: lines.map((l) => { const i = l.indexOf(": "); return { label: l.slice(0, i), value: l.slice(i + 2) }; }), note: "Posts count once GoHighLevel confirms them; DMs and calls come from each client's evening closes." }],
    buttonLabel: "Open the Coach view",
    pointsLine: "Your roster comes every Monday.",
    path: "/coach",
    footerText: "You can turn the Monday roster off in Settings, under You.",
  };
}

/** For Claude to read aloud: one sentence first, then the rest. */
export function scoreboardSpoken(s: Scoreboard, label: string): string {
  const lead = `${label}: ${plural(s.posts.total, "post")} shipped, ${plural(s.dms.started, "DM")} started, ${plural(s.calls, "call")} booked, ${s.closes} of ${s.days} days closed.`;
  const rest = scoreboardSections(s).map((sec) => [sec.heading, ...sec.rows.map((r) => `${r.label}: ${r.value}`), sec.note ?? ""].filter(Boolean).join("\n"));
  return [lead, ...rest].join("\n\n");
}
