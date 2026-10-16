/**
 * The streak's writes (H-289 §3, §4): the settle that pays an active day whose bonus never landed, and the recount the coach
 * reads as a dry run and applies once on Coach → Late close-outs. Both pay through award(), one row a day (the ledger's unique
 * (user, "streak", date)), so nothing is ever paid twice and nothing is taken back.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, hourInTz, todayInTz } from "@/lib/dates";
import { SETTLE_DAYS, SEVEN_DAY_STREAK_SINCE, activeDaysOf, handCreditedDate, initialsOf, planRecount, streakDayOf, unpaidBonuses, type RecountMember, type RecountPlan } from "@/lib/engine/streak";
import { award } from "@/lib/queries/points";
import { paidStreakDays, streakFor, type StreakWho } from "@/lib/queries/daily";

/**
 * Pays the bonus for each active day in the last SETTLE_DAYS (never before the seven-day streak began, never the day the streak
 * is read as of) that has no streak row yet: a day the member was active on but never closed. Returns the points paid.
 */
export async function settleStreak(workspaceId: string, userId: string, who: StreakWho): Promise<number> {
  const [s, paid] = await Promise.all([streakFor(workspaceId, userId, who), paidStreakDays(workspaceId, userId)]);
  const through = addDays(s.asOf, -1);
  const from = [SEVEN_DAY_STREAK_SINCE, addDays(through, -(SETTLE_DAYS - 1))].sort().at(-1)!;
  if (through < from) return 0;
  let total = 0;
  for (const { date, bonus } of unpaidBonuses(s.activity, s.days, paid, from, through)) {
    if (await award({ workspaceId, userId }, "streak", bonus.points, bonus.reason, date)) total += bonus.points;
  }
  return total;
}

/** Every client of the workspace as the recount reads them: their activity, the days paid, the days credited by hand. */
export async function recountMembers(workspaceId: string, workspaceTz: string, now: Date = new Date()): Promise<RecountMember[]> {
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  if (!members.length) return [];
  const ids = members.map((m) => m.userId);
  const [users, rows, logs] = await Promise.all([
    db.query.users.findMany({ where: inArray(schema.users.id, ids) }),
    db
      .select({ userId: schema.pointsLedger.userId, type: schema.pointsLedger.type, points: schema.pointsLedger.points, refId: schema.pointsLedger.refId, adjustedBy: schema.pointsLedger.adjustedBy, reason: schema.pointsLedger.reason, createdAt: schema.pointsLedger.createdAt })
      .from(schema.pointsLedger)
      .where(and(eq(schema.pointsLedger.workspaceId, workspaceId), inArray(schema.pointsLedger.userId, ids))),
    db
      .select({ userId: schema.dailyLogs.userId, date: schema.dailyLogs.date, morningDoneAt: schema.dailyLogs.morningDoneAt, eveningDoneAt: schema.dailyLogs.eveningDoneAt, repairedAt: schema.dailyLogs.repairedAt })
      .from(schema.dailyLogs)
      .where(and(eq(schema.dailyLogs.workspaceId, workspaceId), inArray(schema.dailyLogs.userId, ids))),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return members.map((m) => {
    const mine = rows.filter((r) => r.userId === m.userId);
    const tz = m.timezone || workspaceTz;
    const today = todayInTz(tz, now);
    const activity = activeDaysOf(mine, logs.filter((l) => l.userId === m.userId), tz);
    const handPaid = new Set<string>();
    for (const r of mine) {
      if (!r.adjustedBy) continue;
      const d = handCreditedDate(r.reason, r.createdAt);
      if (d) handPaid.add(d);
    }
    return {
      userId: m.userId,
      initials: initialsOf(nameOf.get(m.userId) ?? ""),
      days: m.workDays,
      activity,
      paid: new Set(mine.filter((r) => r.type === "streak" && r.refId).map((r) => r.refId!)),
      handPaid,
      asOf: streakDayOf(activity.active, today, hourInTz(tz, now)),
    };
  });
}

/** The dry run: the table on the coach's page, nothing written. */
export async function recountDryRun(workspaceId: string, workspaceTz: string, now: Date = new Date()): Promise<RecountPlan> {
  return planRecount(await recountMembers(workspaceId, workspaceTz, now));
}

/**
 * The Apply (the coach's tap is the approval, H-289 §4): the missing days paid through the normal points path, "Streak recount:
 * {date}", one row a day, never twice (a rerun finds every day paid and adds nothing), never taking anything back. Every client
 * then carries what it added them (0 for most), so Today can say so once.
 */
export async function applyRecount(workspaceId: string, workspaceTz: string, now: Date = new Date()): Promise<{ members: number; days: number; points: number }> {
  const plan = planRecount(await recountMembers(workspaceId, workspaceTz, now));
  const out = { members: 0, days: 0, points: 0 };
  for (const row of plan.rows) {
    let points = 0;
    let days = 0;
    for (const x of row.add) {
      if (await award({ workspaceId, userId: row.userId }, "streak", x.points, x.reason, x.date)) {
        points += x.points;
        days += 1;
      }
    }
    if (points) out.members += 1;
    out.days += days;
    out.points += points;
    await db
      .update(schema.memberships)
      .set({ streakRecountPoints: sql`coalesce(${schema.memberships.streakRecountPoints}, 0) + ${points}` })
      .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, row.userId), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)));
  }
  return out;
}

/** Whether any client of the workspace has been through the recount (the Apply ran at least once). */
export async function recountApplied(workspaceId: string): Promise<boolean> {
  const row = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client"), isNotNull(schema.memberships.streakRecountPoints)) });
  return Boolean(row);
}
