import { describe, expect, it } from "vitest";
import { byNeed, rosterFlag } from "../roster-flag";

const base = { questionsWaiting: 0, daysSinceLockIn: 1, daysSinceJoined: 30, botConnected: true };

describe("the client list's one flag (H-164 §17)", () => {
  it("is nothing for a client who locks in and has a bot", () => {
    expect(rosterFlag(base)).toBeNull();
  });
  it("says a question is waiting before anything else", () => {
    expect(rosterFlag({ ...base, questionsWaiting: 2, daysSinceLockIn: 20, botConnected: false })).toBe("question");
  });
  it("says no lock-in in 7 days from the seventh day, before the bot", () => {
    expect(rosterFlag({ ...base, daysSinceLockIn: 6, botConnected: false })).toBe("bot");
    expect(rosterFlag({ ...base, daysSinceLockIn: 7, botConnected: false })).toBe("no_lockin");
  });
  it("gives a never-locked-in member their first week", () => {
    expect(rosterFlag({ ...base, daysSinceLockIn: null, daysSinceJoined: 3 })).toBeNull();
    expect(rosterFlag({ ...base, daysSinceLockIn: null, daysSinceJoined: 7 })).toBe("no_lockin");
  });
  it("sorts flagged clients first, the most pressing first, the rest keeping their order", () => {
    const rows = [{ id: "a", flag: null }, { id: "b", flag: "bot" as const }, { id: "c", flag: "question" as const }, { id: "d", flag: null }, { id: "e", flag: "no_lockin" as const }];
    expect(rows.slice().sort(byNeed).map((r) => r.id)).toEqual(["c", "e", "b", "a", "d"]);
  });
});
