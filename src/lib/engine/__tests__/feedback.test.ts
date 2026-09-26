import { describe, expect, it } from "vitest";
import { feedbackMonth, lastDayOf, monthLabel, monthSummary, nextMonth, prevMonth, readFeedback, trendLine, windowOpens } from "../feedback";

const full = { proud: "Booked my first 3 calls.", love: "The Friday calls.", less: "Long lessons.", more: "Templates.", wow: "A done-for-you funnel.", referralScore: "9", referral: "Sam, a fitness coach.", favorite: "The community." };

describe("end-of-month feedback (handoff rev 124)", () => {
  it("knows each month's last day, and the months either side", () => {
    expect([lastDayOf("2026-09"), lastDayOf("2026-02"), lastDayOf("2028-02"), lastDayOf("2026-12")]).toEqual([30, 28, 29, 31]);
    expect([nextMonth("2026-12"), prevMonth("2027-01"), prevMonth("2026-10")]).toEqual(["2027-01", "2026-12", "2026-09"]);
  });
  it("asks from the last 3 days of a month through the 5th of the next, about the month ending; never in between", () => {
    expect(feedbackMonth("2026-09-27")).toBeNull();
    expect([feedbackMonth("2026-09-28"), feedbackMonth("2026-09-30")]).toEqual(["2026-09", "2026-09"]);
    expect([feedbackMonth("2026-10-01"), feedbackMonth("2026-10-05")]).toEqual(["2026-09", "2026-09"]);
    expect(feedbackMonth("2026-10-06")).toBeNull();
    expect([feedbackMonth("2026-02-26"), feedbackMonth("2027-01-03")]).toEqual(["2026-02", "2026-12"]);
    expect(feedbackMonth("2026-09-25")).toBeNull();
    expect(windowOpens("2026-09")).toBe("2026-09-28");
  });
  it("proud, Love, Less, More, Wow, a whole referral score from 1 to 10 and their favorite part are required; who they'd refer is not (rev 129)", () => {
    expect(readFeedback(full)).toEqual({ value: { ...full, referralScore: 9 } });
    expect(readFeedback({ ...full, referral: " " })).toEqual({ value: { ...full, referralScore: 9, referral: "" } });
    expect(readFeedback({ ...full, favorite: " " })).toEqual({ error: "Tell us your favorite part of the experience so far." });
    expect(readFeedback({ ...full, proud: "" })).toEqual({ error: "Tell us what you're most proud of this past month." });
    expect(readFeedback({ ...full, wow: " " })).toEqual({ error: "Fill in Wow." });
    for (const s of ["", "0", "11", "7.5", "ten"]) expect(readFeedback({ ...full, referralScore: s })).toEqual({ error: "Pick a referral score from 1 to 10." });
    expect(readFeedback({ ...full, referralScore: "10" })).toHaveProperty("value");
  });
  it("sums a month for the coach, and says the trend plainly", () => {
    expect(monthSummary([9, 8, 10])).toEqual({ count: 3, average: 9 });
    expect(monthSummary([7, 8])).toEqual({ count: 2, average: 7.5 });
    expect(monthSummary([])).toEqual({ count: 0, average: null });
    expect([trendLine(9, 8.2), trendLine(7, 8.2), trendLine(8, 8), trendLine(8, null)]).toEqual(["up 0.8", "down 1.2", "no change", ""]);
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
});
