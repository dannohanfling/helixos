import { describe, expect, it } from "vitest";
import { MONTH_QUESTIONS, lateForMonth, monthOf, parseRevenue, readMonthIntention, revenueLabel } from "../month-intentions";

const full = { word: "Grounded", personalSeason: "wealth", fear: "That I'm not ready.", habit: "A morning walk.", skill: "Public speaking.", impact: "Help 5 coaches book calls; they benefit most.", businessSeason: "sales", revenueGoal: "$10,000", revenueWhy: "To hire help.", plan: "Two webinars and daily DMs.", proudLast: "Finishing my offer.", proudEnd: "Showing up every day." };

describe("the monthly intention (handoff rev 129)", () => {
  it("asks Danno's eleven questions, in his order", () => {
    expect(MONTH_QUESTIONS).toHaveLength(11);
    expect(MONTH_QUESTIONS[0].q).toBe("What is one word of intention that will guide your actions and mindset this month?");
    expect(MONTH_QUESTIONS[7].q).toBe("What revenue goal are you aiming for this month, and why?");
    expect(MONTH_QUESTIONS[10].q).toBe("At the end of the month, what do you want to look back on and feel most proud of?");
  });
  it("belongs to its month; from the 4th a month with none is late (the coach's quiet list)", () => {
    expect(monthOf("2026-10-01")).toBe("2026-10");
    expect(["2026-10-01", "2026-10-03"].map(lateForMonth)).toEqual([false, false]);
    expect(["2026-10-04", "2026-10-31"].map(lateForMonth)).toEqual([true, true]);
  });
  it("reads a revenue goal as a number, whatever the typing", () => {
    expect(["$10,000", "10000", "7,500.50", " NZD 2,000 ", "USD5000"].map(parseRevenue)).toEqual([10000, 10000, 7500.5, 2000, 5000]);
    expect(["", "ten thousand", "0", "-5", "10k", "1.234"].map(parseRevenue)).toEqual([null, null, null, null, null, null]);
    expect(revenueLabel(10000)).toBe("$10,000");
  });
  it("requires all eleven, the revenue goal a number plus the why; the word one word; the seasons from their lists", () => {
    expect(readMonthIntention(full)).toEqual({ value: { ...full, personalSeason: "wealth", businessSeason: "sales", revenueGoal: 10000 } });
    expect(readMonthIntention({ ...full, word: "two words" })).toEqual({ error: "Your word is one word." });
    expect(readMonthIntention({ ...full, personalSeason: "career" })).toEqual({ error: "Pick your personal season." });
    expect(readMonthIntention({ ...full, businessSeason: "" })).toEqual({ error: "Pick your business's season." });
    expect(readMonthIntention({ ...full, revenueGoal: "lots" })).toEqual({ error: "Write your revenue goal as a number, like 10000." });
    expect(readMonthIntention({ ...full, revenueWhy: " " })).toEqual({ error: "Say why that revenue goal." });
    for (const k of ["fear", "habit", "skill", "impact", "plan", "proudLast", "proudEnd"] as const) expect(readMonthIntention({ ...full, [k]: "" })).toHaveProperty("error");
  });
});
