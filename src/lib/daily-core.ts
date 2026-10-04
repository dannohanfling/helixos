/**
 * The morning lock-in and the evening close, the one copy of their rules (connector steps 2 and 3, rev 380). The form actions
 * in src/lib/actions/daily.ts parse the form and call these; the connector's tools in src/lib/mcp/tools/today.ts call the same
 * functions. A coach switched into a client never gets here: the actions refuse first, and the connector's viewer is always
 * the member themself.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { POINTS, closeActivityPoints } from "@/lib/engine/points";
import { streakBonus, weeklyStreakDay } from "@/lib/engine/streak";
import { closedDates, logFor, streakFor, todayActivity } from "@/lib/queries/daily";
import { award, totalPoints } from "@/lib/queries/points";

/** The five energy words, 1 to 5, as the lock-in's buttons say them. */
export const ENERGY_WORDS = ["Dragging", "Slow", "Steady", "Bright", "On fire"] as const;
export const energyWord = (n: number | null | undefined): string | null => (n && n >= 1 && n <= 5 ? ENERGY_WORDS[n - 1] : null);
/** A word (any case) or a number 1 to 5, to the stored number; anything else is null. */
export function energyFrom(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5) return raw;
  const s = String(raw ?? "").trim().toLowerCase();
  if (/^[1-5]$/.test(s)) return Number(s);
  const i = ENERGY_WORDS.findIndex((w) => w.toLowerCase() === s);
  return i < 0 ? null : i + 1;
}

export async function upsertLog(workspaceId: string, userId: string, date: string): Promise<schema.DailyLog> {
  const existing = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, userId), eq(schema.dailyLogs.date, date)) });
  if (existing) return existing;
  await db.insert(schema.dailyLogs).values({ id: newId(), workspaceId, userId, date }).onConflictDoNothing();
  return (await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, userId), eq(schema.dailyLogs.date, date)) }))!;
}

export type LockIn = { energy: number; intention: string | null; focusIds: string[]; newTitles: string[] };
export type LockedIn = {
  /** What a redone lock-in replaced; null on the day's first. */
  replaced: { energy: string | null; intention: string | null; top3: string[] } | null;
  top3: schema.Task[];
  created: string[];
  points: number;
};

/**
 * Locks the day in: the energy and the commitment line on the day's log, the Top 3 starred for today. A redo un-stars today's
 * open picks first (done ones keep their star). A title typed in finds the member's open task of that title (an imported one
 * waiting for review joins their list) or becomes a new task for today, never two. Ten points, once a day.
 */
export async function lockIn(v: Viewer, input: LockIn): Promise<LockedIn> {
  const { today } = v;
  const workspaceId = v.workspace.id;
  const userId = v.user.id;
  const log = await upsertLog(workspaceId, userId, today);
  const before = log.morningDoneAt ? await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.focusDate, today)), orderBy: asc(schema.tasks.createdAt) }) : [];
  const energy = Math.min(5, Math.max(1, Math.round(input.energy) || 3));
  await db.update(schema.dailyLogs).set({ energy, intention: input.intention, morningDoneAt: log.morningDoneAt ?? nowIso() }).where(eq(schema.dailyLogs.id, log.id));

  await db.update(schema.tasks).set({ focusDate: null }).where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.focusDate, today), ne(schema.tasks.status, "done")));
  const focusIds = input.focusIds.filter(Boolean).slice(0, 3);
  if (focusIds.length) await db.update(schema.tasks).set({ focusDate: today, urgency: "top3", status: "today" }).where(and(eq(schema.tasks.userId, userId), inArray(schema.tasks.id, focusIds)));
  const created: string[] = [];
  for (const raw of input.newTitles) {
    const title = raw.trim().slice(0, 200);
    if (!title) continue;
    const existing = await db.query.tasks.findFirst({ where: and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"), sql`lower(${schema.tasks.title}) = lower(${title})`) });
    if (existing) await db.update(schema.tasks).set({ focusDate: today, urgency: "top3", status: "today", reviewState: null }).where(eq(schema.tasks.id, existing.id));
    else {
      await db.insert(schema.tasks).values({ id: newId(), workspaceId, userId, title, urgency: "top3", status: "today", dueDate: today, focusDate: today, points: POINTS.top3Task });
      created.push(title);
    }
  }
  const awarded = await award({ workspaceId, userId }, "checkin", POINTS.checkin, "Morning lock-in", today);
  const top3 = await db.query.tasks.findMany({ where: and(eq(schema.tasks.userId, userId), eq(schema.tasks.focusDate, today)), orderBy: [asc(schema.tasks.status), asc(schema.tasks.createdAt)] });
  return {
    replaced: log.morningDoneAt ? { energy: energyWord(log.energy), intention: log.intention, top3: before.map((t) => t.title) } : null,
    top3,
    created,
    points: awarded ? POINTS.checkin : 0,
  };
}

export const CLOSE_NUMBERS = ["dmsStarted", "conversations", "callsBooked", "callsHeld", "posts", "offersMade", "newLeads", "cashCollected"] as const;
export const CLOSE_EXTRA = ["webinarRegs", "webinarShows", "replayViews", "applications", "proofPosts", "ctaPosts", "beliefPosts", "storiesCreated", "referralAsks", "revContent", "revWebinar", "revDm"] as const;
export const CLOSE_TEXT = ["start", "stop", "keep", "win", "gratitude"] as const;
/** The close's money boxes (rev 444): read the way people write them ("1.2k", "$1,200"); the rest of the numbers are counts. */
export const CLOSE_MONEY: readonly string[] = ["cashCollected", "revContent", "revWebinar", "revDm"];
export type CloseNumber = (typeof CLOSE_NUMBERS)[number] | (typeof CLOSE_EXTRA)[number];
export type CloseText = (typeof CLOSE_TEXT)[number];
/** A field left out keeps what the day's log already holds; the form sends every field, the connector only what was said. */
export type Close = Partial<Record<CloseNumber, number>> & Partial<Record<CloseText, string | null>>;
export type Closed = { firstClose: boolean; streakDay: number; points: { close: number; streak: number; activity: number }; activityLines: string[]; cashDelta: number; log: schema.DailyLog };

/**
 * Closes the day: the numbers, Start/Stop/Keep, the win and the gratitude on the day's log. The first close scores the close
 * and the streak day's bonus; activity points follow the numbers on every save (the difference, net of what was already scored
 * as it happened); cash moves the primary $ goal by the change. A repaired day never feeds the weekly escalation.
 */
export async function closeDay(v: Viewer, input: Close): Promise<Closed> {
  const { today } = v;
  const workspaceId = v.workspace.id;
  const userId = v.user.id;
  const log = await upsertLog(workspaceId, userId, today);
  const pick = (k: CloseNumber): number => {
    const n = input[k];
    return typeof n === "number" && Number.isFinite(n) ? n : (log[k] ?? 0);
  };
  const text = (k: CloseText): string | null => (k in input ? (input[k]?.trim() || null) : log[k]);
  const numbers = Object.fromEntries(CLOSE_NUMBERS.map((k) => [k, pick(k)])) as Record<(typeof CLOSE_NUMBERS)[number], number>;
  const extra = Object.fromEntries(CLOSE_EXTRA.map((k) => [k, pick(k)])) as Record<(typeof CLOSE_EXTRA)[number], number>;
  const firstClose = !log.eveningDoneAt;
  const closed = await closedDates(workspaceId, userId, { excludeRepaired: true });
  const streakDay = firstClose ? weeklyStreakDay(closed, today) : log.streakDay;
  const previousCash = log.cashCollected;

  await db
    .update(schema.dailyLogs)
    .set({ ...numbers, ...extra, start: text("start"), stop: text("stop"), keep: text("keep"), win: text("win"), gratitude: text("gratitude"), eveningDoneAt: log.eveningDoneAt ?? nowIso(), streakDay })
    .where(eq(schema.dailyLogs.id, log.id));

  const points = { close: 0, streak: 0, activity: 0 };
  if (firstClose) {
    if (await award({ workspaceId, userId }, "close", POINTS.close, "Closed the day", today)) points.close = POINTS.close;
    const bonus = streakBonus(streakDay);
    if (bonus && (await award({ workspaceId, userId }, "streak", bonus, `Streak day ${streakDay}`, today))) points.streak = bonus;
  }
  const seen = await todayActivity(workspaceId, userId, today);
  const activity = closeActivityPoints(numbers, { posts: seen.posts, dmsStarted: seen.dmsStarted, conversations: seen.conversations });
  await setActivityPoints({ workspaceId, userId }, today, activity.total, activity.lines.map((l) => l.label).join(", "));
  points.activity = activity.total;
  const cashDelta = numbers.cashCollected - previousCash;
  if (cashDelta !== 0) {
    const goal = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, userId), eq(schema.goals.primary, true)) });
    if (goal && goal.unit === "$") await db.update(schema.goals).set({ actual: Math.max(0, goal.actual + cashDelta) }).where(eq(schema.goals.id, goal.id));
  }
  return { firstClose, streakDay, points, activityLines: activity.lines.map((l) => `${l.label} +${l.points}`), cashDelta, log: (await db.query.dailyLogs.findFirst({ where: eq(schema.dailyLogs.id, log.id) }))! };
}

/** One ledger row per day for close activity, adjusted to the latest total. Zero total removes it. */
async function setActivityPoints(ctx: { workspaceId: string; userId: string }, today: string, total: number, labels: string): Promise<void> {
  const refId = `activity:${today}`;
  const existing = await db.query.pointsLedger.findFirst({ where: and(eq(schema.pointsLedger.userId, ctx.userId), eq(schema.pointsLedger.type, "dm"), eq(schema.pointsLedger.refId, refId)) });
  if (!total) {
    if (existing) await db.delete(schema.pointsLedger).where(eq(schema.pointsLedger.id, existing.id));
    return;
  }
  const reason = `Daily activity: ${labels}`;
  if (existing) {
    if (existing.points !== total) await db.update(schema.pointsLedger).set({ points: total, reason }).where(eq(schema.pointsLedger.id, existing.id));
  } else await award(ctx, "dm", total, reason, refId);
}

/** The month so far: cash collected over the month's logs, and the primary goal when it is in dollars. */
export async function monthCash(v: Viewer): Promise<{ month: string; cash: number; goal: { title: string; actual: number; target: number } | null }> {
  const month = v.today.slice(0, 7);
  const rows = await db.query.dailyLogs.findMany({ where: and(eq(schema.dailyLogs.userId, v.user.id), eq(schema.dailyLogs.workspaceId, v.workspace.id), sql`substr(${schema.dailyLogs.date}, 1, 7) = ${month}`) });
  const goal = await db.query.goals.findFirst({ where: and(eq(schema.goals.userId, v.user.id), eq(schema.goals.primary, true)) });
  return { month, cash: rows.reduce((a, r) => a + (r.cashCollected ?? 0), 0), goal: goal && goal.unit === "$" ? { title: goal.title, actual: goal.actual, target: goal.target } : null };
}

/** The day as the lock-in card shows it, for the connector's read. */
export async function lockInState(v: Viewer) {
  const [log, streak, points] = await Promise.all([logFor(v.workspace.id, v.user.id, v.today), streakFor(v.workspace.id, v.user.id, v.today), totalPoints(v.workspace.id, v.user.id)]);
  return { log: log ?? null, streak: streak.running, points };
}
