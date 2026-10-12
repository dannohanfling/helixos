/**
 * The Monday scoreboard (rev 635, answered rev 639) on the server: one member's week gathered from what HelixOS already holds,
 * the member's email at their own morning hour, and the coach's roster (names only). Run from the hourly reminders cron.
 *
 * What is read: the member's posts and their channels (content_variants, counted once GoHighLevel confirms them, by the same
 * rule the content card uses), the per-post Comments they typed, their evening closes, the clients they added, their 3-1-3,
 * and their key results and KPIs. No Body or health table is ever read here (a unit test holds this file to it).
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { boardStepsFor } from "@/lib/board-steps";
import { brandedEmail } from "@/lib/branded-email";
import { canEmail } from "@/lib/email-gate";
import { sendEmail } from "@/lib/email";
import { hourInTz, todayInTz } from "@/lib/dates";
import { outcomeOf, nowFor } from "@/lib/engine/channel-outcome";
import { formatKpi, mondayOf } from "@/lib/engine/kpi";
import { storedUtc } from "@/lib/engine/office-hours";
import { channelName, lastWeekOf, platformName, rosterCopy, rosterLine, scoreboardCopy, scoreboardDue, thisWeekOf, type Scoreboard, type Week } from "@/lib/engine/scoreboard";
import { logsBetween } from "@/lib/queries/daily";
import { kpiReads } from "@/lib/queries/kpi";
import { pacesOf } from "@/lib/queries/plan";

type Member = { workspaceId: string; userId: string };
const dayOf = (stored: string | null | undefined, tz: string): string | null => {
  const d = storedUtc(stored);
  return d ? todayInTz(tz, d) : null;
};
const inWeek = (day: string | null, w: Week) => Boolean(day && day >= w.from && day <= w.to);

/** One member's scoreboard for a week (last week on a Monday; "this" is the week so far). */
export async function scoreboardFor(m: Member, tz: string, today: string, which: "last" | "this" = "last"): Promise<Scoreboard> {
  const week = which === "last" ? lastWeekOf(today) : thisWeekOf(today);
  const days = Math.round((Date.parse(`${week.to}T00:00:00Z`) - Date.parse(`${week.from}T00:00:00Z`)) / 86400000) + 1;

  // Posts: each channel's version, on the day it went (or was due), counted once GoHighLevel says published.
  const items = await db.query.contentItems.findMany({ where: and(eq(schema.contentItems.workspaceId, m.workspaceId), eq(schema.contentItems.userId, m.userId)), columns: { id: true, status: true, platform: true, postedAt: true } });
  const variants = items.length ? await db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.userId, m.userId), inArray(schema.contentVariants.contentItemId, items.map((i) => i.id))) }) : [];
  const now = nowFor({ tz, today });
  const byChannel = new Map<string, number>();
  let waiting = 0;
  let comments = 0;
  for (const v of variants) {
    if (v.status === "draft" || v.status === "skipped") continue;
    const day = v.postedAt ? dayOf(v.postedAt, tz) : (v.postAt?.slice(0, 10) ?? null);
    if (!inWeek(day, week)) continue;
    comments += v.comments ?? 0;
    const o = outcomeOf(v, now);
    if (o.state === "published") byChannel.set(channelName(v.channel), (byChannel.get(channelName(v.channel)) ?? 0) + 1);
    else if (o.state === "sending" || o.state === "unknown") waiting++;
  }
  // A post marked posted on the board with no channel versions (typed in by hand) counts under its platform.
  const withVariants = new Set(variants.map((v) => v.contentItemId));
  for (const i of items) if (i.status === "posted" && !withVariants.has(i.id) && inWeek(dayOf(i.postedAt, tz), week)) byChannel.set(platformName(i.platform), (byChannel.get(platformName(i.platform)) ?? 0) + 1);
  const channels = [...byChannel].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // The evening closes.
  const logs = await logsBetween(m.workspaceId, m.userId, week.from, week.to);
  const sum = (k: "dmsStarted" | "conversations" | "callsBooked") => logs.reduce((a, l) => a + (l[k] ?? 0), 0);

  // Clients added on Clients that week.
  const clients = await db.query.clientRecords.findMany({ where: and(eq(schema.clientRecords.workspaceId, m.workspaceId), eq(schema.clientRecords.userId, m.userId)), columns: { createdAt: true } });

  // The 3-1-3: the week reported on, and this week's if it's set.
  const intentionOf = (weekOf: string) => db.query.weeklyIntentions.findFirst({ where: and(eq(schema.weeklyIntentions.workspaceId, m.workspaceId), eq(schema.weeklyIntentions.userId, m.userId), eq(schema.weeklyIntentions.weekOf, weekOf)) });
  const [last, current] = await Promise.all([intentionOf(week.from), intentionOf(mondayOf(today))]);
  const taskIds = (last?.tasks ?? []).map((t) => t.taskId).filter((x): x is string => Boolean(x));
  const tasks = taskIds.length ? await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, m.userId), inArray(schema.tasks.id, taskIds)), columns: { id: true, status: true } }) : [];
  const doneTasks = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));

  // Key results and KPIs, where they stood at the end of the week (or today, mid-week).
  const asOf = week.to < today ? week.to : today;
  const { reads } = await kpiReads(m, asOf);
  const paces = pacesOf(reads);
  const krs = await db.query.planRecords.findMany({ where: and(eq(schema.planRecords.workspaceId, m.workspaceId), eq(schema.planRecords.userId, m.userId), eq(schema.planRecords.kind, "key_result"), isNull(schema.planRecords.archivedAt)) });

  // Calls booked through GoHighLevel that week, by the day they were booked (the appointment webhook's "booked on").
  const booked = await db.query.contacts.findMany({ where: and(eq(schema.contacts.workspaceId, m.workspaceId), eq(schema.contacts.userId, m.userId), isNotNull(schema.contacts.callBookedAt)), columns: { callBookedAt: true } });
  const ghlBooked = booked.filter((c) => inWeek(dayOf(c.callBookedAt, tz), week)).length;

  // My Board's steps due that week (rev 664 §6), and any open past their date: counts only.
  const boardSteps = await boardStepsFor(m, week.from, week.to, today);

  return {
    week,
    days,
    boardSteps,
    ghlBooked,
    posts: { byChannel: channels, total: channels.reduce((a, c) => a + c.count, 0), waiting },
    comments,
    dms: { started: sum("dmsStarted"), conversations: sum("conversations") },
    calls: sum("callsBooked"),
    closes: logs.filter((l) => l.eveningDoneAt).length,
    clientsAdded: clients.filter((c) => inWeek(dayOf(c.createdAt, tz), week)).length,
    lastIntention: last ? { word: last.word, keyResults: last.keyResults.map((k) => ({ text: k.text, done: k.done })), tasks: last.tasks.map((t) => ({ title: t.title, done: Boolean(t.taskId && doneTasks.has(t.taskId)) })), reviewed: Boolean(last.reviewedAt) } : null,
    thisIntention: which === "last" && current ? { word: current.word, keyResults: current.keyResults.map((k) => k.text) } : null,
    keyResults: krs.filter((k) => k.status !== "dropped").map((k) => ({ title: k.title, pace: paces[k.id] ?? "none" })),
    kpis: reads.map((r) => ({ name: r.kpi.name, period: r.kpi.period, actual: formatKpi(r.actual, r.kpi.unit), target: formatKpi(r.kpi.target, r.kpi.unit), pace: r.pace })),
  };
}

/** The coach's roster lines: every active client of the workspace, by name only, their own week in their own time zone. */
export async function rosterFor(workspaceId: string, now: Date = new Date()): Promise<{ week: Week | null; lines: string[] }> {
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) });
  if (!ws) return { week: null, lines: [] };
  const clients = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  const lines: { name: string; line: string }[] = [];
  let week: Week | null = null;
  for (const c of clients) {
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, c.userId), columns: { name: true } });
    if (!user) continue;
    const tz = c.timezone || ws.timezone;
    const s = await scoreboardFor({ workspaceId, userId: c.userId }, tz, todayInTz(tz, now));
    week ??= s.week;
    lines.push({ name: user.name, line: rosterLine(user.name, s) });
  }
  return { week, lines: lines.sort((a, b) => a.name.localeCompare(b.name)).map((l) => l.line) };
}

export type ScoreboardResult = { userId: string; kind: "scoreboard" | "roster"; delivery: "sent" | "logged" | "failed"; error?: string };

/**
 * The hourly run: each client whose Monday morning hour it is gets their scoreboard, and each coach their roster at their own
 * morning hour; the same gate as reminders (Emails on, signed in once, not removed), the member's own switch, and once a week.
 * Only a send that went out stamps the week, so a logged or failed one is tried again next hour. One failure never stops the run.
 */
export async function runScoreboards(now: Date = new Date(), force = false): Promise<ScoreboardResult[]> {
  const out: ScoreboardResult[] = [];
  for (const ws of await db.query.workspaces.findMany()) {
    const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, ws.id), isNull(schema.memberships.removedAt)) });
    for (const m of members) {
      const tz = m.timezone || ws.timezone;
      const today = todayInTz(tz, now);
      if (!scoreboardDue({ today, hour: hourInTz(tz, now), reminderHour: m.reminderHour, sentWeek: m.scoreboardSentWeek, on: m.scoreboardEmail }, force)) continue;
      if (!(await canEmail(m.id))) continue;
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
      if (!user) continue;
      const first = user.name.split(" ")[0];
      const kind = m.role === "coach" ? "roster" : "scoreboard";
      try {
        let email: { subject: string; text: string; html: string };
        if (m.role === "coach") {
          const r = await rosterFor(ws.id, now);
          email = brandedEmail(rosterCopy(first, r.week ?? lastWeekOf(today), r.lines), { settingsLink: false });
        } else {
          email = brandedEmail(scoreboardCopy(first, await scoreboardFor({ workspaceId: ws.id, userId: m.userId }, tz, today)), { settingsLink: false });
        }
        const delivery = await sendEmail(user.email, email.subject, email.text, email.html);
        out.push({ userId: m.userId, kind, delivery });
        if (delivery === "sent") await db.update(schema.memberships).set({ scoreboardSentWeek: mondayOf(today) }).where(eq(schema.memberships.id, m.id));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[scoreboard] ${kind} to member ${m.userId} failed: ${error}`);
        out.push({ userId: m.userId, kind, delivery: "failed", error });
      }
    }
  }
  return out;
}
