import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, hourInTz, todayInTz, wallTimeToUtc } from "@/lib/dates";
import { rankUpFor } from "@/lib/engine/scenes";
import { dueIntentions, dueWebinar, type PushType } from "@/lib/engine/push";
import { intentionsDueFor } from "@/lib/queries/intentions";
import { totalPoints } from "@/lib/queries/points";
import { sendPush, type SendOutcome, type Transport } from "@/lib/push/send";
import { reportError } from "@/lib/report-error";

/**
 * The event pushes (H-767, plan H-877 B2), read from what's already stored, so no other part of HelixOS has to call in:
 * - rank up: the rank the app would celebrate on the next open (rankUpFor), once per rank;
 * - weekly intentions: Monday from 9 AM in the member's zone, while this week's aren't set;
 * - your webinar starts soon: the member's own scheduled webinar, 15 minutes before.
 * Clients only at launch (H-626). Each once (push_sends), inside the daily cap of 3, with the member's switches and quiet hours.
 */
export async function runEventPushes(now: Date = new Date(), transport?: Transport): Promise<{ type: PushType; outcome: SendOutcome }[]> {
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
      const who = { id: m.id, userId: m.userId, tz };
      const today = todayInTz(tz, now);
      const hour = hourInTz(tz, now);

      // Rank up: the same rank the app's ceremony would play next; the member's switch is off by default (H-767).
      const tier = rankUpFor(await totalPoints(ws.id, m.userId), m.celebratedTierLevel);
      if (tier) out.push({ type: "rank_up", outcome: await sendPush(who, "rank_up", `rank:${tier.level}`, { rank: tier.name }, { now, transport }) });

      // Weekly intentions: Monday morning, only while the week is still to set.
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      if (weekday === 1 && dueIntentions({ weekday, hour, weekDue: (await intentionsDueFor(ws.id, m.userId, today)).includes("week") })) {
        out.push({ type: "intentions", outcome: await sendPush(who, "intentions", `intentions:${today}`, {}, { now, transport }) });
      }

      // The member's own webinars set for today or tomorrow (a late-night one can start just after midnight); the time is their wall time unless it carries a zone.
      const soon = await db.query.webinars.findMany({
        where: and(eq(schema.webinars.workspaceId, ws.id), eq(schema.webinars.userId, m.userId), isNotNull(schema.webinars.scheduledAt), gte(schema.webinars.scheduledAt, today), lte(schema.webinars.scheduledAt, `${addDays(today, 1)}~`)),
        columns: { id: true, scheduledAt: true },
      });
      for (const w of soon) {
        const at = w.scheduledAt ? wallTimeToUtc(w.scheduledAt, tz) : null;
        if (at && dueWebinar(at, now)) out.push({ type: "webinar", outcome: await sendPush(who, "webinar", `webinar:${w.id}:${at}`, {}, { now, transport }) });
      }
    } catch (e) {
      // One member's failure never stops the run.
      reportError(e, { job: "cron:push-events" });
    }
  }
  return out;
}
