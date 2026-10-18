import { describe, expect, it } from "vitest";
import { todayInTz, zoneName } from "@/lib/dates";
import { upcomingFridays, readOohRequest } from "@/lib/engine/office-hours";
import { dayName, hostToday, oohSchedule, parseOohTime, readOohSession, sessionBoth, sessionDays, sessionHeading, sessionLocalDate, sessionLocalDay, sessionSpoken, sessionStart, sessionWhen } from "@/lib/engine/ooh-session";
import { fridayFrom, oohReadBack } from "@/lib/engine/voice-pack";

/** H-457: Office Hours in each member's own zone. A Thursday 5 PM Pacific call; the US clocks change on Sunday 1 November 2026. */
const THU_5PM_PT = { weekday: 4, start: "17:00", minutes: 60, hostTz: "America/Los_Angeles" };
const SYDNEY = "Australia/Sydney";

describe("a session in the host's zone, read in the member's", () => {
  it("shows a Thursday 5 PM PT session to a Sydney member as Friday morning AEDT, with Friday's date, before and after the US change", () => {
    expect(sessionWhen("2026-10-29", THU_5PM_PT, SYDNEY, { zone: true })).toBe("Fri 30 Oct, 11:00 AM AEDT");
    // The week after the US change: Pacific moves an hour, Sydney doesn't, so the call lands an hour later there.
    expect(sessionWhen("2026-11-05", THU_5PM_PT, SYDNEY, { zone: true })).toBe("Fri 6 Nov, 12:00 PM AEDT");
    expect(sessionLocalDate("2026-10-29", THU_5PM_PT, SYDNEY)).toBe("2026-10-30");
    expect(sessionLocalDay("2026-10-29", THU_5PM_PT, SYDNEY)).toBe("Friday");
  });

  it("keeps the weekly session at 5 PM PT for the host across the change", () => {
    for (const day of sessionDays("2026-10-25", 4, 4)) expect(sessionWhen(day, THU_5PM_PT, "America/Los_Angeles", { zone: true })).toMatch(/^Thu \d+ (Oct|Nov), 5:00 PM PT$/);
    expect(sessionStart("2026-10-29", THU_5PM_PT)?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(sessionStart("2026-11-05", THU_5PM_PT)?.toISOString()).toBe("2026-11-06T01:00:00.000Z");
  });

  it("gives the coach the member's time and the host's side by side, and one time when they match", () => {
    expect(sessionBoth("2026-10-29", THU_5PM_PT, SYDNEY)).toBe("Fri 11:00 AM AEDT · Thu 5:00 PM PT");
    expect(sessionBoth("2026-10-29", THU_5PM_PT, "America/Los_Angeles")).toBe("Thu 5:00 PM PT");
    expect(sessionBoth("2026-10-29", { ...THU_5PM_PT, start: null }, SYDNEY)).toBeNull();
    expect(sessionHeading("2026-10-29", THU_5PM_PT, "Europe/London")).toBe("Friday, October 30, 12:00 AM GMT");
  });

  it("shows only the host's date when no start is set, since a day without a time can't move", () => {
    const noStart = { ...THU_5PM_PT, start: null };
    expect(sessionWhen("2026-10-29", noStart, SYDNEY)).toBe("Thu 29 Oct");
    expect(sessionSpoken("2026-10-29", noStart, SYDNEY)).toBe("Thursday the 29th");
    expect(sessionLocalDate("2026-10-29", noStart, SYDNEY)).toBe("2026-10-29");
  });

  it("counts the session dates from the host's today, so a Sydney Saturday still offers Friday's Pacific session", () => {
    // 1:00 AM Saturday 24 Oct in Sydney is 7:00 AM Friday 23 Oct in Los Angeles.
    const now = new Date("2026-10-23T14:00:00Z");
    expect(todayInTz(SYDNEY, now)).toBe("2026-10-24");
    const friday = { weekday: 5, start: "12:00", minutes: 60, hostTz: "America/Los_Angeles" };
    expect(hostToday(friday, now)).toBe("2026-10-23");
    expect(upcomingFridays(hostToday(friday, now), 4, friday.weekday)[0]).toBe("2026-10-23");
    expect(sessionDays("2026-10-23", 4, 2)).toEqual(["2026-10-29", "2026-11-05"]);
  });

  it("flips a Sydney member's today at Sydney midnight", () => {
    expect(todayInTz(SYDNEY, new Date("2026-10-30T12:59:00Z"))).toBe("2026-10-30");
    expect(todayInTz(SYDNEY, new Date("2026-10-30T13:00:00Z"))).toBe("2026-10-31");
  });

  it("names zones as people write them", () => {
    const at = new Date("2026-10-23T00:00:00Z");
    expect(zoneName("Australia/Sydney", at)).toBe("AEDT");
    expect(zoneName("America/Los_Angeles", at)).toBe("PT");
    expect(zoneName("Europe/London", at)).toBe("BST");
    expect(zoneName("Asia/Kolkata", at)).toBe("IST");
    expect(zoneName("Asia/Tokyo", at)).toBe("GMT+9");
  });
});

describe("the schedule and the coach's fields", () => {
  it("reads the day and start from the old note while no start is set, and the columns once it is", () => {
    expect(parseOohTime("Fridays at 12:00 pm")).toEqual({ weekday: 5, start: "12:00" });
    expect(parseOohTime("Thursday 5pm")).toEqual({ weekday: 4, start: "17:00" });
    expect(parseOohTime("the 17th, about 60 minutes")).toEqual({});
    const ws = { oohWeekday: 5, oohStart: null, oohMinutes: 60, oohTime: "Thursdays at 5:00 pm", timezone: "America/Los_Angeles" };
    expect(oohSchedule(ws)).toEqual({ weekday: 4, start: "17:00", minutes: 60, hostTz: "America/Los_Angeles" });
    expect(oohSchedule({ ...ws, oohStart: "09:30" })).toEqual({ weekday: 5, start: "09:30", minutes: 60, hostTz: "America/Los_Angeles" });
    expect(dayName({ weekday: 4 })).toBe("Thursday");
  });

  it("saves a weekday, a start or none, and a listed length; refuses anything else", () => {
    expect(readOohSession({ weekday: "4", start: "17:00", minutes: "60" })).toEqual({ value: { oohWeekday: 4, oohStart: "17:00", oohMinutes: 60 } });
    expect(readOohSession({ weekday: "5", start: "", minutes: "90" })).toEqual({ value: { oohWeekday: 5, oohStart: null, oohMinutes: 90 } });
    expect(readOohSession({ weekday: "", start: "17:00", minutes: "60" })).toHaveProperty("error");
    expect(readOohSession({ weekday: "7", start: "17:00", minutes: "60" })).toHaveProperty("error");
    expect(readOohSession({ weekday: "4", start: "5pm", minutes: "60" })).toHaveProperty("error");
    expect(readOohSession({ weekday: "4", start: "17:00", minutes: "10" })).toHaveProperty("error");
  });

  it("asks a member for one of the next four of the session's day", () => {
    const raw = { friday: "2026-10-30", description: "x", triedSelf: "y", tools: "", goal: "z", category: "Other", triedGate: "yes", promise: true };
    expect(readOohRequest(raw, "2026-10-25", ["Other"], 4)).toEqual({ error: "Pick one of the next four Thursdays.", field: "friday" });
    expect(readOohRequest({ ...raw, friday: "2026-10-29" }, "2026-10-25", ["Other"], 4)).toHaveProperty("value");
  });
});

describe("the voice words", () => {
  it("finds a session by the date the member sees, and says it in their own day and time", () => {
    const days = sessionDays("2026-10-25", 4, 4);
    const local = (f: string) => sessionLocalDate(f, THU_5PM_PT, SYDNEY);
    expect(fridayFrom("the 30th", days, ["thursday", "friday"], local)).toBe("2026-10-29");
    expect(fridayFrom("2026-11-06", days, ["thursday", "friday"], local)).toBe("2026-11-05");
    expect(fridayFrom("this friday", days, ["thursday", "friday"], local)).toBe("2026-10-29");
    expect(fridayFrom(undefined, days, ["thursday"], local)).toBe("2026-10-29");
    const when = sessionSpoken("2026-10-29", THU_5PM_PT, SYDNEY);
    expect(when).toBe("Fri 30 Oct, 11:00 AM AEDT");
    expect(oohReadBack({ question: "q", tried: "t", outcome: "o", category: "Other", friday: "2026-10-29", when })).toContain("you'll be there on Fri 30 Oct, 11:00 AM AEDT");
  });
});
