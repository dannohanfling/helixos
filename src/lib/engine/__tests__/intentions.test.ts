import { describe, expect, it } from "vitest";
import { fridayOf, intentionPrompt, tasksDueOn, keyResultTally, lateForWeek, readIntention, weekOf } from "../intentions";

// 21 Sep 2026 is a Monday.
const MON = "2026-09-21", TUE = "2026-09-22", THU = "2026-09-24", FRI = "2026-09-25", SAT = "2026-09-26", SUN = "2026-09-27";

describe("the weekly 3-1-3 (handoff rev 124)", () => {
  it("belongs to its Monday, and its tasks are due that Friday, whatever day it is set", () => {
    for (const d of [MON, TUE, THU, FRI, SAT, SUN]) {
      expect(weekOf(d)).toBe(MON);
      expect(fridayOf(d)).toBe(FRI);
    }
    expect(weekOf("2026-09-28")).toBe("2026-09-28");
    // Set on the weekend, the tasks are due that day rather than a Friday already gone.
    expect([MON, THU, FRI].map(tasksDueOn)).toEqual([FRI, FRI, FRI]);
    expect([SAT, SUN].map(tasksDueOn)).toEqual([SAT, SUN]);
  });
  it("Today asks to set it any day until it is set; once set it is shown; Friday to Sunday it asks once for the key results", () => {
    for (const d of [MON, THU, SUN]) expect(intentionPrompt(d, null)).toBe("set");
    for (const d of [MON, TUE, THU]) expect(intentionPrompt(d, { reviewedAt: null })).toBe("shown");
    for (const d of [FRI, SAT, SUN]) expect(intentionPrompt(d, { reviewedAt: null })).toBe("review");
    for (const d of [FRI, SUN]) expect(intentionPrompt(d, { reviewedAt: "2026-09-25T18:00:00Z" })).toBe("shown");
  });
  it("from Tuesday on, a week with no 3-1-3 is late (the coach's quiet list); on Monday it is not", () => {
    expect(lateForWeek(MON)).toBe(false);
    for (const d of [TUE, THU, FRI, SAT, SUN]) expect(lateForWeek(d)).toBe(true);
  });
  it("everything is required but a third key result and a third task; the word is one word", () => {
    const full = { word: " Consistent ", kr: ["Book 5 calls", "Post 5 times", "Close 1"], initiative: "Webinar slides", tasks: ["A", "B", "C"] };
    expect(readIntention(full)).toEqual({ value: { word: "Consistent", keyResults: ["Book 5 calls", "Post 5 times", "Close 1"], initiative: "Webinar slides", tasks: ["A", "B", "C"] } });
    expect(readIntention({ ...full, kr: ["a", "b", " "], tasks: ["x", "y", ""] })).toEqual({ value: { word: "Consistent", keyResults: ["a", "b"], initiative: "Webinar slides", tasks: ["x", "y"] } });
    expect(readIntention({ ...full, word: "" })).toEqual({ error: "Choose one word for your week." });
    expect(readIntention({ ...full, word: "two words" })).toEqual({ error: "Your word is one word." });
    expect(readIntention({ ...full, word: "self-led" })).toHaveProperty("value");
    expect(readIntention({ ...full, kr: ["a", "", "c"] })).toEqual({ error: "Write at least two key results you can track." });
    expect(readIntention({ ...full, initiative: " " })).toEqual({ error: "Write the one initiative that moves your bigger goal." });
    expect(readIntention({ ...full, tasks: ["", "b", "c"] })).toEqual({ error: "Write at least two tasks that move the needle." });
  });
  it("tallies the key results once marked", () => {
    expect(keyResultTally([true, false, true])).toBe("2 of 3 key results done");
    expect(keyResultTally([false, false])).toBe("0 of 2 key results done");
  });
});
