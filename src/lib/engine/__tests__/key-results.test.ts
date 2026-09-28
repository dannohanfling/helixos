import { describe, expect, it } from "vitest";
import { NEEDS_NUMBER, hitTarget, intentionsDue, krProgress, moveToTasks, readIntention, soundsLikeTask, targetOf } from "../intentions";

const base = { word: "Consistent", initiative: "Finish my webinar", tasks: ["Follow up with 10 leads", "Record 2 videos", ""] };

describe("a key result needs a number", () => {
  it("reads the number it counts to", () => {
    expect(targetOf("3 booked calls from my posts")).toBe(3);
    expect(targetOf("ten new leads")).toBe(10);
    expect(targetOf("$2,000 in new sales")).toBe(2000);
    expect(targetOf("more booked calls")).toBeNull();
  });
  it("refuses one without a number, kindly", () => {
    expect(readIntention({ ...base, kr: ["3 booked calls", "more leads", ""] })).toMatchObject({ error: NEEDS_NUMBER });
    expect("value" in readIntention({ ...base, kr: ["3 booked calls", "10 new leads", ""] })).toBe(true);
  });
});

describe("a task written as a result", () => {
  it("is noticed by its opening verb, and only then", () => {
    for (const t of ["Post 5 times", "Film 3 reels", "Record 2 videos", "Write 1 blog", "Send 20 DMs", "Email my list 2 times", "DM 10 people", "Call 5 leads", "Reach out to 10 people", "Create 2 posts", "Publish 1 video", "Go live 2 times", "Share 3 wins"]) expect(soundsLikeTask(t)).toBe(true);
    for (const t of ["3 booked calls from my posts", "10 new leads", "2 new paying clients", "Calls booked: 3", "Postcards: 5 replies"]) expect(soundsLikeTask(t)).toBe(false);
  });
  it("moves into the first free task slot, and the key result empties", () => {
    expect(moveToTasks(["Post 5 times", "3 booked calls", ""], ["A", "B", ""], 0)).toEqual({ keyResults: ["", "3 booked calls", ""], tasks: ["A", "B", "Post 5 times"] });
    expect(moveToTasks(["Post 5 times", "", ""], ["A", "B", "C"], 0)).toBeNull();
  });
});

describe("the Friday check against the number", () => {
  it("reads target against actual, and done means the number was hit", () => {
    expect(krProgress("3 booked calls from my posts", 2)).toBe("2 of 3 booked calls from my posts");
    expect(krProgress("3 booked calls", null)).toBe("3 booked calls");
    expect(hitTarget("3 booked calls", 2)).toBe(false);
    expect(hitTarget("3 booked calls", 3)).toBe(true);
    expect(hitTarget("3 booked calls", 4)).toBe(true);
  });
});

describe("what the Intentions badge counts", () => {
  const set = { reviewedAt: null } as never;
  it("the week until it's set, the month only on days 1 to 7, the feedback in its window, the Friday check", () => {
    expect(intentionsDue("2026-09-28", { week: null, monthSet: false, feedbackMonth: "2026-09", feedbackGiven: false })).toEqual(["week", "feedback"]);
    expect(intentionsDue("2026-10-02", { week: set, monthSet: false, feedbackMonth: "2026-09", feedbackGiven: true })).toEqual(["check", "month"]);
    expect(intentionsDue("2026-10-08", { week: set, monthSet: false, feedbackMonth: null, feedbackGiven: false })).toEqual([]);
    expect(intentionsDue("2026-10-07", { week: set, monthSet: true, feedbackMonth: null, feedbackGiven: false })).toEqual([]);
  });
});
