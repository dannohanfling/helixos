import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { hourInTz, todayInTz } from "@/lib/dates";
import { runningStreak, streakBonus, weeklyStreakDay } from "@/lib/engine/streak";
import { sendEmail } from "@/lib/email";

export type ReminderResult = { userId: string; email: string; kind: "morning" | "evening" | "comeback"; delivery: "sent" | "logged" };

/**
 * Decides who gets a nudge right now. Idempotent per hour: the cron can run every hour
 * and each person receives at most one morning and one evening email per day.
 */
export async function runReminders(now: Date = new Date(), force?: "morning" | "evening"): Promise<ReminderResult[]> {
  const out: ReminderResult[] = [];
  const workspaces = await db.query.workspaces.findMany();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  for (const ws of workspaces) {
    const today = todayInTz(ws.timezone, now);
    const hour = hourInTz(ws.timezone, now);
    const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, ws.id), eq(schema.memberships.role, "client")) });
    for (const m of members) {
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, m.userId) });
      if (!user) continue;
      const log = await db.query.dailyLogs.findFirst({ where: and(eq(schema.dailyLogs.userId, m.userId), eq(schema.dailyLogs.date, today)) });
      const logs = await db.query.dailyLogs.findMany({ where: eq(schema.dailyLogs.userId, m.userId) });
      const closed = new Set(logs.filter((l) => l.eveningDoneAt).map((l) => l.date));
      const streak = runningStreak(closed, today);
      const first = user.name.split(" ")[0];

      const wantsMorning = force === "morning" || (hour === m.reminderHour && !force);
      const wantsEvening = force === "evening" || (hour === m.eveningReminderHour && !force);

      if (wantsMorning && !log?.morningDoneAt) {
        const lastDate = logs.map((l) => l.date).sort().at(-1);
        const quietDays = lastDate ? Math.round((Date.parse(today) - Date.parse(lastDate)) / 86400000) : 0;
        const comeback = Boolean(lastDate) && quietDays >= 3;
        const subject = comeback ? `${first}, Mondays are restart day` : streak > 0 ? `Day ${streak + 1}? Lock in your top 3` : `${first}, lock in your day`;
        const text = comeback
          ? `Happens. The system doesn't punish pauses, it just resets the streak.\n\nDay 1 is 10 points. By Friday it's 310.\n\nLock in: ${appUrl}/today`
          : `Pick your top 3. Set your energy. 60 seconds, +10 points.\n\n${streak > 0 ? `Your ${streak}-day streak is alive. ` : ""}Lock in: ${appUrl}/today`;
        const delivery = await sendEmail(user.email, subject, text);
        out.push({ userId: user.id, email: user.email, kind: comeback ? "comeback" : "morning", delivery });
      }
      if (wantsEvening && !log?.eveningDoneAt) {
        const day = weeklyStreakDay(closed, today);
        const bonus = streakBonus(day);
        const subject = bonus ? `Close the day: +20 and a ${bonus}-point streak bonus` : `${first}, close the day`;
        const text = `Log your numbers. Name the win. It takes 90 seconds.\n\n${bonus ? `Today is streak day ${day}: +${bonus} on top of +20.\n\n` : ""}Close: ${appUrl}/today#close`;
        const delivery = await sendEmail(user.email, subject, text);
        out.push({ userId: user.id, email: user.email, kind: "evening", delivery });
      }
    }
  }
  return out;
}
