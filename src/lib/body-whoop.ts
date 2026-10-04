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
import { activityRow, cycleRows, FROM_WHOOP, habitTick, measurementRows, recoveryRows, sleepRows, SYNC_UNFINISHED, syncWindowDays, type DailyRow, type WhoopCycle, type WhoopMeasurement, type WhoopRecovery, type WhoopSleep, type WhoopWorkout } from "@/lib/engine/body-whoop";
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

const usable = (d: schema.BodyDevice): string | null => {
  const access = open(d.accessToken);
  return access && d.expiresAt && Date.parse(d.expiresAt) - Date.now() > 60_000 ? access : null;
};

/**
 * A usable access token: the stored one, refreshed first when it's within a minute of expiring. WHOOP's refresh token works once
 * (rev 473): when two requests refresh together (webhooks arriving at once as the hour runs out), WHOOP refuses the second, so
 * a refused refresh waits for the token the other request stored, and uses that.
 */
async function tokenFor(dev: schema.BodyDevice): Promise<string> {
  const now = usable(dev);
  if (now) return now;
  const refresh = open(dev.refreshToken);
  if (!refresh) throw new WhoopError("expired");
  try {
    const t = await refreshTokens(refresh);
    await db.update(schema.bodyDevices).set({ accessToken: seal(t.accessToken), refreshToken: seal(t.refreshToken ?? refresh), expiresAt: t.expiresAt }).where(eq(schema.bodyDevices.id, dev.id));
    return t.accessToken;
  } catch (e) {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 750));
      const again = await db.query.bodyDevices.findFirst({ where: eq(schema.bodyDevices.id, dev.id) });
      const theirs = again && again.refreshToken !== dev.refreshToken ? usable(again) : null;
      if (theirs) return theirs;
    }
    throw e;
  }
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
  const missing = dates.filter((d) => !byDate.has(d));
  if (missing.length) {
    await db.insert(schema.bodySessions).values(missing.map((date) => ({ id: newId(), workspaceId, userId, date, routineId: null, routineName: FROM_WHOOP }))).onConflictDoNothing({ target: [schema.bodySessions.workspaceId, schema.bodySessions.userId, schema.bodySessions.date] });
    const made = await db.query.bodySessions.findMany({ columns: { id: true, date: true }, where: and(eq(schema.bodySessions.workspaceId, workspaceId), eq(schema.bodySessions.userId, userId), inArray(schema.bodySessions.date, missing)) });
    for (const m of made) byDate.set(m.date, m.id);
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
export async function applyWhoop(workspaceId: string, userId: string, tz: string, pulled: Pulled): Promise<{ nights: number; recoveries: number; cycles: number; activities: number; ticks: number; newWorkouts: number; newNights: number }> {
  const dateOf = (iso: string) => todayInTz(tz, new Date(iso));
  const timeOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  const daily: DailyRow[] = [...pulled.sleep.flatMap((s) => sleepRows(s, dateOf, timeOf)), ...pulled.recovery.flatMap((r) => recoveryRows(r, dateOf)), ...pulled.cycle.flatMap((c) => cycleRows(c, dateOf)), ...measurementRows(pulled.measurement ?? null, todayInTz(tz))];
  const readingIds = [...new Set(daily.map((d) => d.readingId))];
  // What's new to HelixOS, for the line Sync now shows: nights by date, workouts by WHOOP id.
  const nightsBefore = new Set<string>();
  const sleepDates = [...new Set(daily.filter((d) => d.key === "sleep_h").map((d) => d.date))];
  for (let i = 0; i < sleepDates.length; i += 200)
    for (const r of await db.query.bodyDaily.findMany({ columns: { date: true }, where: and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), and(eq(schema.bodyDaily.key, "sleep_h"), inArray(schema.bodyDaily.date, sleepDates.slice(i, i + 200)))) })) nightsBefore.add(r.date);
  // A WHOOP night replaces a manual night of the same date: the device measured it.
  const nightDates = [...new Set(daily.filter((d) => d.key === "sleep_h").map((d) => d.date))];
  const manualNights = nightDates.map((d) => `sleep:${d}`);
  const gone = [...readingIds, ...manualNights];
  for (let i = 0; i < gone.length; i += 200) await db.delete(schema.bodyDaily).where(and(and(eq(schema.bodyDaily.workspaceId, workspaceId), eq(schema.bodyDaily.userId, userId)), inArray(schema.bodyDaily.readingId, gone.slice(i, i + 200))));
  const rows = daily.map((d) => ({ id: newId(), workspaceId, userId, date: d.date, key: d.key, value: d.value, source: "whoop" as const, readingId: d.readingId, time: d.time }));
  for (let i = 0; i < rows.length; i += 400) await db.insert(schema.bodyDaily).values(rows.slice(i, i + 400));

  // One row per WHOOP workout: a record listed twice (pages that overlap while WHOOP is still scoring) lands once, the later.
  const acts = [...new Map(pulled.workout.map((w) => activityRow(w, dateOf)).filter((a): a is NonNullable<typeof a> => !!a).map((a) => [a.providerId, a])).values()];
  const ids = acts.map((a) => a.providerId);
  const actsBefore = new Set<string>();
  for (let i = 0; i < ids.length; i += 200)
    for (const r of await db.query.bodyActivities.findMany({ columns: { providerId: true }, where: and(and(eq(schema.bodyActivities.workspaceId, workspaceId), eq(schema.bodyActivities.userId, userId)), inArray(schema.bodyActivities.providerId, ids.slice(i, i + 200))) })) actsBefore.add(r.providerId ?? "");
  for (let i = 0; i < ids.length; i += 200) await db.delete(schema.bodyActivities).where(and(and(eq(schema.bodyActivities.workspaceId, workspaceId), eq(schema.bodyActivities.userId, userId)), inArray(schema.bodyActivities.providerId, ids.slice(i, i + 200))));
  if (acts.length) await db.insert(schema.bodyActivities).values(acts.map((a) => ({ id: newId(), workspaceId, userId, provider: "whoop" as const, ...a })));
  await attachToSessions(workspaceId, userId, [...new Set(acts.map((a) => a.date))]);

  // Habit auto-ticks (rev 196): a sport that is one of the member's habits ticks it for the day; a hand-logged value stays.
  const habits = (await db.query.bodyHabits.findMany({ where: and(eq(schema.bodyHabits.workspaceId, workspaceId), eq(schema.bodyHabits.userId, userId)) })).filter((h) => !h.archivedAt);
  let ticks = 0;
  const tickOf = acts.map((a) => ({ a, tick: habitTick(a.sport, a.minutes, habits) }));
  const tickHabits = [...new Set(tickOf.flatMap((x) => (x.tick ? [x.tick.habitId] : [])))];
  const tickDates = [...new Set(tickOf.flatMap((x) => (x.tick ? [x.a.date] : [])))];
  const logs = tickHabits.length ? await db.query.bodyHabitLogs.findMany({ where: and(inArray(schema.bodyHabitLogs.habitId, tickHabits), inArray(schema.bodyHabitLogs.date, tickDates)) }) : [];
  const logOf = new Map(logs.map((l) => [`${l.habitId}|${l.date}`, l]));
  for (const { a, tick } of tickOf) {
    if (!tick) continue;
    const have = logOf.get(`${tick.habitId}|${a.date}`);
    if (have && have.source === "manual") continue;
    if (have) await db.delete(schema.bodyHabitLogs).where(eq(schema.bodyHabitLogs.id, have.id));
    const row = { id: newId(), workspaceId, userId, habitId: tick.habitId, date: a.date, value: tick.value, source: "whoop" as const };
    await db.insert(schema.bodyHabitLogs).values(row);
    logOf.set(`${tick.habitId}|${a.date}`, { ...row, createdAt: nowIso() } as schema.BodyHabitLog);
    ticks++;
  }
  return { nights: nightDates.length, recoveries: pulled.recovery.length, cycles: pulled.cycle.length, activities: acts.length, ticks, newWorkouts: acts.filter((a) => !actsBefore.has(a.providerId)).length, newNights: sleepDates.filter((d) => !nightsBefore.has(d)).length };
}

/**
 * Pull from WHOOP and write it: `days` back, or by default from two days before the last sync that finished (rev 473). Errors
 * land on the row's lastError as a code, never with a token; a sync cut off part way leaves "unfinished" there, so the page says
 * it didn't finish instead of nothing.
 */
export async function syncWhoop(workspaceId: string, userId: string, tz: string, days?: number): Promise<Awaited<ReturnType<typeof applyWhoop>>> {
  const dev = await whoopDevice(workspaceId, userId);
  if (!dev) throw new WhoopError("denied");
  days ??= syncWindowDays(dev.lastSyncAt);
  await db.update(schema.bodyDevices).set({ lastError: SYNC_UNFINISHED }).where(eq(schema.bodyDevices.id, dev.id));
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

/**
 * The hourly catch-up (rev 473): every connected WHOOP whose last finished sync is older than 50 minutes pulls its window, one
 * member at a time, so a webhook that never came or failed lands within the hour. One member's failure is recorded on their row
 * and never stops the others.
 */
export async function catchUpWhoop(deadline: number): Promise<{ synced: number; failed: number; left: number }> {
  const due = (await db.query.bodyDevices.findMany({ where: eq(schema.bodyDevices.provider, "whoop") })).filter((d) => !d.lastSyncAt || Date.now() - Date.parse(d.lastSyncAt) > 50 * 60_000);
  let synced = 0;
  let failed = 0;
  for (const dev of due) {
    if (Date.now() > deadline) break;
    const mem = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, dev.workspaceId), eq(schema.memberships.userId, dev.userId)) });
    if (!mem?.bodyEnabled) continue;
    const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, dev.workspaceId) });
    try {
      await syncWhoop(dev.workspaceId, dev.userId, mem.timezone || ws?.timezone || "UTC");
      synced++;
    } catch {
      failed++;
    }
  }
  return { synced, failed, left: due.length - synced - failed };
}

/** A webhook: the member by WHOOP user id, the one resource fetched and written (a deletion removes it). True when handled. */
export async function handleWhoopEvent(event: { user_id?: number | string; id?: string | number; type?: string }): Promise<boolean> {
  if (event.user_id == null || event.id == null || !event.type) return false;
  // Every connection with this WHOOP id (rev 473): one person can connect the same WHOOP in two workspaces, and each gets it.
  const devs = await db.query.bodyDevices.findMany({ where: and(eq(schema.bodyDevices.provider, "whoop"), eq(schema.bodyDevices.providerUserId, String(event.user_id))) });
  if (!devs.length) return false;
  let handled = false;
  let failure: unknown = null;
  for (const dev of devs) {
    try {
      handled = (await handleFor(dev, event.type, String(event.id))) || handled;
    } catch (e) {
      failure = e;
    }
  }
  if (!handled && failure) throw failure;
  return handled;
}

async function handleFor(dev: schema.BodyDevice, type: string, id: string): Promise<boolean> {
  const mem = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, dev.workspaceId), eq(schema.memberships.userId, dev.userId)) });
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, dev.workspaceId) });
  const tz = mem?.timezone || ws?.timezone || "UTC";
  const [kind, verb] = type.split(".");
  if (verb === "deleted") {
    if (kind === "workout") {
      const gone = await db.query.bodyActivities.findFirst({ columns: { date: true }, where: and(eq(schema.bodyActivities.workspaceId, dev.workspaceId), eq(schema.bodyActivities.userId, dev.userId), eq(schema.bodyActivities.providerId, id)) });
      await db.delete(schema.bodyActivities).where(and(eq(schema.bodyActivities.workspaceId, dev.workspaceId), eq(schema.bodyActivities.userId, dev.userId), eq(schema.bodyActivities.providerId, id)));
      if (gone) await dropEmptyWhoopSession(dev.workspaceId, dev.userId, gone.date);
    } else await db.delete(schema.bodyDaily).where(and(eq(schema.bodyDaily.workspaceId, dev.workspaceId), eq(schema.bodyDaily.userId, dev.userId), eq(schema.bodyDaily.readingId, `whoop:${kind}:${id}`)));
    return true;
  }
  try {
    return await fetchOne(dev, tz, kind, id);
  } catch (e) {
    // A webhook that couldn't fetch its record says so on HumanOS settings; the hourly catch-up brings the record in.
    await db.update(schema.bodyDevices).set({ lastError: e instanceof WhoopError ? e.problem : "other" }).where(eq(schema.bodyDevices.id, dev.id));
    throw e;
  }
}

async function fetchOne(dev: schema.BodyDevice, tz: string, kind: string, id: string): Promise<boolean> {
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
