/**
 * WHOOP (B6, rev 237 phase 11): the device's records mapped onto Body's own shapes, pure. A night becomes a `body_daily` reading
 * (hours asleep and the performance score) on the morning it ended; a recovery gives the recovery score, resting heart rate and
 * HRV; a cycle gives the day's strain; a workout becomes an activity by its sport, and a sport that matches one of the member's
 * habits by name ticks it for the day with its minutes. The webhook signature check lives here too, so a test can pin it.
 * The API's field names are from memory of WHOOP's v2 docs (blocked from the build container) and are read defensively.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { HabitKind } from "@/db/schema";

export type WhoopStages = { total_in_bed_time_milli?: number; total_awake_time_milli?: number; total_light_sleep_time_milli?: number; total_slow_wave_sleep_time_milli?: number; total_rem_sleep_time_milli?: number };
export type WhoopSleep = { id: string; start?: string; end?: string; nap?: boolean; score_state?: string; score?: { stage_summary?: WhoopStages; sleep_performance_percentage?: number } };
export type WhoopRecovery = { cycle_id?: number | string; sleep_id?: string; created_at?: string; updated_at?: string; score_state?: string; score?: { recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number } };
export type WhoopCycle = { id: number | string; start?: string; end?: string | null; score_state?: string; score?: { strain?: number; kilojoule?: number; average_heart_rate?: number; max_heart_rate?: number } };
export type WhoopZones = { zone_zero_milli?: number; zone_one_milli?: number; zone_two_milli?: number; zone_three_milli?: number; zone_four_milli?: number; zone_five_milli?: number };
export type WhoopWorkout = { id: string | number; start?: string; end?: string; sport_name?: string; sport_id?: number; score_state?: string; score?: { strain?: number; average_heart_rate?: number; max_heart_rate?: number; kilojoule?: number; distance_meter?: number; zone_duration?: WhoopZones; zone_durations?: WhoopZones } };
/** The body-measurement endpoint: only the max heart rate is kept (phase 16b); height and WHOOP's weight are ignored. */
export type WhoopMeasurement = { height_meter?: number; weight_kilogram?: number; max_heart_rate?: number };

export type DailyRow = { date: string; key: string; value: number; readingId: string; time: string | null };
export type ActivityRow = { providerId: string; date: string; sport: string; startedAt: string | null; endedAt: string | null; minutes: number; strain: number | null; avgHr: number | null; maxHr: number | null; distanceM: number | null; zones: number[] | null };
export const KCAL_PER_KJ = 1 / 4.184;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r1 = (n: number) => Math.round(n * 10) / 10;
const scored = (s: { score_state?: string }) => !s.score_state || s.score_state === "SCORED";

/** A night: hours asleep (in bed less awake) and the performance score, on the morning it ended. Naps and unscored nights give nothing. */
export function sleepRows(s: WhoopSleep, dateOf: (iso: string) => string, timeOf: (iso: string) => string | null): DailyRow[] {
  if (s.nap || !scored(s) || !s.end) return [];
  const st = s.score?.stage_summary;
  const inBed = num(st?.total_in_bed_time_milli);
  const awake = num(st?.total_awake_time_milli) ?? 0;
  const date = dateOf(s.end);
  const readingId = `whoop:sleep:${s.id}`;
  const out: DailyRow[] = [];
  if (inBed != null && inBed > 0) out.push({ date, key: "sleep_h", value: Math.round(((inBed - awake) / 3600000) * 100) / 100, readingId, time: timeOf(s.end) });
  const perf = num(s.score?.sleep_performance_percentage);
  if (perf != null) out.push({ date, key: "sleep_score", value: Math.round(perf), readingId, time: timeOf(s.end) });
  // Phase 16b: the stages in minutes, and the window as minutes after 6 pm (bed) and after midnight (wake), on the member's clock.
  const mins = (ms: number | null) => (ms == null ? null : Math.round(ms / 60000));
  for (const [key, ms] of [["sleep_light_min", num(st?.total_light_sleep_time_milli)], ["sleep_deep_min", num(st?.total_slow_wave_sleep_time_milli)], ["sleep_rem_min", num(st?.total_rem_sleep_time_milli)], ["sleep_awake_min", inBed != null ? awake : null]] as const) {
    const v = mins(ms);
    if (v != null) out.push({ date, key, value: v, readingId, time: null });
  }
  const bed = s.start ? clock(timeOf(s.start)) : null;
  if (bed != null) out.push({ date, key: "bedtime", value: (bed - 18 * 60 + 1440) % 1440, readingId, time: timeOf(s.start!) });
  const wake = clock(timeOf(s.end));
  if (wake != null) out.push({ date, key: "waketime", value: wake, readingId, time: timeOf(s.end) });
  return out;
}
const clock = (hm: string | null): number | null => {
  const m = hm?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
};

/** The device's max heart rate, as a reading on the day it was read; nothing else of the measurement. */
export function measurementRows(m: WhoopMeasurement | null, date: string): DailyRow[] {
  const max = num(m?.max_heart_rate);
  return max != null && max > 0 ? [{ date, key: "max_hr", value: Math.round(max), readingId: "whoop:measurement", time: null }] : [];
}

/** A recovery: the score, resting heart rate and HRV, on the day it was made. */
export function recoveryRows(r: WhoopRecovery, dateOf: (iso: string) => string): DailyRow[] {
  if (!scored(r) || !r.created_at) return [];
  const date = dateOf(r.created_at);
  const readingId = `whoop:recovery:${r.cycle_id ?? r.sleep_id ?? r.created_at}`;
  const out: DailyRow[] = [];
  const rec = num(r.score?.recovery_score);
  const rhr = num(r.score?.resting_heart_rate);
  const hrv = num(r.score?.hrv_rmssd_milli);
  if (rec != null) out.push({ date, key: "recovery", value: Math.round(rec), readingId, time: null });
  if (rhr != null) out.push({ date, key: "rhr", value: Math.round(rhr), readingId, time: null });
  if (hrv != null) out.push({ date, key: "hrv", value: Math.round(hrv), readingId, time: null });
  return out;
}

/** A cycle's strain, its kilojoules as calories burned (an estimate) and its average heart rate, on the day it started. */
export function cycleRows(c: WhoopCycle, dateOf: (iso: string) => string): DailyRow[] {
  if (!scored(c) || !c.start) return [];
  const date = dateOf(c.start);
  const readingId = `whoop:cycle:${c.id}`;
  const out: DailyRow[] = [];
  const strain = num(c.score?.strain);
  if (strain != null) out.push({ date, key: "strain", value: r1(strain), readingId, time: null });
  const kj = num(c.score?.kilojoule);
  if (kj != null && kj > 0) out.push({ date, key: "burn_cal", value: Math.round(kj * KCAL_PER_KJ), readingId, time: null });
  const hr = num(c.score?.average_heart_rate);
  if (hr != null && hr > 0) out.push({ date, key: "cycle_hr", value: Math.round(hr), readingId, time: null });
  return out;
}

/** Minutes in zones 0 to 5 from the workout's zone durations, when the device gave any. */
export function zoneMinutes(z: WhoopZones | undefined): number[] | null {
  if (!z) return null;
  const ms = [z.zone_zero_milli, z.zone_one_milli, z.zone_two_milli, z.zone_three_milli, z.zone_four_milli, z.zone_five_milli].map(num);
  if (ms.every((v) => v == null)) return null;
  return ms.map((v) => Math.round((v ?? 0) / 60000));
}
/** "Z1 12 · Z2 20 · Z3 8 min": the zones with time in them, zone 0 left out. */
export function zonesText(zones: number[] | null | undefined): string {
  if (!zones) return "";
  const parts = zones.map((m, i) => (i > 0 && m > 0 ? `Z${i} ${m}` : "")).filter(Boolean);
  return parts.length ? `${parts.join(" · ")} min` : "";
}
/** Metres → "4.2 km" (or "0.8 km"); nothing under 50 m. */
export const fmtDistance = (m: number | null | undefined): string => (m != null && m >= 50 ? `${(Math.round(m / 100) / 10).toFixed(1)} km` : "");

/** A workout as an activity: its sport, minutes, strain and heart rate, on the day it started. */
export function activityRow(w: WhoopWorkout, dateOf: (iso: string) => string): ActivityRow | null {
  if (!w.start || !w.end) return null;
  const minutes = Math.round(((Date.parse(w.end) - Date.parse(w.start)) / 60000) * 10) / 10;
  if (!(minutes > 0)) return null;
  const strain = num(w.score?.strain);
  const avg = num(w.score?.average_heart_rate);
  const max = num(w.score?.max_heart_rate);
  const dist = num(w.score?.distance_meter);
  return { providerId: String(w.id), date: dateOf(w.start), sport: (w.sport_name ?? `Sport ${w.sport_id ?? "?"}`).trim() || "Activity", startedAt: w.start, endedAt: w.end, minutes, strain: strain != null ? r1(strain) : null, avgHr: avg != null ? Math.round(avg) : null, maxHr: max != null ? Math.round(max) : null, distanceM: dist != null && dist > 0 ? Math.round(dist) : null, zones: zoneMinutes(w.score?.zone_duration ?? w.score?.zone_durations) };
}

/** WHOOP's sport names that mean one of the starter habits; a habit is matched by its own name too (case aside). */
const SPORT_TO_HABIT: Record<string, string> = { walking: "walk / steps", hiking: "walk / steps", stretching: "stretching", sauna: "sauna", "ice bath": "cold exposure", "cold plunge": "cold exposure", meditation: "meditation", yoga: "yoga", breathwork: "breathwork" };
/** The habit a sport ticks, from the member's habits, with the value to log (1 for done, the minutes for a minutes habit; a count habit isn't ticked). */
export function habitTick(sport: string, minutes: number, habits: { id: string; name: string; kind: HabitKind }[]): { habitId: string; value: number } | null {
  const key = sport.trim().toLowerCase();
  const want = SPORT_TO_HABIT[key] ?? key;
  // The habit by its name, or (rev 471) one whose name holds the word: "Sauna session", "Daily stretching", "Walk".
  const words = want.split(/\s*\/\s*/).filter(Boolean);
  const holds = (name: string) => words.some((w) => new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(name));
  const h = habits.find((x) => x.name.trim().toLowerCase() === want) ?? habits.find((x) => holds(x.name));
  if (!h) return null;
  if (h.kind === "done") return { habitId: h.id, value: 1 };
  if (h.kind === "minutes") return { habitId: h.id, value: Math.round(minutes) };
  return null;
}

/** A lifting workout that overlaps a Training session attaches to it rather than standing beside it (rev 198). */
export const isLifting = (sport: string): boolean => /weightlift|strength|powerlift|functional fitness|crossfit/i.test(sport);
/** The name a session made from the device's workout carries (phase 16b): a day with no logged routine gets one, never two. */
export const FROM_WHOOP = "From WHOOP";

/** The webhook's signature: base64 HMAC-SHA256 with the client secret over the timestamp followed by the raw body. */
export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
}
export function verifyWebhook(secret: string, timestamp: string | null, signature: string | null, rawBody: string, now = Date.now()): boolean {
  if (!secret || !timestamp || !signature) return false;
  const t = Number(timestamp);
  // A timestamp in milliseconds or seconds, within five minutes either way.
  const ms = t > 1e12 ? t : t * 1000;
  if (!Number.isFinite(ms) || Math.abs(now - ms) > 5 * 60 * 1000) return false;
  const want = Buffer.from(signWebhook(secret, timestamp, rawBody));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type WebhookEvent = { user_id?: number | string; id?: string | number; type?: string };
export const WEBHOOK_TYPES = ["workout.updated", "sleep.updated", "recovery.updated", "workout.deleted", "sleep.deleted", "recovery.deleted"] as const;

/**
 * How far back "Sync now" and the hourly catch-up pull (rev 473): from two days before the last sync that finished, so a late
 * edit on the device is caught, at least three days and at most thirty. Never synced pulls the thirty.
 */
export function syncWindowDays(lastSyncAt: string | null | undefined, now = Date.now()): number {
  const last = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  if (!Number.isFinite(last)) return 30;
  return Math.min(30, Math.max(3, Math.ceil((now - last) / 86_400_000) + 2));
}

/** What a sync did, in a line: "Synced: 2 new workouts and 1 new night." */
export function syncWords(r: { newWorkouts: number; newNights: number }): string {
  const parts = [r.newWorkouts ? `${r.newWorkouts} new workout${r.newWorkouts === 1 ? "" : "s"}` : "", r.newNights ? `${r.newNights} new night${r.newNights === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.length ? `Synced: ${parts.join(" and ")}. Recovery and strain are up to date.` : "Synced: nothing new since the last sync. Recovery and strain are up to date.";
}

/** A sync that started and never recorded how it ended (the request was cut off) leaves this on the device row. */
export const SYNC_UNFINISHED = "unfinished";
