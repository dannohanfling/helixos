import { describe, expect, it } from "vitest";
import { ARENA, ARENA_DAYS, CHALLENGE_COPY, challengeView, ARENA_ENDS_AT, ARENA_HUDDLES, ARENA_STARTS_AT, arenaCard, arenaDay, arenaPhase, canEnter, canSee, countdown, dateIn, huddleWhen, joinOpen, nextHuddle, rankEntries } from "@/lib/engine/arena";

describe("30 Days in the Arena (H-1562)", () => {
  it("is 30 days, 27 Nov to 26 Dec, and its instants are midnight Pacific at both ends", () => {
    expect(ARENA_DAYS).toBe(30);
    expect(ARENA.targetDays).toBe(24);
    expect(dateIn(ARENA.timezone, new Date(ARENA_STARTS_AT))).toBe("2026-11-27");
    expect(dateIn(ARENA.timezone, new Date(Date.parse(ARENA_STARTS_AT) - 1))).toBe("2026-11-26");
    expect(dateIn(ARENA.timezone, new Date(ARENA_ENDS_AT))).toBe("2026-12-26");
    expect(dateIn(ARENA.timezone, new Date(Date.parse(ARENA_ENDS_AT) + 1))).toBe("2026-12-27");
  });

  it("knows the phase and the day by date", () => {
    expect(arenaPhase(ARENA, "2026-11-26")).toBe("before");
    expect(arenaPhase(ARENA, "2026-11-27")).toBe("open");
    expect(arenaPhase(ARENA, "2026-12-26")).toBe("open");
    expect(arenaPhase(ARENA, "2026-12-27")).toBe("closed");
    expect(arenaDay(ARENA, "2026-11-27")).toBe(1);
    expect(arenaDay(ARENA, "2026-12-26")).toBe(30);
    expect(arenaDay(ARENA, "2026-11-20")).toBeNull();
  });

  it("joins through Thu 26 Nov, and only for clients at the Arena's levels", () => {
    expect(joinOpen(ARENA, "2026-11-26")).toBe(true);
    expect(joinOpen(ARENA, "2026-11-27")).toBe(false);
    for (const tier of ["Accelerator", "Academy", "Elite", "Luxe"]) expect(canEnter({ role: "client", programTier: tier })).toBe(true);
    expect(canEnter({ role: "client", programTier: "Book 'Em Danno" })).toBe(false);
    expect(canEnter({ role: "coach", programTier: "Academy" })).toBe(false);
    expect(canEnter({ role: "client", programTier: "Academy", team: true })).toBe(false);
    expect(canSee({ role: "coach", programTier: "Academy" })).toBe(true);
    expect(canSee({ role: "client", programTier: "Book 'Em Danno" })).toBe(false);
  });

  it("counts down to the start, then to the end, then says it closed", () => {
    const before = countdown(Date.parse("2026-11-26T08:00:00.000Z"));
    expect(before).toMatchObject({ state: "before", days: 1, hours: 0, minutes: 0, label: "until the arena opens" });
    const during = countdown(Date.parse("2026-12-26T07:30:00.000Z"));
    expect(during).toMatchObject({ state: "open", days: 1, label: "left in the arena" });
    expect(countdown(Date.parse("2026-12-28T00:00:00.000Z")).state).toBe("closed");
  });

  it("names the next Huddle in Pacific time, and none after the last", () => {
    expect(nextHuddle(new Date("2026-11-30T00:00:00Z"))?.startsAt).toBe(ARENA_HUDDLES[0].startsAt);
    expect(nextHuddle(new Date("2026-12-02T16:30:00Z"))?.startsAt).toBe(ARENA_HUDDLES[0].startsAt);
    expect(nextHuddle(new Date("2026-12-02T17:30:00Z"))?.startsAt).toBe(ARENA_HUDDLES[1].startsAt);
    expect(nextHuddle(new Date("2026-12-24T00:00:00Z"))).toBeNull();
    expect(huddleWhen(ARENA_HUDDLES[0].startsAt)).toBe("Wed 2 Dec, 8 AM Pacific");
  });

  it("says on Today what the member needs: an invite, the wait, the day, or the end", () => {
    const now = new Date("2026-11-01T18:00:00Z");
    expect(arenaCard({ joined: false, today: "2026-11-01", daysClosed: 0, closedToday: false, now })?.kind).toBe("invite");
    expect(arenaCard({ joined: false, today: "2026-11-27", daysClosed: 0, closedToday: false, now })).toBeNull();
    expect(arenaCard({ joined: true, today: "2026-11-26", daysClosed: 0, closedToday: false, now })).toMatchObject({ kind: "waiting", line: "It opens tomorrow, Fri 27 Nov." });
    expect(arenaCard({ joined: true, today: "2026-11-20", daysClosed: 0, closedToday: false, now })).toMatchObject({ line: "It opens Fri 27 Nov, in 7 days." });
    const day = arenaCard({ joined: true, today: "2026-12-03", daysClosed: 6, closedToday: false, now: new Date("2026-12-03T18:00:00Z") });
    expect(day).toMatchObject({ kind: "day", title: "Day 7 of 30", line: "6 of 24 days closed.", status: "Close your day tonight to count it.", huddle: "Next Huddle: Wed 9 Dec, 8 AM Pacific" });
    expect(arenaCard({ joined: true, today: "2026-12-24", daysClosed: 24, closedToday: true, now })).toMatchObject({ line: "24 days closed: you've completed the challenge.", status: "Today is closed." });
    expect(arenaCard({ joined: true, today: "2026-12-28", daysClosed: 25, closedToday: false, now })?.kind).toBe("after");
  });

  it("ranks by points, then days closed, then calls booked", () => {
    const rows = [
      { id: "a", points: 100, daysClosed: 20, callsBooked: 1 },
      { id: "b", points: 100, daysClosed: 22, callsBooked: 0 },
      { id: "c", points: 100, daysClosed: 22, callsBooked: 3 },
      { id: "d", points: 140, daysClosed: 10, callsBooked: 0 },
    ];
    expect(rankEntries(rows).map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("the challenge card on Colosseum → Challenges (H-1840, plan H-1844)", () => {
  it("sits under Upcoming before the first day, with a countdown and the plan's words", () => {
    const c = challengeView(ARENA, "2026-10-23");
    expect(c.section).toBe("upcoming");
    expect(c.countdown).toBe("Starts in 35 days");
    expect(c.when).toBe("Fri 27 Nov to Sat 26 Dec. Join by Thu 26 Nov.");
    expect(c.finish).toBe("Close your day on 24 of the 30 days.");
    expect(c.promise).toBe("30 days. Close your day 24 times. Earn a free month.");
    expect(challengeView(ARENA, "2026-11-26").countdown).toBe("Starts tomorrow");
  });
  it("moves to Active on the first day and to Past after the last", () => {
    expect(challengeView(ARENA, "2026-11-27")).toMatchObject({ section: "active", countdown: "Day 1 of 30" });
    expect(challengeView(ARENA, "2026-12-26")).toMatchObject({ section: "active", countdown: "Day 30 of 30" });
    expect(challengeView(ARENA, "2026-12-27")).toMatchObject({ section: "past", countdown: "Ended Sat 26 Dec" });
  });
  it("says no price, no Elite reward and no internal name", () => {
    const words = [CHALLENGE_COPY[ARENA.slug].promise, ...CHALLENGE_COPY[ARENA.slug].rewards].join(" ");
    expect(words).not.toMatch(/\$|price|Elite|private session|Accelerator|Academy/i);
  });
  it("a challenge with no words of its own still has dates, a countdown and the finish line", () => {
    const c = challengeView({ ...ARENA, slug: "later-one", name: "A later one" }, "2026-10-23");
    expect(c).toMatchObject({ name: "A later one", promise: null, rewards: [] });
    expect(c.finish).toBe("Close your day on 24 of the 30 days.");
  });
});
