import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { hourInTz, todayInTz } from "@/lib/dates";
import { callsBetween } from "@/lib/calls";
import { callTimeLabel, dueCallStep, type CallStep } from "@/lib/engine/push";
import { sendPush, type SendOutcome, type Transport } from "@/lib/push/send";
import { reportError } from "@/lib/report-error";

/**
 * The live call reminders (H-771, plan H-877 B2), run by the push cron every 5 minutes: the morning of the call, 15 minutes
 * before, and "We're live" at the start. Only the calls this member can join (callsBetween with their level), only members
 * with a phone that has notifications on, clients only at launch (H-626). Outside the daily cap of 3; quiet hours and the member's switch still apply.
 */
export async function runCallPushes(now: Date = new Date(), transport?: Transport): Promise<{ step: CallStep; outcome: SendOutcome }[]> {
  const out: { step: CallStep; outcome: SendOutcome }[] = [];
  const devices = await db.query.pushDevices.findMany({ where: and(isNotNull(schema.pushDevices.token), isNull(schema.pushDevices.disabledAt)) });
  const ids = [...new Set(devices.map((d) => d.membershipId))];
  if (!ids.length) return out;
  const members = await db.query.memberships.findMany({ where: and(inArray(schema.memberships.id, ids), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  const from = new Date(now.getTime() - 15 * 60_000);
  const to = new Date(now.getTime() + 18 * 3_600_000);
  for (const m of members) {
    try {
      const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, m.workspaceId) });
      if (!ws) continue;
      const tz = m.timezone || ws.timezone;
      const today = todayInTz(tz, now);
      const hour = hourInTz(tz, now);
      const calls = await callsBetween(ws.id, from, to, { role: m.role, programTier: m.programTier });
      for (const occ of calls) {
        const step = dueCallStep(occ.startIso, now, { today, hour, callDate: todayInTz(tz, new Date(occ.startIso)) });
        if (!step) continue;
        const key = `${occ.call.id}:${occ.startIso}:${step}`;
        out.push({ step, outcome: await sendPush({ id: m.id, userId: m.userId, tz }, "call", key, { step, time: callTimeLabel(occ.startIso, tz) }, { now, transport }) });
      }
    } catch (e) {
      // One member's failure never stops the run.
      reportError(e, { job: "cron:push-calls" });
    }
  }
  return out;
}
