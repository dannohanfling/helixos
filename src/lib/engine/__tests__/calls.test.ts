import { describe, expect, it } from "vitest";
import { CALL_AUDIENCE_LABEL, DEFAULT_CALLS, callIcs, callOccurrences, dayHeading, joinOpensAt, joinState, lengthWords, nextCallDates, nextCallLine, nextCallWithin, offsetMinutes, readCall, readShared, readSkipDate, untilWords, visibleTo, vtimezone, type CallLike } from "../calls";

const call = (o: Partial<CallLike> = {}): CallLike => ({ id: "c1", name: "Academy call", weekday: 1, start: "10:00", minutes: 60, timezone: "America/Los_Angeles", audience: "academy", link: null, active: true, ...o });
const shared = { link: "https://evolvecalls.com", passcode: "evolve" };

describe("callOccurrences: the weekly calls as instants", () => {
  it("stays at 10:00 Pacific across the fall-back: 17:00 UTC before 1 Nov 2026, 18:00 UTC after", () => {
    const occ = callOccurrences([call()], [], "2026-10-25T00:00:00Z", "2026-11-04T00:00:00Z", shared);
    expect(occ.map((o) => [o.localDate, o.startIso, o.endIso])).toEqual([
      ["2026-10-26", "2026-10-26T17:00:00.000Z", "2026-10-26T18:00:00.000Z"],
      ["2026-11-02", "2026-11-02T18:00:00.000Z", "2026-11-02T19:00:00.000Z"],
    ]);
    expect(occ[0]).toMatchObject({ audience: "academy", link: "https://evolvecalls.com", passcode: "evolve" });
  });
  it("and across the spring-forward (8 Mar 2026): 18:00 UTC before, 17:00 after", () => {
    const occ = callOccurrences([call()], [], "2026-03-01T00:00:00Z", "2026-03-10T00:00:00Z");
    expect(occ.map((o) => o.startIso)).toEqual(["2026-03-02T18:00:00.000Z", "2026-03-09T17:00:00.000Z"]);
  });
  it("leaves out a skipped date and an inactive call, and sorts by start across calls", () => {
    const calls = [call(), call({ id: "c2", name: "Accelerator Orientation", start: "09:00", audience: "accelerator_academy" }), call({ id: "c3", weekday: 3, active: false })];
    const occ = callOccurrences(calls, [{ callId: "c1", date: "2026-10-26" }], "2026-10-25T00:00:00Z", "2026-11-03T00:00:00Z");
    expect(occ.map((o) => `${o.call.id} ${o.localDate}`)).toEqual(["c2 2026-10-26", "c2 2026-11-02", "c1 2026-11-02"]);
  });
  it("includes a call already running at the window's start, and a call's own link wins over the shared one", () => {
    const occ = callOccurrences([call({ link: "https://example.com/room" })], [], "2026-10-26T17:30:00Z", "2026-10-26T20:00:00Z", shared);
    expect(occ).toHaveLength(1);
    expect(occ[0].link).toBe("https://example.com/room");
    expect(callOccurrences([call()], [], "2026-10-26T18:00:00Z", "2026-10-26T20:00:00Z")).toEqual([]);
  });
  it("a call in another zone reads its weekday there: Monday 10:00 Sydney is Sunday 23:00 UTC", () => {
    const occ = callOccurrences([call({ timezone: "Australia/Sydney" })], [], "2026-10-24T00:00:00Z", "2026-10-27T00:00:00Z");
    expect(occ.map((o) => [o.localDate, o.startIso])).toEqual([["2026-10-26", "2026-10-25T23:00:00.000Z"]]);
  });
  it("the defaults are the usual week: four Academy mornings, Friday at 13:00, and the two Accelerator calls", () => {
    const occ = callOccurrences(DEFAULT_CALLS.map((c, i) => ({ ...c, id: `d${i}`, link: null, active: true })), [], "2026-10-19T07:00:00Z", "2026-10-24T07:00:00Z");
    expect(occ.map((o) => `${o.localDate} ${o.call.start} ${o.call.name}`)).toEqual([
      "2026-10-19 09:00 Accelerator Orientation",
      "2026-10-19 10:00 Academy call",
      "2026-10-20 10:00 Academy call",
      "2026-10-21 10:00 Academy call",
      "2026-10-21 10:00 Accelerator call",
      "2026-10-22 10:00 Academy call",
      "2026-10-23 13:00 Academy call",
    ]);
  });
});

describe("joinState: Join from 10 minutes before to the end", () => {
  const occ = { startIso: "2026-10-26T17:00:00.000Z", endIso: "2026-10-26T18:00:00.000Z" };
  it("later, soon, live and over", () => {
    expect(joinState(occ, new Date("2026-10-26T16:49:59Z"))).toBe("later");
    expect(joinState(occ, new Date("2026-10-26T16:50:00Z"))).toBe("soon");
    expect(joinState(occ, new Date("2026-10-26T17:00:00Z"))).toBe("live");
    expect(joinState(occ, new Date("2026-10-26T17:59:59Z"))).toBe("live");
    expect(joinState(occ, new Date("2026-10-26T18:00:00Z"))).toBe("over");
  });
  it("says when Join opens in the reader's time", () => {
    expect(joinOpensAt(occ, "America/Los_Angeles")).toBe("9:50 AM");
    expect(joinOpensAt(occ, "America/New_York")).toBe("12:50 PM");
  });
});

describe("visibleTo: who sees which call", () => {
  const acc = { audience: "accelerator_academy" as const };
  const aca = { audience: "academy" as const };
  it("an Accelerator member sees the Accelerator calls only; Academy, Elite and Luxe see both; the coach sees all", () => {
    expect([visibleTo(acc, { role: "client", programTier: "Accelerator" }), visibleTo(aca, { role: "client", programTier: "Accelerator" })]).toEqual([true, false]);
    for (const tier of ["Academy", "Elite", "Luxe"]) expect([visibleTo(acc, { role: "client", programTier: tier }), visibleTo(aca, { role: "client", programTier: tier })]).toEqual([true, true]);
    expect(visibleTo(aca, { role: "coach", programTier: "Accelerator" })).toBe(true);
    expect(CALL_AUDIENCE_LABEL).toEqual({ accelerator_academy: "Accelerator and up", academy: "Academy and up" });
  });
});

describe("Add to calendar: one weekly event in the call's zone", () => {
  const now = new Date("2026-10-18T20:00:00Z"); // Sunday in Los Angeles
  const text = callIcs(call(), [{ callId: "c1", date: "2026-11-23" }, { callId: "c1", date: "2026-12-28" }, { callId: "other", date: "2026-11-30" }], shared, now);
  const lines = text.replace(/\r\n /g, "").split("\r\n");
  it("repeats weekly from the next Monday with the call's TZID, the skipped dates as EXDATE", () => {
    expect(lines).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(lines).toContain("DTSTART;TZID=America/Los_Angeles:20261019T100000");
    expect(lines).toContain("DTEND;TZID=America/Los_Angeles:20261019T110000");
    expect(lines).toContain("EXDATE;TZID=America/Los_Angeles:20261123T100000,20261228T100000");
    expect(lines).toContain("UID:call-c1@helixos");
    expect(lines).toContain("TRIGGER:-PT15M");
    expect(text.endsWith("\r\n")).toBe(true);
  });
  it("carries the link and passcode in the description, and a VTIMEZONE for the zone", () => {
    expect(lines.find((l) => l.startsWith("DESCRIPTION:Academy call"))).toBe("DESCRIPTION:Academy call\\, every Monday at 10:00 (America/Los_Angeles).\\nJoin: https://evolvecalls.com\\nPasscode: evolve");
    expect(lines).toContain("URL:https://evolvecalls.com");
    expect(lines).toContain("BEGIN:VTIMEZONE");
    expect(lines).toContain("TZID:America/Los_Angeles");
    // The fall-back of 2 Nov 2025 at 2:00 PDT opens the STANDARD observance; 8 Mar 2026 at 2:00 PST the DAYLIGHT one.
    const tz = vtimezone("America/Los_Angeles", 2025, 2);
    expect(tz.slice(tz.indexOf("BEGIN:DAYLIGHT"), tz.indexOf("END:DAYLIGHT") + 1)).toEqual(["BEGIN:DAYLIGHT", "DTSTART:20250309T020000", "RDATE:20260308T020000", "TZOFFSETFROM:-0800", "TZOFFSETTO:-0700", "END:DAYLIGHT"]);
    expect(tz.slice(tz.indexOf("BEGIN:STANDARD"), tz.indexOf("END:STANDARD") + 1)).toEqual(["BEGIN:STANDARD", "DTSTART:20251102T020000", "RDATE:20261101T020000", "TZOFFSETFROM:-0700", "TZOFFSETTO:-0800", "END:STANDARD"]);
    expect(vtimezone("Asia/Singapore", 2026, 2)).toEqual(["BEGIN:VTIMEZONE", "TZID:Asia/Singapore", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0800", "TZOFFSETTO:+0800", "END:STANDARD", "END:VTIMEZONE"]);
    expect(offsetMinutes("Asia/Kolkata", Date.UTC(2026, 0, 1))).toBe(330);
  });
  it("starts after a skipped next date, and a call running past midnight ends the next day", () => {
    const t = callIcs(call({ start: "23:30" }), [{ callId: "c1", date: "2026-10-19" }], shared, now).split("\r\n");
    expect(t).toContain("DTSTART;TZID=America/Los_Angeles:20261026T233000");
    expect(t).toContain("DTEND;TZID=America/Los_Angeles:20261027T003000");
    expect(t.some((l) => l.startsWith("EXDATE"))).toBe(false);
  });
});

describe("the coach's form and the words", () => {
  const ok = { name: "Academy call", weekday: "1", start: "10:00", minutes: "60", timezone: "America/Los_Angeles", audience: "academy", link: "" };
  it("reads a good call and refuses each bad field by name", () => {
    expect(readCall(ok)).toEqual({ value: { name: "Academy call", weekday: 1, start: "10:00", minutes: 60, timezone: "America/Los_Angeles", audience: "academy", link: null } });
    expect(readCall({ ...ok, name: " " })).toMatchObject({ field: "name" });
    expect(readCall({ ...ok, weekday: "7" })).toMatchObject({ field: "weekday" });
    expect(readCall({ ...ok, start: "9:5" })).toMatchObject({ field: "start" });
    expect(readCall({ ...ok, start: "24:00" })).toMatchObject({ field: "start" });
    expect(readCall({ ...ok, minutes: "4" })).toMatchObject({ field: "minutes" });
    expect(readCall({ ...ok, minutes: "481" })).toMatchObject({ field: "minutes" });
    expect(readCall({ ...ok, timezone: "Mars/Olympus" })).toMatchObject({ field: "timezone" });
    expect(readCall({ ...ok, audience: "members" })).toMatchObject({ field: "audience" });
    expect(readCall({ ...ok, link: "javascript:alert(1)" })).toMatchObject({ field: "link" });
    expect(readCall({ ...ok, link: "http://zoom.us/j/1" })).toMatchObject({ value: { link: "http://zoom.us/j/1" } });
  });
  it("the shared link and passcode, and a skip date on the call's weekday", () => {
    expect(readShared({ link: "https://evolvecalls.com", passcode: " evolve " })).toEqual({ value: { callsLink: "https://evolvecalls.com", callsPasscode: "evolve" } });
    expect(readShared({ link: "evolvecalls.com", passcode: "" })).toMatchObject({ field: "link" });
    expect(readSkipDate("2026-11-26", call({ weekday: 4 }))).toEqual({ value: "2026-11-26" });
    expect(readSkipDate("2026-11-27", call({ weekday: 4 }))).toEqual({ error: "That date isn't a Thursday." });
    expect(readSkipDate("2026-02-30", call())).toMatchObject({ error: "Pick the date with no call." });
    expect(nextCallDates(call({ weekday: 4 }), new Date("2026-10-18T20:00:00Z"), 3)).toEqual(["2026-10-22", "2026-10-29", "2026-11-05"]);
  });
  it("the Today line: the next call within a day, live first", () => {
    const occ = callOccurrences([call(), call({ id: "c2", start: "09:00" })], [], "2026-10-26T15:00:00Z", "2026-10-27T15:00:00Z");
    expect(nextCallLine(nextCallWithin(occ, new Date("2026-10-26T14:00:00Z"))!, "America/Los_Angeles", new Date("2026-10-26T14:00:00Z"))).toBe("Next call: Academy call, Mon 9:00 AM (in 2 h)");
    const live = nextCallWithin(occ, new Date("2026-10-26T17:10:00Z"))!;
    expect(live.call.id).toBe("c1");
    expect(nextCallLine(live, "America/Los_Angeles", new Date("2026-10-26T17:10:00Z"))).toBe("Next call: Academy call, Mon 10:00 AM (live now)");
    expect(nextCallWithin(occ, new Date("2026-10-25T14:00:00Z"))).toBeNull();
    expect([untilWords("2026-10-26T17:00:00Z", Date.parse("2026-10-26T16:35:00Z")), untilWords("2026-10-26T17:00:00Z", Date.parse("2026-10-26T15:55:00Z"))]).toEqual(["in 25 min", "in 1 h 5 min"]);
    expect([lengthWords(60), lengthWords(45), lengthWords(90)]).toEqual(["1 h", "45 min", "1 h 30 min"]);
    expect([dayHeading("2026-10-19", "2026-10-19"), dayHeading("2026-10-20", "2026-10-19"), dayHeading("2026-10-21", "2026-10-19")]).toEqual(["Today", "Tomorrow", "Wednesday 21 Oct"]);
  });
});
