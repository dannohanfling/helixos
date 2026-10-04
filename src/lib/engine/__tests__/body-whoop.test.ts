import { describe, expect, it } from "vitest";
import { activityRow, cycleRows, fmtDistance, habitTick, isLifting, measurementRows, recoveryRows, signWebhook, sleepRows, syncWindowDays, syncWords, verifyWebhook, zoneMinutes, zonesText } from "@/lib/engine/body-whoop";
import { bedtimeDrift, bedtimeMinutes, fmtBedtime, fmtMinutes, fmtWake } from "@/lib/engine/body-recovery";

const dateOf = (iso: string) => iso.slice(0, 10);
const timeOf = (iso: string) => iso.slice(11, 16);

describe("WHOOP (B6, rev 237 phase 11)", () => {
  it("a night: hours asleep from in-bed less awake, the performance score, on the morning it ended; naps and unscored nights give nothing", () => {
    const rows = sleepRows({ id: "s1", start: "2026-09-30T04:30:00.000Z", end: "2026-09-30T12:10:00.000Z", nap: false, score_state: "SCORED", score: { stage_summary: { total_in_bed_time_milli: 7.5 * 3600000, total_awake_time_milli: 0.5 * 3600000 }, sleep_performance_percentage: 88 } }, dateOf, timeOf);
    expect(rows.slice(0, 2)).toEqual([
      { date: "2026-09-30", key: "sleep_h", value: 7, readingId: "whoop:sleep:s1", time: "12:10" },
      { date: "2026-09-30", key: "sleep_score", value: 88, readingId: "whoop:sleep:s1", time: "12:10" },
    ]);
    // Phase 16b adds the awake minutes and the window; stages only when the device gave them.
    expect(rows.slice(2).map((r) => [r.key, r.value])).toEqual([["sleep_awake_min", 30], ["bedtime", 630], ["waketime", 730]]);
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
    expect(activityRow({ id: "w1", start: "2026-09-30T16:00:00.000Z", end: "2026-09-30T16:48:00.000Z", sport_name: "Weightlifting", score: { strain: 9.8, average_heart_rate: 121, max_heart_rate: 160 } }, dateOf)).toEqual({ providerId: "w1", date: "2026-09-30", sport: "Weightlifting", startedAt: "2026-09-30T16:00:00.000Z", endedAt: "2026-09-30T16:48:00.000Z", minutes: 48, strain: 9.8, avgHr: 121, maxHr: 160, distanceM: null, zones: null });
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
  it("phase 16b: stages and bed times on a night, calories and heart rate on a cycle, zones and distance on a workout, max HR from the measurement", () => {
    const rows = sleepRows({ id: "s2", start: "2026-09-29T23:10:00.000Z", end: "2026-09-30T06:40:00.000Z", score_state: "SCORED", score: { stage_summary: { total_in_bed_time_milli: 7.5 * 3600000, total_awake_time_milli: 20 * 60000, total_light_sleep_time_milli: 3.5 * 3600000, total_slow_wave_sleep_time_milli: 80 * 60000, total_rem_sleep_time_milli: 110 * 60000 } } }, dateOf, timeOf);
    const by = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(by).toMatchObject({ sleep_light_min: 210, sleep_deep_min: 80, sleep_rem_min: 110, sleep_awake_min: 20, bedtime: 310, waketime: 400 });
    expect(rows.find((r) => r.key === "bedtime")?.time).toBe("23:10");
    expect(fmtBedtime(310)).toBe("23:10");
    expect(fmtBedtime(390)).toBe("00:30"); // past midnight still counts forward from 6 pm
    expect(fmtWake(400)).toBe("06:40");
    expect(bedtimeMinutes("00:30")).toBe(390);
    expect(fmtMinutes(80)).toBe("1 h 20 min");
    expect(fmtMinutes(45)).toBe("45 min");
    expect(cycleRows({ id: 78, start: "2026-09-30T06:40:00.000Z", score: { strain: 12, kilojoule: 10460, average_heart_rate: 71.6 } }, dateOf).map((r) => [r.key, r.value])).toEqual([["strain", 12], ["burn_cal", 2500], ["cycle_hr", 72]]);
    const w = activityRow({ id: "w3", start: "2026-09-30T07:00:00.000Z", end: "2026-09-30T07:40:00.000Z", sport_name: "Running", score: { strain: 11, average_heart_rate: 150, max_heart_rate: 176, distance_meter: 6540, zone_duration: { zone_zero_milli: 60000, zone_one_milli: 4 * 60000, zone_two_milli: 15 * 60000, zone_three_milli: 18 * 60000, zone_four_milli: 2 * 60000, zone_five_milli: 0 } } }, dateOf)!;
    expect(w.distanceM).toBe(6540);
    expect(w.zones).toEqual([1, 4, 15, 18, 2, 0]);
    expect(zonesText(w.zones)).toBe("Z1 4 · Z2 15 · Z3 18 · Z4 2 min");
    expect(zonesText(null)).toBe("");
    expect(zoneMinutes(undefined)).toBeNull();
    expect(fmtDistance(6540)).toBe("6.5 km");
    expect(fmtDistance(20)).toBe("");
    expect(measurementRows({ height_meter: 1.8, weight_kilogram: 80, max_heart_rate: 188 }, "2026-09-30")).toEqual([{ date: "2026-09-30", key: "max_hr", value: 188, readingId: "whoop:measurement", time: null }]);
    expect(measurementRows(null, "2026-09-30")).toEqual([]);
    // Bedtime drift: each night against the mean of the week before it, once two nights are there.
    const drift = bedtimeDrift([{ date: "2026-09-26", value: 300 }, { date: "2026-09-27", value: 320 }, { date: "2026-09-28", value: 310 }, { date: "2026-09-29", value: 400 }], (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000);
    expect(drift).toEqual([{ date: "2026-09-28", value: 0 }, { date: "2026-09-29", value: 90 }]);
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

describe("sync window and its line (rev 473)", () => {
  const now = Date.parse("2026-10-04T17:00:00.000Z");
  it("pulls from two days before the last finished sync, three to thirty days", () => {
    expect(syncWindowDays(null, now)).toBe(30);
    expect(syncWindowDays("2026-10-04T14:47:00.000Z", now)).toBe(3);
    expect(syncWindowDays("2026-09-28T14:47:00.000Z", now)).toBe(9);
    expect(syncWindowDays("2026-01-01T00:00:00.000Z", now)).toBe(30);
  });
  it("says what a sync did", () => {
    expect(syncWords({ newWorkouts: 2, newNights: 1 })).toBe("Synced: 2 new workouts and 1 new night. Recovery and strain are up to date.");
    expect(syncWords({ newWorkouts: 1, newNights: 0 })).toBe("Synced: 1 new workout. Recovery and strain are up to date.");
    expect(syncWords({ newWorkouts: 0, newNights: 0 })).toBe("Synced: nothing new since the last sync. Recovery and strain are up to date.");
  });
});
