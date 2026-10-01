import { describe, expect, it } from "vitest";
import { activityRow, cycleRows, habitTick, isLifting, recoveryRows, signWebhook, sleepRows, verifyWebhook } from "@/lib/engine/body-whoop";

const dateOf = (iso: string) => iso.slice(0, 10);
const timeOf = (iso: string) => iso.slice(11, 16);

describe("WHOOP (B6, rev 237 phase 11)", () => {
  it("a night: hours asleep from in-bed less awake, the performance score, on the morning it ended; naps and unscored nights give nothing", () => {
    const rows = sleepRows({ id: "s1", start: "2026-09-30T04:30:00.000Z", end: "2026-09-30T12:10:00.000Z", nap: false, score_state: "SCORED", score: { stage_summary: { total_in_bed_time_milli: 7.5 * 3600000, total_awake_time_milli: 0.5 * 3600000 }, sleep_performance_percentage: 88 } }, dateOf, timeOf);
    expect(rows).toEqual([
      { date: "2026-09-30", key: "sleep_h", value: 7, readingId: "whoop:sleep:s1", time: "12:10" },
      { date: "2026-09-30", key: "sleep_score", value: 88, readingId: "whoop:sleep:s1", time: "12:10" },
    ]);
    expect(sleepRows({ id: "n1", end: "2026-09-30T20:00:00.000Z", nap: true, score: { stage_summary: { total_in_bed_time_milli: 3600000 } } }, dateOf, timeOf)).toEqual([]);
    expect(sleepRows({ id: "p1", end: "2026-09-30T20:00:00.000Z", score_state: "PENDING_SCORE" }, dateOf, timeOf)).toEqual([]);
  });
  it("a recovery gives the score, resting heart rate and HRV; a cycle its strain; a workout an activity by sport with its minutes", () => {
    expect(recoveryRows({ cycle_id: 77, created_at: "2026-09-30T12:15:00.000Z", score: { recovery_score: 71.4, resting_heart_rate: 52, hrv_rmssd_milli: 68.2 } }, dateOf)).toEqual([
      { date: "2026-09-30", key: "recovery", value: 71, readingId: "whoop:recovery:77", time: null },
      { date: "2026-09-30", key: "rhr", value: 52, readingId: "whoop:recovery:77", time: null },
      { date: "2026-09-30", key: "hrv", value: 68, readingId: "whoop:recovery:77", time: null },
    ]);
    expect(cycleRows({ id: 77, start: "2026-09-30T12:10:00.000Z", score: { strain: 11.37 } }, dateOf)).toEqual([{ date: "2026-09-30", key: "strain", value: 11.4, readingId: "whoop:cycle:77", time: null }]);
    expect(activityRow({ id: "w1", start: "2026-09-30T16:00:00.000Z", end: "2026-09-30T16:48:00.000Z", sport_name: "Weightlifting", score: { strain: 9.8, average_heart_rate: 121, max_heart_rate: 160 } }, dateOf)).toEqual({ providerId: "w1", date: "2026-09-30", sport: "Weightlifting", startedAt: "2026-09-30T16:00:00.000Z", endedAt: "2026-09-30T16:48:00.000Z", minutes: 48, strain: 9.8, avgHr: 121, maxHr: 160 });
    expect(activityRow({ id: "w2", start: "2026-09-30T16:00:00.000Z" }, dateOf)).toBeNull();
    expect(isLifting("Weightlifting")).toBe(true);
    expect(isLifting("Walking")).toBe(false);
  });
  it("a sport ticks the matching habit: done habits with a 1, minutes habits with the minutes, count habits never", () => {
    const habits = [
      { id: "h1", name: "Sauna", kind: "minutes" as const },
      { id: "h2", name: "Stretching", kind: "done" as const },
      { id: "h3", name: "Walk / steps", kind: "count" as const },
      { id: "h4", name: "Breathwork", kind: "done" as const },
    ];
    expect(habitTick("Sauna", 18.4, habits)).toEqual({ habitId: "h1", value: 18 });
    expect(habitTick("Stretching", 10, habits)).toEqual({ habitId: "h2", value: 1 });
    expect(habitTick("Walking", 40, habits)).toBeNull();
    expect(habitTick("Running", 30, habits)).toBeNull();
    expect(habitTick("breathwork", 8, habits)).toEqual({ habitId: "h4", value: 1 });
  });
  it("the webhook signature: HMAC-SHA256 over timestamp + body, base64; a wrong secret, a stale timestamp or a changed body fail", () => {
    const now = Date.now();
    const ts = String(now);
    const body = JSON.stringify({ user_id: 1, id: "w1", type: "workout.updated" });
    const sig = signWebhook("secret", ts, body);
    expect(verifyWebhook("secret", ts, sig, body, now)).toBe(true);
    expect(verifyWebhook("other", ts, sig, body, now)).toBe(false);
    expect(verifyWebhook("secret", ts, sig, body + " ", now)).toBe(false);
    expect(verifyWebhook("secret", String(now - 10 * 60 * 1000), signWebhook("secret", String(now - 10 * 60 * 1000), body), body, now)).toBe(false);
    expect(verifyWebhook("secret", null, sig, body, now)).toBe(false);
  });
});
