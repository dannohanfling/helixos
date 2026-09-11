import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, hourInTz, nowIso, todayInTz } from "@/lib/dates";
import { runningStreak, streakBonus, weeklyStreakDay } from "@/lib/engine/streak";
import { nextTier } from "@/lib/engine/tiers";
import { comebackCopy, eveningCopy, morningCopy } from "@/lib/engine/reminder-copy";
import { brandedEmail } from "@/lib/branded-email";
import { totalPoints } from "@/lib/queries/points";
import { sendEmail } from "@/lib/email";

/** The comeback email. Monday is restart day; on any other day the restart is today. Shared with the coach's nudge button. */
export function comebackEmail(first: string, hours: { morning: number; evening: number }, appUrl: string): { subject: string; text: string; html: string } {
  return brandedEmail(comebackCopy(first, hours), { base: appUrl });
}

/** A quiet client hears from us once, then not again for a week unless they come back. */
export const COMEBACK_EVERY_DAYS = 7;

export type ReminderResult = { userId: string; email: string; kind: "morning" | "evening" | "comeback"; delivery: "sent" | "logged" | "failed"; error?: string };

/** One bad address or one provider error must never take down the run: the failure is logged with the member and the loop goes on. */
async function deliver(out: ReminderResult[], m: { userId: string }, email: string, kind: ReminderResult["kind"], subject: string, text: string, html: string): Promise<ReminderResult["delivery"]> {
  try {
    const delivery = await sendEmail(email, subject, text, html);
    out.push({ userId: m.userId, email, kind, delivery });
    return delivery;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[reminders] ${kind} to member ${m.userId} failed: ${error}`);
    out.push({ userId: m.userId, email, kind, delivery: "failed", error });
    return "failed";
  }
}

/**
 * Decides who gets a nudge right now. Idempotent per hour: the cron can run every hour
 * and each person receives at most one morning and one evening email per day.
 */
export async function runReminders(now: Date = new Date(), force?: "morning" | "evening"): Promise<ReminderResult[]> {
  const out: ReminderResult[] = [];
  const workspaces = await db.query.workspaces.findMany();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  for (const ws of workspaces) {
    const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, ws.id), eq(schema.memberships.role, "client")) });
    for (const m of members) {
      const tz = m.timezone || ws.timezone;
      const today = todayInTz(tz, now);
      const hour = hourInTz(tz, now);
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
      if (!user) continue;
      const log = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, m.userId), eq(schema.dailyLogs.date, today)) });
      const logs = await db.query.dailyLogs.findMany({ where: eq(schema.dailyLogs.userId, m.userId) });
      const closed = new Set(logs.filter((l) => l.eveningDoneAt).map((l) => l.date));
      const streak = runningStreak(closed, today);
      const first = user.name.split(" ")[0];
      const hours = { morning: m.reminderHour, evening: m.eveningReminderHour };

      const wantsMorning = force === "morning" || (hour === m.reminderHour && !force);
      const wantsEvening = force === "evening" || (hour === m.eveningReminderHour && !force);

      if (wantsMorning && !log?.morningDoneAt) {
        const lastDate = logs.map((l) => l.date).sort().at(-1);
        const quietDays = lastDate ? Math.round((Date.parse(today) - Date.parse(lastDate)) / 86400000) : 0;
        const comeback = Boolean(lastDate) && quietDays >= 3;
        if (comeback) {
          const recently = m.lastComebackAt && (now.getTime() - new Date(m.lastComebackAt).getTime()) / 86400000 < COMEBACK_EVERY_DAYS;
          if (recently) continue;
          const c = comebackEmail(first, hours, appUrl);
          // Only a send that actually went out starts the week of quiet; a logged (no key) or failed delivery is tried again.
          if ((await deliver(out, m, user.email, "comeback", c.subject, c.text, c.html)) === "sent") {
            await db.update(schema.memberships).set({ lastComebackAt: nowIso() }).where(eq(schema.memberships.id, m.id));
          }
          continue;
        }
        // One true line the client does not already know: the streak, a streak that broke yesterday, or a rank within reach.
        const points = await totalPoints(ws.id, m.userId);
        const next = nextTier(points);
        const brokenYesterday = streak === 0 && closed.has(addDays(today, -2)) && !closed.has(addDays(today, -1));
        const e = brandedEmail(morningCopy({ first, streak, brokenYesterday, points, nextTier: next ? { name: next.name, minPoints: next.minPoints } : null, hours }), { base: appUrl });
        await deliver(out, m, user.email, "morning", e.subject, e.text, e.html);
      }
      if (wantsEvening && !log?.eveningDoneAt) {
        // The days already closed; the copy says what tonight's close makes it. The bonus is the weekly escalation for that close.
        const bonus = streakBonus(weeklyStreakDay(closed, today));
        const e = brandedEmail(eveningCopy({ first, streak, bonus, hours }), { base: appUrl });
        await deliver(out, m, user.email, "evening", e.subject, e.text, e.html);
      }
    }
  }
  return out;
}
