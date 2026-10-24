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

describe("Arena PR B: pods, the leaderboard and the Huddle check-in (H-1563)", () => {
  it("fills pods of five in join order, making a new pod when all are full", async () => {
    const { fillPods } = await import("@/lib/engine/arena");
    const entries = Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, podId: null, joinedAt: `2026-11-0${i + 1}T00:00:00Z` }));
    const plan = fillPods(entries, []);
    expect(plan.create).toEqual(["Pod 1", "Pod 2"]);
    expect(plan.assign.filter((a) => a.pod === "new:0").map((a) => a.entryId)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
    expect(plan.assign.filter((a) => a.pod === "new:1").map((a) => a.entryId)).toEqual(["e5", "e6"]);
  });

  it("keeps placed members where they are and fills the first pod with room", async () => {
    const { fillPods } = await import("@/lib/engine/arena");
    const entries = [
      { id: "a", podId: "p1", joinedAt: "1" },
      { id: "b", podId: "p1", joinedAt: "2" },
      { id: "c", podId: "gone", joinedAt: "3" },
      { id: "d", podId: null, joinedAt: "4" },
    ];
    const plan = fillPods(entries, [{ id: "p1" }], 3);
    expect(plan.assign).toEqual([
      { entryId: "c", pod: "p1" },
      { entryId: "d", pod: "new:0" },
    ]);
    expect(plan.create).toEqual(["Pod 2"]);
    expect(fillPods([{ id: "a", podId: "p1", joinedAt: "1" }], [{ id: "p1" }]).assign).toEqual([]);
  });

  it("opens the Huddle check-in 30 minutes before and closes it 90 minutes after the start", async () => {
    const { huddleLive, huddleOpensWords } = await import("@/lib/engine/arena");
    const h = [{ id: "h1", startsAt: "2026-12-02T16:00:00.000Z" }];
    expect(huddleLive(new Date("2026-12-02T15:29:59Z"), h)).toBeNull();
    expect(huddleLive(new Date("2026-12-02T15:30:00Z"), h)?.id).toBe("h1");
    expect(huddleLive(new Date("2026-12-02T17:30:00Z"), h)?.id).toBe("h1");
    expect(huddleLive(new Date("2026-12-02T17:30:01Z"), h)).toBeNull();
    expect(huddleOpensWords("2026-12-02T16:00:00.000Z")).toBe("7:30 AM Pacific");
  });

  it("splits the window into Monday-to-Sunday weeks and names last week's leader from Mon 30 Nov", async () => {
    const { arenaWeeks, leaderWeek, weekInstants, weekWords } = await import("@/lib/engine/arena");
    expect(arenaWeeks(ARENA)).toEqual([
      { from: "2026-11-27", to: "2026-11-29" },
      { from: "2026-11-30", to: "2026-12-06" },
      { from: "2026-12-07", to: "2026-12-13" },
      { from: "2026-12-14", to: "2026-12-20" },
      { from: "2026-12-21", to: "2026-12-26" },
    ]);
    expect(leaderWeek(ARENA, "2026-11-29")).toBeNull();
    expect(leaderWeek(ARENA, "2026-11-30")).toEqual({ from: "2026-11-27", to: "2026-11-29" });
    expect(leaderWeek(ARENA, "2026-12-09")).toEqual({ from: "2026-11-30", to: "2026-12-06" });
    expect(leaderWeek(ARENA, "2027-01-05")).toEqual({ from: "2026-12-21", to: "2026-12-26" });
    expect(weekInstants({ from: "2026-11-27", to: "2026-11-29" })).toEqual({ from: ARENA_STARTS_AT, to: "2026-11-30T07:59:59.999Z" });
    expect(weekInstants({ from: "2026-12-21", to: "2026-12-26" }).to).toBe(ARENA_ENDS_AT);
    expect(weekWords({ from: "2026-11-27", to: "2026-11-29" })).toBe("27 to 29 Nov");
    expect(weekWords({ from: "2026-11-30", to: "2026-12-06" })).toBe("30 Nov to 6 Dec");
  });

  it("places the board by points, then days closed, then calls booked, sharing a place on a full tie", async () => {
    const { placed, ordinal } = await import("@/lib/engine/arena");
    const rows = [
      { id: "a", points: 50, daysClosed: 3, callsBooked: 0 },
      { id: "b", points: 80, daysClosed: 1, callsBooked: 0 },
      { id: "c", points: 50, daysClosed: 3, callsBooked: 0 },
      { id: "d", points: 50, daysClosed: 4, callsBooked: 0 },
    ];
    expect(placed(rows).map((r) => [r.id, r.place])).toEqual([
      ["b", 1],
      ["d", 2],
      ["a", 3],
      ["c", 3],
    ]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
});

describe("Arena PR C: finishing and the nudge (H-1563)", () => {
  it("the nudge line says the day and the closes, inside the window only", async () => {
    const { arenaNudgeLine } = await import("@/lib/engine/arena");
    expect(arenaNudgeLine(ARENA, "2026-11-26", 0)).toBeNull();
    expect(arenaNudgeLine(ARENA, "2026-12-27", 20)).toBeNull();
    expect(arenaNudgeLine(ARENA, "2026-12-08", 9)).toBe("Arena day 12 of 30: 9 of 24 closed. Close today to count it.");
    expect(arenaNudgeLine(ARENA, "2026-12-22", 24)).toBe("Arena day 26 of 30: you've completed the challenge. Every close still earns points.");
  });
  it("a finisher's prize: Elite gets a private session, everyone else a month at their level", async () => {
    const { finisherPrize, finishedLine } = await import("@/lib/engine/arena");
    expect(finisherPrize("Elite")).toBe("A private strategy session with Danno");
    expect(finisherPrize("Academy")).toBe("One free month at Academy");
    expect(finishedLine("Accelerator", 24)).toBe("You've completed the challenge: 24 days closed. Your free month is added after 26 Dec.");
    expect(finishedLine("Elite", 24)).toContain("private strategy session");
  });
  it("the evening push and email carry the Arena line only when it's given", async () => {
    const { pushCopy } = await import("@/lib/engine/push");
    const { eveningCopy } = await import("@/lib/engine/reminder-copy");
    expect(pushCopy("evening").body).toBe("Close out the day. Your +20 is waiting.");
    expect(pushCopy("evening", { arena: null }).body).toBe("Close out the day. Your +20 is waiting.");
    expect(pushCopy("evening", { arena: "Arena day 12 of 30: 9 of 24 closed. Close today to count it." }).body).toContain("Arena day 12");
    const hours = { morning: 8, evening: 19 };
    expect(eveningCopy({ first: "Maya", streak: 0, bonus: 0, hours }).stateLine).toBeNull();
    expect(eveningCopy({ first: "Maya", streak: 3, bonus: 0, hours, arena: "Arena day 12 of 30: 9 of 24 closed. Close today to count it." }).stateLine).toBe("Arena day 12 of 30: 9 of 24 closed. Close today to count it. Three days behind you. Close today and it's four.");
  });
});
