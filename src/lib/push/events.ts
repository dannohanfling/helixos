import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, hourInTz, todayInTz, wallTimeToUtc } from "@/lib/dates";
import { mondayOf } from "@/lib/colosseum";
import { coachFirstName } from "@/lib/queries/reports";
import { leaderboard } from "@/lib/queries/points";
import { rankUpFor } from "@/lib/engine/scenes";
import { INTENTIONS_HOUR, dueIntentions, dueWebinar, lastWeekPlace, type PushType } from "@/lib/engine/push";
import { intentionsDueFor } from "@/lib/queries/intentions";
import { totalPoints } from "@/lib/queries/points";
import { sendPush, type SendOutcome, type Transport } from "@/lib/push/send";
import { reportError } from "@/lib/report-error";

/**
 * The event pushes (H-767, plan H-877 B2), read from what's already stored, so no other part of HelixOS has to call in:
 * - rank up: the rank the app would celebrate on the next open (rankUpFor), once per rank;
 * - weekly intentions: Monday from 9 AM in the member's zone, while this week's aren't set;
 * - your webinar starts soon: the member's own scheduled webinar, 15 minutes before;
 * - a call booked with one of their contacts (by their bot or through GoHighLevel), in the half hour after it lands (H-1151 A);
 * - their Office Hours request marked covered by the coach, within a day of it (H-1151 A);
 * - Colosseum top 3: Monday from 9 AM, for last week's final standings, where the arena is on and they aren't hidden.
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

      // Rank up: the same rank the app's ceremony would play next, counting the kept rank (H-1088); the member's switch is off by default (H-767).
      const tier = rankUpFor(await totalPoints(ws.id, m.userId), m.celebratedTierLevel, m.rankKeptLevel);
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

      // A call booked with one of their contacts, in the half hour after it lands.
      const since = new Date(now.getTime() - 30 * 60_000).toISOString();
      const booked = await db.query.contacts.findMany({
        where: and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.userId, m.userId), isNotNull(schema.contacts.callBookedAt), gte(schema.contacts.callBookedAt, since)),
        columns: { id: true, callAt: true, callBookedAt: true },
      });
      for (const c of booked) {
        const at = c.callAt ? new Date(c.callAt) : null;
        const when = at && !Number.isNaN(at.getTime()) ? { day: at.toLocaleDateString("en-US", { weekday: "long", timeZone: tz }), time: at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) } : {};
        out.push({ type: "bot_call", outcome: await sendPush(who, "bot_call", `booked:${c.id}:${c.callBookedAt}`, when, { now, transport }) });
      }

      // Their Office Hours request marked covered, within a day of the coach's mark.
      const dayAgo = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 19).replace("T", " ");
      const covered = await db.query.officeHoursRequests.findMany({
        where: and(eq(schema.officeHoursRequests.workspaceId, ws.id), eq(schema.officeHoursRequests.userId, m.userId), eq(schema.officeHoursRequests.outcome, "covered"), gte(schema.officeHoursRequests.updatedAt, dayAgo)),
        columns: { id: true },
      });
      if (covered.length) {
        const coach = await coachFirstName(ws.id);
        for (const r of covered) out.push({ type: "coach_answer", outcome: await sendPush(who, "coach_answer", `ooh:${r.id}`, { coach }, { now, transport }) });
      }

      // Colosseum top 3: Monday morning, last week's final standings among the members the arena shows.
      if (ws.colosseumOn && !m.arenaHidden && weekday === 1 && hour >= INTENTIONS_HOUR && hour < INTENTIONS_HOUR + 2) {
        const thisMonday = mondayOf(today);
        const lastMonday = addDays(thisMonday, -7);
        const [fromLast, fromThis, shown] = await Promise.all([
          leaderboard(ws.id, `${lastMonday} 00:00:00`),
          leaderboard(ws.id, `${thisMonday} 00:00:00`),
          db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, ws.id), isNull(schema.memberships.removedAt), eq(schema.memberships.arenaHidden, false)), columns: { userId: true } }),
        ]);
        const sinceThis = new Map(fromThis.map((r) => [r.userId, Number(r.total)]));
        const inArena = new Set(shown.map((x) => x.userId));
        const week = fromLast.filter((r) => inArena.has(r.userId)).map((r) => ({ userId: r.userId, points: Number(r.total) - (sinceThis.get(r.userId) ?? 0) }));
        if (lastWeekPlace(week, m.userId)) out.push({ type: "colosseum", outcome: await sendPush(who, "colosseum", `colosseum:${lastMonday}`, {}, { now, transport }) });
      }
    } catch (e) {
      // One member's failure never stops the run.
      reportError(e, { job: "cron:push-events" });
    }
  }
  return out;
}
