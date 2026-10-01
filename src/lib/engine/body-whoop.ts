/**
 * WHOOP (B6, rev 237 phase 11): the device's records mapped onto Body's own shapes, pure. A night becomes a `body_daily` reading
 * (hours asleep and the performance score) on the morning it ended; a recovery gives the recovery score, resting heart rate and
 * HRV; a cycle gives the day's strain; a workout becomes an activity by its sport, and a sport that matches one of the member's
 * habits by name ticks it for the day with its minutes. The webhook signature check lives here too, so a test can pin it.
 * The API's field names are from memory of WHOOP's v2 docs (blocked from the build container) and are read defensively.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { HabitKind } from "@/db/schema";

export type WhoopSleep = { id: string; start?: string; end?: string; nap?: boolean; score_state?: string; score?: { stage_summary?: { total_in_bed_time_milli?: number; total_awake_time_milli?: number }; sleep_performance_percentage?: number } };
export type WhoopRecovery = { cycle_id?: number | string; sleep_id?: string; created_at?: string; updated_at?: string; score_state?: string; score?: { recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number } };
export type WhoopCycle = { id: number | string; start?: string; end?: string | null; score_state?: string; score?: { strain?: number } };
export type WhoopWorkout = { id: string | number; start?: string; end?: string; sport_name?: string; sport_id?: number; score_state?: string; score?: { strain?: number; average_heart_rate?: number; max_heart_rate?: number } };

export type DailyRow = { date: string; key: string; value: number; readingId: string; time: string | null };
export type ActivityRow = { providerId: string; date: string; sport: string; startedAt: string | null; endedAt: string | null; minutes: number; strain: number | null; avgHr: number | null; maxHr: number | null };

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
  return out;
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

/** A cycle's strain, on the day it started. */
export function cycleRows(c: WhoopCycle, dateOf: (iso: string) => string): DailyRow[] {
  const strain = num(c.score?.strain);
  if (!scored(c) || !c.start || strain == null) return [];
  return [{ date: dateOf(c.start), key: "strain", value: r1(strain), readingId: `whoop:cycle:${c.id}`, time: null }];
}

/** A workout as an activity: its sport, minutes, strain and heart rate, on the day it started. */
export function activityRow(w: WhoopWorkout, dateOf: (iso: string) => string): ActivityRow | null {
  if (!w.start || !w.end) return null;
  const minutes = Math.round(((Date.parse(w.end) - Date.parse(w.start)) / 60000) * 10) / 10;
  if (!(minutes > 0)) return null;
  const strain = num(w.score?.strain);
  const avg = num(w.score?.average_heart_rate);
  const max = num(w.score?.max_heart_rate);
  return { providerId: String(w.id), date: dateOf(w.start), sport: (w.sport_name ?? `Sport ${w.sport_id ?? "?"}`).trim() || "Activity", startedAt: w.start, endedAt: w.end, minutes, strain: strain != null ? r1(strain) : null, avgHr: avg != null ? Math.round(avg) : null, maxHr: max != null ? Math.round(max) : null };
}

/** WHOOP's sport names that mean one of the starter habits; a habit is matched by its own name too (case aside). */
const SPORT_TO_HABIT: Record<string, string> = { walking: "walk / steps", hiking: "walk / steps", stretching: "stretching", sauna: "sauna", "ice bath": "cold exposure", "cold plunge": "cold exposure", meditation: "meditation", yoga: "yoga", breathwork: "breathwork" };
/** The habit a sport ticks, from the member's habits, with the value to log (1 for done, the minutes for a minutes habit; a count habit isn't ticked). */
export function habitTick(sport: string, minutes: number, habits: { id: string; name: string; kind: HabitKind }[]): { habitId: string; value: number } | null {
  const key = sport.trim().toLowerCase();
  const want = SPORT_TO_HABIT[key] ?? key;
  const h = habits.find((x) => x.name.trim().toLowerCase() === want);
  if (!h) return null;
  if (h.kind === "done") return { habitId: h.id, value: 1 };
  if (h.kind === "minutes") return { habitId: h.id, value: Math.round(minutes) };
  return null;
}

/** A lifting workout that overlaps a Training session attaches to it rather than standing beside it (rev 198). */
export const isLifting = (sport: string): boolean => /weightlift|strength|powerlift|functional fitness|crossfit/i.test(sport);

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
