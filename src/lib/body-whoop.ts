/**
 * WHOOP's connection and sync (B6, rev 237 phase 11): the member's device row (tokens sealed at rest), a pull of the last
 * weeks on connect and on "Sync now", and one record on a webhook. What lands: nights and recoveries as `body_daily` rows with
 * source `whoop` (a manual night of the same date gives way), the day's strain, every workout as an activity, and a habit
 * ticked by its sport with source `whoop`, never over a hand-logged value. Nothing of a token or a secret is logged.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { open, seal } from "@/lib/crypto";
import { addDays, nowIso, todayInTz } from "@/lib/dates";
import { activityRow, cycleRows, FROM_WHOOP, habitTick, measurementRows, recoveryRows, sleepRows, type DailyRow, type WhoopCycle, type WhoopMeasurement, type WhoopRecovery, type WhoopSleep, type WhoopWorkout } from "@/lib/engine/body-whoop";
import { newId } from "@/lib/ids";
import { apiAll, apiGet, refreshTokens, WhoopError, type Tokens } from "@/lib/whoop";

const own = (workspaceId: string, userId: string) => and(and(eq(schema.bodyDevices.workspaceId, workspaceId), eq(schema.bodyDevices.userId, userId)), eq(schema.bodyDevices.provider, "whoop"));

export async function whoopDevice(workspaceId: string, userId: string): Promise<schema.BodyDevice | null> {
  return (await db.query.bodyDevices.findFirst({ where: own(workspaceId, userId) })) ?? null;
}

/** Store the tokens sealed, then read the member's WHOOP id with them. */
export async function connectWhoop(workspaceId: string, userId: string, t: Tokens): Promise<schema.BodyDevice> {
  const values = { accessToken: seal(t.accessToken), refreshToken: seal(t.refreshToken), expiresAt: t.expiresAt, scopes: t.scopes, connectedAt: nowIso(), lastError: null };
  const have = await whoopDevice(workspaceId, userId);
  if (have) await db.update(schema.bodyDevices).set(values).where(eq(schema.bodyDevices.id, have.id));
  else await db.insert(schema.bodyDevices).values({ id: newId(), workspaceId, userId, provider: "whoop", ...values });
  const dev = (await whoopDevice(workspaceId, userId))!;
  const profile = await apiGet<{ user_id?: number | string } | null>(t.accessToken, "/user/profile/basic").catch(() => null);
  if (profile?.user_id != null) await db.update(schema.bodyDevices).set({ providerUserId: String(profile.user_id) }).where(eq(schema.bodyDevices.id, dev.id));
  return (await whoopDevice(workspaceId, userId))!;
}

export async function disconnectWhoop(workspaceId: string, userId: string): Promise<void> {
  await db.delete(schema.bodyDevices).where(own(workspaceId, userId));
}

/** A usable access token: the stored one, refreshed first when it's within a minute of expiring. */
async function tokenFor(dev: schema.BodyDevice): Promise<string> {
  const access = open(dev.accessToken);
  const refresh = open(dev.refreshToken);
  const fresh = access && dev.expiresAt && Date.parse(dev.expiresAt) - Date.now() > 60_000;
  if (fresh) return access;
  if (!refresh) throw new WhoopError("expired");
  const t = await refreshTokens(refresh);
  await db.update(schema.bodyDevices).set({ accessToken: seal(t.accessToken), refreshToken: seal(t.refreshToken ?? refresh), expiresAt: t.expiresAt }).where(eq(schema.bodyDevices.id, dev.id));
  return t.accessToken;
}

type Pulled = { sleep: WhoopSleep[]; recovery: WhoopRecovery[]; cycle: WhoopCycle[]; workout: WhoopWorkout[]; measurement?: WhoopMeasurement | null };

/**
 * Phase 16b: a workout sits under the day's Training session. A day with a session (a logged routine, or sets) takes it; a day
 * without gets one session named "From WHOOP", once, and every workout of that day attaches to it. Re-syncs re-attach, never add.
 */
async function attachToSessions(workspaceId: string, userId: string, dates: string[]): Promise<void> {
  if (!dates.length) return;
  const have = await db.query.bodySessions.findMany({ columns: { id: true, date: true }, where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), inArray(schema.bodySessions.date, dates)) });
  const byDate = new Map(have.map((s) => [s.date, s.id]));
  for (const date of dates) {
    if (byDate.has(date)) continue;
    await db.insert(schema.bodySessions).values({ id: newId(), workspaceId, userId, date, routineId: null, routineName: FROM_WHOOP }).onConflictDoNothing({ target: [schema.bodySessions.workspaceId, schema.bodySessions.userId, schema.bodySessions.date] });
    const made = await db.query.bodySessions.findFirst({ columns: { id: true }, where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), eq(schema.bodySessions.date, date)) });
    if (made) byDate.set(date, made.id);
  }
  for (const [date, sessionId] of byDate) await db.update(schema.bodyActivities).set({ sessionId }).where(and(eq(schema.bodyActivities.workspaceId, workspaceId), eq(schema.bodyActivities.userId, userId), eq(schema.bodyActivities.date, date)));
}

/** A "From WHOOP" session with no sets and no workouts left under it goes too (a workout deleted on the device). */
async function dropEmptyWhoopSession(workspaceId: string, userId: string, date: string): Promise<void> {
  const s = await db.query.bodySessions.findFirst({ where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), eq(schema.bodySessions.date, date)) });
  if (!s || s.routineName !== FROM_WHOOP) return;
  const [set, act] = await Promise.all([
    db.query.bodySets.findFirst({ columns: { id: true }, where: eq(schema.bodySets.sessionId, s.id) }),
    db.query.bodyActivities.findFirst({ columns: { id: true }, where: eq(schema.bodyActivities.sessionId, s.id) }),
  ]);
  if (!set && !act) await db.delete(schema.bodySessions).where(eq(schema.bodySessions.id, s.id));
}

/** Write what the device gave: daily rows by reading id (replaced), activities by provider id (replaced), habit ticks never over a hand-logged value. */
export async function applyWhoop(workspaceId: string, userId: string, tz: string, pulled: Pulled): Promise<{ nights: number; recoveries: number; cycles: number; activities: number; ticks: number }> {
  const dateOf = (iso: string) => todayInTz(tz, new Date(iso));
  const timeOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  const daily: DailyRow[] = [...pulled.sleep.flatMap((s) => sleepRows(s, dateOf, timeOf)), ...pulled.recovery.flatMap((r) => recoveryRows(r, dateOf)), ...pulled.cycle.flatMap((c) => cycleRows(c, dateOf)), ...measurementRows(pulled.measurement ?? null, todayInTz(tz))];
  const readingIds = [...new Set(daily.map((d) => d.readingId))];
  // A WHOOP night replaces a manual night of the same date: the device measured it.
  const nightDates = [...new Set(daily.filter((d) => d.key === "sleep_h").map((d) => d.date))];
  const manualNights = nightDates.map((d) => `sleep:${d}`);
  const gone = [...readingIds, ...manualNights];
  for (let i = 0; i < gone.length; i += 200) await db.delete(schema.bodyDaily).where(and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), inArray(schema.bodyDaily.readingId, gone.slice(i, i + 200))));
  const rows = daily.map((d) => ({ id: newId(), workspaceId, userId, date: d.date, key: d.key, value: d.value, source: "whoop" as const, readingId: d.readingId, time: d.time }));
  for (let i = 0; i < rows.length; i += 400) await db.insert(schema.bodyDaily).values(rows.slice(i, i + 400));

  const acts = pulled.workout.map((w) => activityRow(w, dateOf)).filter((a): a is NonNullable<typeof a> => !!a);
  const ids = acts.map((a) => a.providerId);
  for (let i = 0; i < ids.length; i += 200) await db.delete(schema.bodyActivities).where(and(and(eq(schema.bodyActivities.workspaceId, workspaceId), eq(schema.bodyActivities.userId, userId)), inArray(schema.bodyActivities.providerId, ids.slice(i, i + 200))));
  if (acts.length) await db.insert(schema.bodyActivities).values(acts.map((a) => ({ id: newId(), workspaceId, userId, provider: "whoop" as const, ...a })));
  await attachToSessions(workspaceId, userId, [...new Set(acts.map((a) => a.date))]);

  // Habit auto-ticks (rev 196): a sport that is one of the member's habits ticks it for the day; a hand-logged value stays.
  const habits = (await db.query.bodyHabits.findMany({ where: and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId)) })).filter((h) => !h.archivedAt);
  let ticks = 0;
  for (const a of acts) {
    const tick = habitTick(a.sport, a.minutes, habits);
    if (!tick) continue;
    const have = await db.query.bodyHabitLogs.findFirst({ where: and(eq(schema.bodyHabitLogs.habitId, tick.habitId), eq(schema.bodyHabitLogs.date, a.date)) });
    if (have && have.source === "manual") continue;
    if (have) await db.delete(schema.bodyHabitLogs).where(eq(schema.bodyHabitLogs.id, have.id));
    await db.insert(schema.bodyHabitLogs).values({ id: newId(), workspaceId, userId, habitId: tick.habitId, date: a.date, value: tick.value, source: "whoop" });
    ticks++;
  }
  return { nights: nightDates.length, recoveries: pulled.recovery.length, cycles: pulled.cycle.length, activities: acts.length, ticks };
}

/** Pull the last `days` days from WHOOP and write them. Errors land on the row's lastError in plain words, never with a token. */
export async function syncWhoop(workspaceId: string, userId: string, tz: string, days = 30): Promise<ReturnType<typeof applyWhoop>> {
  const dev = await whoopDevice(workspaceId, userId);
  if (!dev) throw new WhoopError("denied");
  try {
    const token = await tokenFor(dev);
    const start = `${addDays(todayInTz(tz), -days)}T00:00:00.000Z`;
    const [sleep, recovery, cycle, workout, measurement] = await Promise.all([apiAll<WhoopSleep>(token, "/activity/sleep", start), apiAll<WhoopRecovery>(token, "/recovery", start), apiAll<WhoopCycle>(token, "/cycle", start), apiAll<WhoopWorkout>(token, "/activity/workout", start), apiGet<WhoopMeasurement | null>(token, "/user/measurement/body").catch(() => null)]);
    const result = await applyWhoop(workspaceId, userId, tz, { sleep, recovery, cycle, workout, measurement });
    await db.update(schema.bodyDevices).set({ lastSyncAt: nowIso(), lastError: null }).where(eq(schema.bodyDevices.id, dev.id));
    return result;
  } catch (e) {
    await db.update(schema.bodyDevices).set({ lastError: e instanceof WhoopError ? e.problem : "other" }).where(eq(schema.bodyDevices.id, dev.id));
    throw e;
  }
}

/** A webhook: the member by WHOOP user id, the one resource fetched and written (a deletion removes it). True when handled. */
export async function handleWhoopEvent(event: { user_id?: number | string; id?: string | number; type?: string }): Promise<boolean> {
  if (event.user_id == null || event.id == null || !event.type) return false;
  const dev = await db.query.bodyDevices.findFirst({ where: and(eq(schema.bodyDevices.provider, "whoop"), eq(schema.bodyDevices.providerUserId, String(event.user_id))) });
  if (!dev) return false;
  const mem = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, dev.workspaceId), eq(schema.memberships.userId, dev.userId)) });
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, dev.workspaceId) });
  const tz = mem?.timezone || ws?.timezone || "UTC";
  const [kind, verb] = event.type.split(".");
  const id = String(event.id);
  if (verb === "deleted") {
    if (kind === "workout") {
      const gone = await db.query.bodyActivities.findFirst({ columns: { date: true }, where: and(eq(schema.bodyActivities.workspaceId, dev.workspaceId), eq(schema.bodyActivities.userId, dev.userId), eq(schema.bodyActivities.providerId, id)) });
      await db.delete(schema.bodyActivities).where(and(eq(schema.bodyActivities.workspaceId, dev.workspaceId), eq(schema.bodyActivities.userId, dev.userId), eq(schema.bodyActivities.providerId, id)));
      if (gone) await dropEmptyWhoopSession(dev.workspaceId, dev.userId, gone.date);
    } else await db.delete(schema.bodyDaily).where(and(eq(schema.bodyDaily.workspaceId, dev.workspaceId), eq(schema.bodyDaily.userId, dev.userId), eq(schema.bodyDaily.readingId, `whoop:${kind}:${id}`)));
    return true;
  }
  const token = await tokenFor(dev);
  const path = kind === "workout" ? `/activity/workout/${id}` : kind === "sleep" ? `/activity/sleep/${id}` : kind === "recovery" ? `/recovery/${id}` : null;
  if (!path) return false;
  const rec = await apiGet<Record<string, unknown> | null>(token, path);
  if (!rec) return false;
  const pulled: Pulled = { sleep: [], recovery: [], cycle: [], workout: [] };
  if (kind === "workout") pulled.workout = [rec as WhoopWorkout];
  else if (kind === "sleep") pulled.sleep = [rec as WhoopSleep];
  else pulled.recovery = [rec as WhoopRecovery];
  await applyWhoop(dev.workspaceId, dev.userId, tz, pulled);
  await db.update(schema.bodyDevices).set({ lastSyncAt: nowIso(), lastError: null }).where(eq(schema.bodyDevices.id, dev.id));
  return true;
}
