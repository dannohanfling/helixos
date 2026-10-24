import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { hourInTz, todayInTz } from "@/lib/dates";
import { streakFor } from "@/lib/queries/daily";
import { dueDaily, type PushType } from "@/lib/engine/push";
import { sendPush, type SendOutcome, type Transport } from "@/lib/push/send";
import { reportError } from "@/lib/report-error";
import { arenaNudgeFor } from "@/lib/arena";

/**
 * The daily pushes (H-767), run by the push cron every 5 minutes: morning lock-in, evening close and the streak waiting on
 * you, for clients with a phone that has notifications on. The words never mention anything they logged; HumanOS is never
 * read here. Each goes once a day per member (push_sends), so the cron can run as often as it likes.
 */
export async function runDailyPushes(now: Date = new Date(), transport?: Transport): Promise<{ type: PushType; outcome: SendOutcome }[]> {
  const out: { type: PushType; outcome: SendOutcome }[] = [];
  const devices = await db.query.pushDevices.findMany({ where: and(isNotNull(schema.pushDevices.token), isNull(schema.pushDevices.disabledAt)) });
  const ids = [...new Set(devices.map((d) => d.membershipId))];
  if (!ids.length) return out;
  const members = await db.query.memberships.findMany({ where: and(inArray(schema.memberships.id, ids), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  for (const m of members) {
    try {
      const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, m.workspaceId) });
      if (!ws) continue;
      const tz = m.timezone || ws.timezone;
      const today = todayInTz(tz, now);
      const hour = hourInTz(tz, now);
      const log = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, m.userId), eq(schema.dailyLogs.date, today)) });
      const read = await streakFor(ws.id, m.userId, { today, hour, tz, days: m.workDays });
      const due = dueDaily({
        hour,
        today,
        morningHour: m.reminderHour,
        eveningHour: m.eveningReminderHour,
        lockedIn: Boolean(log?.morningDoneAt),
        closed: Boolean(log?.eveningDoneAt),
        activeToday: read.activity.active.has(today),
        streak: read.running,
      });
      // 30 Days in the Arena (PR C): the evening push carries the Arena line when the coach has turned the nudge on.
      const arena = due.some((d) => d.type === "evening") ? await arenaNudgeFor(ws.id, m.userId, m.id, now) : null;
      for (const d of due) out.push({ type: d.type, outcome: await sendPush({ id: m.id, userId: m.userId, tz }, d.type, d.key, { streak: d.streak, arena: d.type === "evening" ? arena : null }, { now, transport }) });
    } catch (e) {
      // One member's failure never stops the run.
      reportError(e, { job: "cron:push-daily" });
    }
  }
  return out;
}
