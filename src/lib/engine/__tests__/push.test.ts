import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DAILY_CAP, DEFAULT_PREFS, PUSH_TYPES, callTimeLabel, dueCallStep, dueDaily, dueIntentions, dueWebinar, isQuiet, mayPush, pushCopy, shouldAsk, wants, type DailyState, type PushType } from "@/lib/engine/push";

const day = (over: Partial<DailyState> = {}): DailyState => ({ hour: 8, today: "2026-10-19", morningHour: 8, eveningHour: 17, lockedIn: false, closed: false, activeToday: false, streak: 0, ...over });

describe("push notifications (H-767, H-771)", () => {
  it("defaults: calls, lock-in, close, streak and bot calls on; the rest off; the main switch wins", () => {
    const on = PUSH_TYPES.filter((t) => t.defaultOn).map((t) => t.type).sort();
    expect(on).toEqual(["bot_call", "call", "evening", "morning", "streak"]);
    expect(wants(DEFAULT_PREFS, "rank_up")).toBe(false);
    expect(wants({ ...DEFAULT_PREFS, types: { rank_up: true } }, "rank_up")).toBe(true);
    expect(wants({ ...DEFAULT_PREFS, types: { morning: false } }, "morning")).toBe(false);
    expect(wants({ ...DEFAULT_PREFS, enabled: false }, "call")).toBe(false);
  });

  it("quiet hours cross midnight, and an empty window is never quiet", () => {
    expect([20, 21, 23, 0, 6, 7].map((h) => isQuiet(h, DEFAULT_PREFS))).toEqual([false, true, true, true, true, false]);
    expect(isQuiet(3, { quietStart: 7, quietEnd: 7 })).toBe(false);
    expect([12, 13, 14].map((h) => isQuiet(h, { quietStart: 13, quietEnd: 14 }))).toEqual([false, true, false]);
  });

  it("the words: plain, no em dashes, no exclamation marks, nothing about health", () => {
    const all: PushType[] = PUSH_TYPES.map((t) => t.type);
    const texts = [
      ...all.map((t) => pushCopy(t, { streak: 12, time: "10:00 AM", day: "Tuesday", rank: "Sentinel", coach: "Danno" }).body),
      pushCopy("call", { step: "soon" }).body,
      pushCopy("call", { step: "live" }).body,
      ...PUSH_TYPES.map((t) => t.example),
    ];
    for (const t of texts) {
      expect(t).not.toMatch(/[—!]/);
      expect(t).not.toMatch(/weigh|weight|calorie|meal|sleep|medication|\bmeds?\b|HumanOS|workout|habit/i);
    }
    expect(pushCopy("streak", { streak: 12 }).body).toBe("Your 12-day streak is waiting on you.");
    expect(pushCopy("call", { time: "10:00 AM" }).body).toBe("Live call today at 10:00 AM. Bring one question.");
  });

  it("never reads HumanOS: the push code imports nothing from Body", () => {
    for (const f of ["src/lib/engine/push.ts", "src/lib/push/send.ts", "src/lib/push/daily.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/queries\/body|body-ai|bodyEntries|bodyDaily|bodyMeds|body_/);
    }
  });

  it("morning and evening go in their hour (with an hour to catch up), only while not done", () => {
    expect(dueDaily(day()).map((d) => d.type)).toEqual(["morning"]);
    expect(dueDaily(day({ hour: 9 })).map((d) => d.type)).toEqual(["morning"]);
    expect(dueDaily(day({ hour: 10 }))).toEqual([]);
    expect(dueDaily(day({ lockedIn: true }))).toEqual([]);
    expect(dueDaily(day({ hour: 17 })).map((d) => d.type)).toEqual(["evening"]);
    expect(dueDaily(day({ hour: 17, closed: true }))).toEqual([]);
    expect(dueDaily(day()).every((d) => d.key === "2026-10-19")).toBe(true);
  });

  it("the streak waits at 6 PM for 7+ days with nothing done, unless the close is due within 3 hours", () => {
    const late = { eveningHour: 22 };
    expect(dueDaily(day({ hour: 18, streak: 12, ...late })).map((d) => d.type)).toEqual(["streak"]);
    expect(dueDaily(day({ hour: 18, streak: 6, ...late }))).toEqual([]);
    expect(dueDaily(day({ hour: 18, streak: 12, activeToday: true, ...late }))).toEqual([]);
    // With the 5 PM close still open at 6 PM, the evening push goes and the streak one doesn't: one nudge, not two.
    expect(dueDaily(day({ hour: 18, streak: 12 })).map((d) => d.type)).toEqual(["evening"]);
    expect(dueDaily(day({ hour: 18, streak: 12, eveningHour: 20 })).map((d) => d.type)).toEqual([]);
    expect(dueDaily(day({ hour: 18, streak: 12, eveningHour: 22 })).map((d) => d.type)).toEqual(["streak"]);
  });

  it("caps: 3 a day, one of each, calls outside the cap; quiet hours except the evening close", () => {
    expect(mayPush("morning", 8, DEFAULT_PREFS, [])).toEqual({ ok: true });
    expect(mayPush("morning", 8, DEFAULT_PREFS, ["morning"])).toMatchObject({ ok: false, why: "one of each a day" });
    expect(mayPush("streak", 18, DEFAULT_PREFS, ["morning", "bot_call", "evening"])).toMatchObject({ ok: false, why: "daily cap" });
    expect(DAILY_CAP).toBe(3);
    expect(mayPush("call", 10, DEFAULT_PREFS, ["morning", "bot_call", "evening", "call"])).toEqual({ ok: true });
    expect(mayPush("morning", 22, DEFAULT_PREFS, [])).toMatchObject({ ok: false, why: "quiet hours" });
    expect(mayPush("evening", 22, DEFAULT_PREFS, [])).toEqual({ ok: true });
    expect(mayPush("rank_up", 12, DEFAULT_PREFS, [])).toMatchObject({ ok: false, why: "switched off" });
  });

  it("asks after the first close, once more after the 7th if Not now, then never", () => {
    expect(shouldAsk({ closes: 0, askedCount: 0, answer: null })).toBe(false);
    expect(shouldAsk({ closes: 1, askedCount: 0, answer: null })).toBe(true);
    expect(shouldAsk({ closes: 3, askedCount: 1, answer: "not_now" })).toBe(false);
    expect(shouldAsk({ closes: 7, askedCount: 1, answer: "not_now" })).toBe(true);
    expect(shouldAsk({ closes: 20, askedCount: 2, answer: "not_now" })).toBe(false);
    expect(shouldAsk({ closes: 20, askedCount: 1, answer: "yes" })).toBe(false);
  });
});

describe("live call reminders (H-771)", () => {
  const start = "2026-10-20T17:00:00.000Z"; // 10 AM in Los Angeles
  const member = (hour: number, today = "2026-10-20") => ({ today, hour, callDate: "2026-10-20" });
  const at = (iso: string) => new Date(iso);
  it("the morning of the call, from 8 AM, only when the call is more than an hour away", () => {
    expect(dueCallStep(start, at("2026-10-20T15:05:00.000Z"), member(8))).toBe("morning");
    expect(dueCallStep(start, at("2026-10-20T14:05:00.000Z"), member(7))).toBeNull();
    expect(dueCallStep(start, at("2026-10-20T16:05:00.000Z"), member(9))).toBeNull();
    expect(dueCallStep(start, at("2026-10-19T15:05:00.000Z"), member(8, "2026-10-19"))).toBeNull();
  });
  it("15 minutes before, in the run that lands 15 to 5 minutes out", () => {
    expect(dueCallStep(start, at("2026-10-20T16:45:00.000Z"), member(9))).toBe("soon");
    expect(dueCallStep(start, at("2026-10-20T16:54:00.000Z"), member(9))).toBe("soon");
    expect(dueCallStep(start, at("2026-10-20T16:56:00.000Z"), member(9))).toBeNull();
    expect(dueCallStep(start, at("2026-10-20T16:40:00.000Z"), member(9))).toBeNull();
  });
  it("We're live in the first 10 minutes, then nothing", () => {
    expect(dueCallStep(start, at("2026-10-20T17:00:00.000Z"), member(10))).toBe("live");
    expect(dueCallStep(start, at("2026-10-20T17:09:00.000Z"), member(10))).toBe("live");
    expect(dueCallStep(start, at("2026-10-20T17:11:00.000Z"), member(10))).toBeNull();
  });
  it("the words: the time in the member's zone, plain, no exclamation marks", () => {
    expect(callTimeLabel(start, "America/Los_Angeles")).toBe("10 AM");
    expect(callTimeLabel("2026-10-20T17:30:00.000Z", "America/New_York")).toBe("1:30 PM");
    expect(pushCopy("call", { time: "10 AM" }).body).toBe("Live call today at 10 AM. Bring one question.");
    expect(pushCopy("call", { step: "soon" }).body).toBe("We start in 15 minutes. Tap to join.");
    expect(pushCopy("call", { step: "live" }).body).toBe("We're live now. Tap to join.");
    for (const s of ["morning", "soon", "live"] as const) expect(pushCopy("call", { step: s, time: "10 AM" }).body).not.toMatch(/!|—/);
  });
  it("call reminders sit outside the daily cap, but the switch and quiet hours still hold", () => {
    const prefs = { enabled: true, types: {}, quietStart: 21, quietEnd: 7 };
    expect(mayPush("call", 10, prefs, ["morning", "evening", "streak", "call"])).toEqual({ ok: true });
    expect(mayPush("call", 22, prefs, [])).toMatchObject({ ok: false, why: "quiet hours" });
    expect(mayPush("call", 10, { ...prefs, types: { call: false } }, [])).toMatchObject({ ok: false });
  });
});

describe("event pushes (H-767): weekly intentions and your webinar", () => {
  it("weekly intentions: Monday from 9 AM, only while this week's are still to set", () => {
    expect(dueIntentions({ weekday: 1, hour: 9, weekDue: true })).toBe(true);
    expect(dueIntentions({ weekday: 1, hour: 10, weekDue: true })).toBe(true);
    expect(dueIntentions({ weekday: 1, hour: 8, weekDue: true })).toBe(false);
    expect(dueIntentions({ weekday: 1, hour: 9, weekDue: false })).toBe(false);
    expect(dueIntentions({ weekday: 2, hour: 9, weekDue: true })).toBe(false);
  });
  it("your webinar: in the run that lands 15 to 5 minutes before it starts", () => {
    const at = "2026-10-20T18:00:00.000Z";
    expect(dueWebinar(at, new Date("2026-10-20T17:46:00.000Z"))).toBe(true);
    expect(dueWebinar(at, new Date("2026-10-20T17:40:00.000Z"))).toBe(false);
    expect(dueWebinar(at, new Date("2026-10-20T17:57:00.000Z"))).toBe(false);
  });
  it("rank up, intentions and webinar are ready to switch; the bot, the coach and the Colosseum stay Coming soon", () => {
    const ready = (t: string) => PUSH_TYPES.find((p) => p.type === t)?.ready;
    expect(["rank_up", "intentions", "webinar"].every(ready)).toBe(true);
    expect(["bot_call", "coach_answer", "colosseum"].some(ready)).toBe(false);
    expect(pushCopy("rank_up", { rank: "Sentinel" }).body).toBe("You've risen to Sentinel. Come see your seat.");
  });
});
