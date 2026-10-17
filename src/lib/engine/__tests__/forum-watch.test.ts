import { describe, expect, it } from "vitest";
import { activeMinutesBetween, allowedSilence, latestStamp, stallFor, stallWords, watched, type WatchAgent } from "@/lib/engine/forum-watch";

// Wednesday 14 Oct 2026, 13:00 in Los Angeles (PDT, UTC-7).
const NOW = new Date("2026-10-14T20:00:00Z");
const ago = (minutes: number, from: Date = NOW) => new Date(from.getTime() - minutes * 60_000).toISOString();
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const LA = "America/Los_Angeles";

/** An agent with its own token and 3-minute check-ins, 07:00 to 20:00 every day (Architectus's poll, H-356). */
const poller = (over: Partial<WatchAgent> = {}): WatchAgent => ({
  builtIn: false,
  hasToken: true,
  muted: false,
  status: "waiting",
  heardAt: ago(1),
  checkins: { on: true, everyMinutes: 3, from: "07:00", to: "20:00", days: EVERY_DAY, tz: LA },
  paused: false,
  ...over,
});
/** An hourly agent, weekdays 07:00 to 19:00 (Hermes). */
const hourly = (over: Partial<WatchAgent> = {}): WatchAgent => poller({ checkins: { on: true, everyMinutes: 60, from: "07:00", to: "19:00", days: [1, 2, 3, 4, 5], tz: LA }, ...over });
/** Check-ins off. */
const unscheduled = (over: Partial<WatchAgent> = {}): WatchAgent => poller({ checkins: null, ...over });

describe("the stall watch (H-495)", () => {
  it("flags an agent with 3-minute check-ins after 15 minutes of silence, not before", () => {
    expect(allowedSilence(3)).toBe(15);
    expect(stallFor(poller({ heardAt: ago(14) }), NOW)).toBeNull();
    expect(stallFor(poller({ heardAt: ago(15) }), NOW)).toBe("checkins");
  });

  it("flags an hourly agent after 3 hours, not before", () => {
    expect(allowedSilence(60)).toBe(180);
    expect(stallFor(hourly({ heardAt: ago(179) }), NOW)).toBeNull();
    expect(stallFor(hourly({ heardAt: ago(180) }), NOW)).toBe("checkins");
    // Working the whole time makes no difference inside its hours: its own schedule decides.
    expect(stallFor(hourly({ heardAt: ago(120), status: "working" }), NOW)).toBeNull();
  });

  it("flags an agent with check-ins off only while it is working, after 60 minutes", () => {
    expect(stallFor(unscheduled({ status: "working", heardAt: ago(59) }), NOW)).toBeNull();
    expect(stallFor(unscheduled({ status: "working", heardAt: ago(60) }), NOW)).toBe("working");
    for (const status of ["idle", "waiting", "done"]) expect(stallFor(unscheduled({ status, heardAt: ago(60 * 24) }), NOW)).toBeNull();
    // Check-ins set up but switched off read the same as none.
    expect(stallFor(poller({ checkins: { ...poller().checkins!, on: false }, status: "idle", heardAt: ago(600) }), NOW)).toBeNull();
  });

  it("never flags a muted agent, a built-in, one with no token of its own, or one never heard from", () => {
    expect(stallFor(poller({ heardAt: ago(500), muted: true }), NOW)).toBeNull();
    expect(stallFor(poller({ heardAt: ago(500), builtIn: true }), NOW)).toBeNull();
    expect(stallFor(poller({ heardAt: ago(500), hasToken: false }), NOW)).toBeNull();
    expect(stallFor(poller({ heardAt: null, status: "working" }), NOW)).toBeNull();
    expect(watched({ builtIn: false, hasToken: true, muted: false })).toBe(true);
    expect(watched({ builtIn: false, hasToken: true, muted: true })).toBe(false);
  });

  it("counts only the agent's active hours: a night off is never a stall", () => {
    // Last heard at 19:58 Wednesday; at 06:59 Thursday nothing inside its hours has passed.
    const morning = new Date("2026-10-15T13:59:00Z");
    const evening = "2026-10-15T02:58:00Z";
    expect(activeMinutesBetween(Date.parse(evening), morning.getTime(), poller().checkins!, 100)).toBe(2);
    expect(stallFor(poller({ heardAt: evening }), morning)).toBeNull();
    // From 07:00 the clock runs again: 13 more minutes make 15.
    expect(stallFor(poller({ heardAt: evening }), new Date("2026-10-15T14:12:00Z"))).toBeNull();
    expect(stallFor(poller({ heardAt: evening }), new Date("2026-10-15T14:13:00Z"))).toBe("checkins");
    // A weekend is not a stall for a weekdays agent: heard Friday 18:30, nothing by Monday 06:00.
    expect(stallFor(hourly({ heardAt: "2026-10-17T01:30:00Z" }), new Date("2026-10-19T13:00:00Z"))).toBeNull();
  });

  it("still catches an agent left working outside its hours (last night's case), after 60 minutes", () => {
    // Working at 21:00 Wednesday, after its 20:00 close, then nothing.
    const night = new Date("2026-10-15T05:00:00Z");
    expect(stallFor(poller({ status: "working", heardAt: ago(59, night) }), night)).toBeNull();
    expect(stallFor(poller({ status: "working", heardAt: ago(60, night) }), night)).toBe("working");
  });

  it("treats Pause all as check-ins off: no missed intervals, only the working rule", () => {
    expect(stallFor(poller({ paused: true, heardAt: ago(30) }), NOW)).toBeNull();
    expect(stallFor(poller({ paused: true, status: "working", heardAt: ago(60) }), NOW)).toBe("working");
  });

  it("reads the last sign of life from database and ISO stamps alike", () => {
    expect(latestStamp([null, "2026-10-14 19:00:00", "2026-10-14T19:30:00.000Z", undefined])).toBe("2026-10-14T19:30:00.000Z");
    expect(latestStamp(["2026-10-14 19:45:00", "2026-10-14T19:30:00Z"])).toBe("2026-10-14T19:45:00.000Z");
    expect(latestStamp([null, undefined])).toBeNull();
  });

  it("says it in the brief's words", () => {
    expect(stallWords.card("Oct 14, 9:42 PM PDT")).toBe("Stopped checking in at Oct 14, 9:42 PM PDT. Usually the usage limit, or the session closed.");
    expect(stallWords.need("Hermes", "9:42 PM")).toBe("Hermes stopped at 9:42 PM. Open its session, switch the model if it's at its limit, and ask it to continue.");
    expect(stallWords.back("9:57 PM")).toBe("back at 9:57 PM");
  });
});
