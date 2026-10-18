import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DAILY_CAP, DEFAULT_PREFS, PUSH_TYPES, dueDaily, isQuiet, mayPush, pushCopy, shouldAsk, wants, type DailyState, type PushType } from "@/lib/engine/push";

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
