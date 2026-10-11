/**
 * Activities logged by the member (rev 653): a walk, a run, a sauna, said to Claude or a timed exercise from Training. Each lands in
 * the day's activities beside WHOOP's (provider "manual", its own id as the provider's), and ticks a matching habit by the same
 * rule WHOOP's workouts use. A habit value the member typed stays. Every read and write is the member's own.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { habitTick } from "@/lib/engine/body-whoop";

export const ACTIVITY_TYPES = ["walk", "run", "bike", "swim", "sauna", "sport", "other"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
/** The sport name an activity is stored under: WHOOP's own words, so the habit rule and the Training list read it the same. */
const SPORT: Record<ActivityType, string> = { walk: "Walking", run: "Running", bike: "Cycling", swim: "Swimming", sauna: "Sauna", sport: "Sport", other: "Activity" };

export type NewActivity = { date: string; type: ActivityType; minutes: number; distanceM?: number | null; intensity?: "easy" | "moderate" | "hard" | null; sport?: string | null; sessionId?: string | null };

/** One activity in; the habit it ticked, if any. `sport` names it (a timed exercise's name, or "Tennis" for a sport). */
export async function logActivity(workspaceId: string, userId: string, a: NewActivity): Promise<{ id: string; sport: string; habit: string | null }> {
  const id = newId();
  const sport = (a.sport?.trim() || SPORT[a.type]).slice(0, 60);
  await db.insert(schema.bodyActivities).values({ id, workspaceId, userId, provider: "manual", providerId: id, date: a.date, sport, minutes: Math.round(a.minutes * 10) / 10, distanceM: a.distanceM && a.distanceM > 0 ? Math.round(a.distanceM) : null, intensity: a.intensity ?? null, sessionId: a.sessionId ?? null });
  const habits = (await db.query.bodyHabits.findMany({ where: and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId)) })).filter((h) => !h.archivedAt);
  // The type's own word first ("Walking" ticks Walk / steps), then the name it was given.
  const tick = habitTick(SPORT[a.type], a.minutes, habits) ?? habitTick(sport, a.minutes, habits);
  if (!tick) return { id, sport, habit: null };
  const habit = habits.find((h) => h.id === tick.habitId)!;
  const have = await db.query.bodyHabitLogs.findFirst({ where: and(eq(schema.bodyHabitLogs.workspaceId, workspaceId), eq(schema.bodyHabitLogs.userId, userId), eq(schema.bodyHabitLogs.habitId, tick.habitId), eq(schema.bodyHabitLogs.date, a.date)) });
  if (have?.source === "manual") return { id, sport, habit: habit.name };
  // A minutes habit adds up the day's walks; a done habit is simply done.
  const value = habit.kind === "minutes" && have ? have.value + tick.value : tick.value;
  if (have) await db.update(schema.bodyHabitLogs).set({ value, source: "manual" }).where(eq(schema.bodyHabitLogs.id, have.id));
  else await db.insert(schema.bodyHabitLogs).values({ id: newId(), workspaceId, userId, habitId: tick.habitId, date: a.date, value, source: "manual" });
  return { id, sport, habit: habit.name };
}
