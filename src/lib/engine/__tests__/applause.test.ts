import { describe, expect, it } from "vitest";
import { applauderPoints, applauseLine, keys, shortWin, winnerPoints, APPLAUDER_DAY_CAP, WIN_CAP } from "@/lib/engine/applause";

describe("applause points (H-1177)", () => {
  it("gives the applauder 2 a win up to 10 a day, and the coach nothing", () => {
    expect(applauderPoints("client", 0)).toBe(2);
    expect(applauderPoints("client", 8)).toBe(2);
    expect(applauderPoints("client", 9)).toBe(1);
    expect(applauderPoints("client", APPLAUDER_DAY_CAP)).toBe(0);
    expect(applauderPoints("client", 40)).toBe(0);
    expect(applauderPoints("coach", 0)).toBe(0);
  });
  it("gives the winner 5 an applause, 10 from the coach, at most 25 a win", () => {
    expect(winnerPoints(false, 0)).toBe(5);
    expect(winnerPoints(true, 0)).toBe(10);
    expect(winnerPoints(false, 20)).toBe(5);
    expect(winnerPoints(true, 20)).toBe(5);
    expect(winnerPoints(false, WIN_CAP)).toBe(0);
    let total = 0;
    for (let i = 0; i < 10; i++) total += winnerPoints(i === 3, total);
    expect(total).toBe(WIN_CAP);
  });
  it("keys each award so it never scores twice, and a take-back has its own key", () => {
    expect(keys.applauded("w1")).not.toBe(keys.unapplauded("w1"));
    expect(keys.received("w1", "u1")).not.toBe(keys.received("w1", "u2"));
    expect(keys.received("w1", "u1").startsWith(keys.receivedPrefix("w1"))).toBe(true);
    expect(keys.received("w12", "u1").startsWith(keys.receivedPrefix("w1"))).toBe(false);
  });
  it("says it in plain words on Today", () => {
    expect(applauseLine({ count: 3, coachOnly: null, text: "Closed my first client" })).toBe("3 people applauded your win: Closed my first client");
    expect(applauseLine({ count: 1, coachOnly: null, text: "x" })).toBe("1 person applauded your win: x");
    expect(applauseLine({ count: 1, coachOnly: "Danno", text: "x" })).toBe("Danno applauded your win: x");
    expect(shortWin("word ".repeat(30))).toMatch(/…$/);
    expect(shortWin("word ".repeat(30)).length).toBeLessThanOrEqual(61);
  });
});
