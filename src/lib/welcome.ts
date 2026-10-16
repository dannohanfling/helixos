/**
 * The Daily welcome's read and its one write (H-312, plan H-314, reading A): the first time a member opens HelixOS on their own
 * day, the day's log is marked opened (opening counts as showing up), the settle pays today's streak bonus through the ledger
 * as a normal row, the numbers are read, and the card plays. Once a day on any device (memberships.welcome_shown_on). Never
 * for a coach on /coach pages, never while a coach is switched into a client, never for a team member, never on the member's
 * first day (Today greets them then), and the connector never shows it.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { addDays, nowIso, startOfWeek } from "@/lib/dates";
import { sceneLookFor } from "@/lib/engine/board-view";
import { welcomeCard, type WelcomeCard } from "@/lib/engine/welcome";
import { upsertLog } from "@/lib/daily-core";
import { logFor, streakFor, streakPaidBetween } from "@/lib/queries/daily";
import { totalPoints } from "@/lib/queries/points";
import { settleStreak } from "@/lib/streak";

export function welcomeDue(v: Viewer, path: string): boolean {
  if (v.switchedInto || v.team) return false;
  if (v.role === "coach" && (path === "/coach" || path.startsWith("/coach/"))) return false;
  if (v.membership.startedAt >= v.today) return false;
  return (v.membership.welcomeShownOn ?? "") < v.today;
}

/** The card for this open, or null when it isn't due. Marks the day opened and the welcome shown before it reads. */
export async function welcomeFor(v: Viewer, path: string): Promise<WelcomeCard | null> {
  if (!welcomeDue(v, path)) return null;
  const workspaceId = v.workspace.id;
  const userId = v.user.id;
  const who = { today: v.today, hour: v.hour, tz: v.tz, days: v.membership.workDays };
  // Shown now, on this day, before anything else: a second device opened at the same minute may show it too, no more.
  await db.update(schema.memberships).set({ welcomeShownOn: v.today }).where(and(eq(schema.memberships.id, v.membership.id), isNull(schema.memberships.removedAt)));
  const before = await streakFor(workspaceId, userId, who);
  const wasActiveToday = before.activity.active.has(v.today);
  const log = await upsertLog(workspaceId, userId, v.today);
  if (!log.openedAt) await db.update(schema.dailyLogs).set({ openedAt: nowIso() }).where(eq(schema.dailyLogs.id, log.id));
  // Opening counts as showing up: the day is active now, and its bonus lands through the ledger (never twice).
  await settleStreak(workspaceId, userId, who, { includeToday: true });
  const monday = startOfWeek(v.today);
  const [s, paid, points, todayLog] = await Promise.all([
    streakFor(workspaceId, userId, who),
    streakPaidBetween(workspaceId, userId, monday, addDays(monday, 6)),
    totalPoints(workspaceId, userId),
    logFor(workspaceId, userId, v.today),
  ]);
  const todayBonus = paid.get(v.today) ?? 0;
  return welcomeCard({
    look: sceneLookFor(v.membership.sceneLook, v.hour),
    first: v.user.name.split(" ")[0] ?? "",
    today: v.today,
    days: v.membership.workDays,
    active: s.activity.active,
    ladder: s.activity.ladder,
    paid,
    streak: s.running,
    points,
    todayBonus,
    wasActiveToday,
    lockedIn: Boolean(todayLog?.morningDoneAt),
  });
}
