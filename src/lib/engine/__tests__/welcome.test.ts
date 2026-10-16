import { describe, expect, it } from "vitest";
import { FIRE_STAGES, MILESTONE_REWARDS_ON, arenaProgress, fireName, fireStage, weekCoins, welcomeCard, welcomeCopy } from "../welcome";

// 2026-10-12 is a Monday; 17 and 18 the weekend.
const run = (dates: string[]) => new Set(dates);

describe("the Daily welcome (H-312)", () => {
  it("the fire: min(streak, 7), named Ember to Beacon, 0 before the first day", () => {
    expect([0, 1, 2, 7, 12].map(fireStage)).toEqual([0, 1, 2, 7, 7]);
    expect(fireName(1)).toBe("Ember");
    expect(fireName(7)).toBe("Beacon");
    expect(FIRE_STAGES).toHaveLength(7);
  });
  it("the week's coins: struck for paid days with their amount, today's with the day's credit, bronze ahead with what the streak would pay, a ring for a missed day", () => {
    const active = run(["2026-10-12", "2026-10-13", "2026-10-15"]);
    const coins = weekCoins({ today: "2026-10-15", days: "all", active, ladder: active, paid: new Map([["2026-10-12", 10], ["2026-10-13", 20], ["2026-10-15", 10]]), todayBonus: 10 });
    expect(coins.map((c) => `${c.label}:${c.state}:${c.amount ?? "-"}`)).toEqual(["MON:done:10", "TUE:done:20", "WED:missed:-", "THU:today:10", "FRI:next:20", "SAT:next:40", "SUN:next:40"]);
    // A Monday to Friday member: the weekend never counts, so its coins are off.
    const weekdays = weekCoins({ today: "2026-10-15", days: "weekdays", active, ladder: active, paid: new Map(), todayBonus: 10 });
    expect(weekdays.slice(5).map((c) => c.state)).toEqual(["off", "off"]);
  });
  it("days in the arena: the next laurel and the bar from the one before it; past 365 a victory lap", () => {
    expect(arenaProgress(48)).toEqual({ next: 50, prev: 30, fraction: 0.9, caption: "2 days to your Day 50 laurel." });
    expect(arenaProgress(49).caption).toBe("1 day to your Day 50 laurel.");
    expect(arenaProgress(12)).toMatchObject({ next: 30, prev: 0, fraction: 0.4 });
    expect(arenaProgress(400)).toMatchObject({ next: null, fraction: 1 });
  });
  it("the words: a streak day, a weekend, a comeback after a gap, never an exclamation mark", () => {
    const streak = welcomeCopy({ first: "Jamie", streak: 12, comeback: false, today: "2026-10-16", days: "all", todayBonus: 160, daysInArena: 48, milestone: null });
    expect(streak).toMatchObject({ eyebrow: "Ave, Jamie", title: "Day 12 of your streak." });
    expect(streak.line).toContain("Friday is the biggest day of the week.");
    const weekend = welcomeCopy({ first: "Jamie", streak: 13, comeback: false, today: "2026-10-17", days: "all", todayBonus: 40, daysInArena: 49, milestone: null });
    expect(weekend).toEqual({ eyebrow: "Ave, Jamie", title: "Day 13. Weekends count too.", line: "Saturday adds 40 points and keeps your fire lit." });
    const back = welcomeCopy({ first: "Jamie", streak: 1, comeback: true, today: "2026-10-16", days: "all", todayBonus: 10, daysInArena: 32, milestone: null });
    expect(back).toEqual({ eyebrow: "Welcome back, Jamie", title: "Back in the arena.", line: "Day 1 starts now. Your days in the arena never reset." });
    for (const c of [streak, weekend, back]) expect(`${c.eyebrow}${c.title}${c.line}`).not.toContain("!");
  });
  it("the card: a comeback reads the gap, days in the arena never reset, nothing rolls when today was active already, and the milestone panel stays off", () => {
    const active = run(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-15"]); // Wed and Thu missed before today Thu 15? no: 12, 13, 14 missed
    const card = welcomeCard({ look: "night", first: "Jamie", today: "2026-10-15", days: "all", active, ladder: active, paid: new Map([["2026-10-15", 10]]), streak: 1, points: 1220, todayBonus: 10, wasActiveToday: false, lockedIn: false });
    expect(card.copy.title).toBe("Back in the arena.");
    expect(card.daysInArena).toBe(4);
    expect(card.daysOld).toBe(3);
    expect(card.streakOld).toBe(0);
    expect(card.pointsOld).toBe(1210);
    expect(card.stage).toBe(1);
    expect(card.stageOld).toBe(0);
    expect(card.summary).toBe("Day 1 streak. Plus 10 points. 4 days in the arena.");
    const again = welcomeCard({ look: "day", first: "Jamie", today: "2026-10-15", days: "all", active, ladder: active, paid: new Map([["2026-10-15", 10]]), streak: 1, points: 1220, todayBonus: 10, wasActiveToday: true, lockedIn: true });
    expect([again.streakOld, again.daysOld, again.pointsOld, again.lockedIn]).toEqual([1, 4, 1220, true]);
    // Day 50 in the arena: the panel waits for Danno (rewards off); the caption still points past it.
    const fifty = run(Array.from({ length: 50 }, (_, i) => `2026-0${8 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`));
    const ms = welcomeCard({ look: "night", first: "Jamie", today: "2026-09-22", days: "all", active: fifty, ladder: fifty, paid: new Map(), streak: 4, points: 5310, todayBonus: 80, wasActiveToday: false, lockedIn: false });
    expect(ms.daysInArena).toBe(50);
    expect(MILESTONE_REWARDS_ON).toBe(false);
    expect(ms.milestone).toBeNull();
    expect(ms.copy.title).toBe("Day 4 of your streak.");
    expect(ms.progress.caption).toBe("50 days to your Day 100 laurel.");
  });
});
