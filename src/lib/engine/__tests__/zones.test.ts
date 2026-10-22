import { describe, expect, it } from "vitest";
import { dayOf, stampDate, todayInTz, whenWords, zoneName } from "@/lib/dates";
import { allZones, canonicalZone, zoneNoticeDue, zoneNoticeText } from "@/lib/engine/zones";

/**
 * Every date and time in the viewer's own zone (H-457, PR 2): a stored stamp shows on the viewer's own day, the brief's
 * "Fri 30 Oct, 11:00 AM AEDT" form holds across the US clock change, "today" flips at the member's own midnight, the Settings
 * list knows every zone, and the one-time line shows only to a member who never had a zone.
 */
const SYD = "Australia/Sydney";
const LA = "America/Los_Angeles";

describe("dayOf: a stored stamp on the viewer's own day", () => {
  it("reads SQLite's zoneless UTC and ISO with a Z as instants, in the viewer's zone", () => {
    // 7:32 PM UTC on the 12th is 6:32 AM on the 13th in Sydney and 12:32 PM on the 12th in Los Angeles.
    expect(dayOf("2026-10-12 19:32:00", SYD)).toBe("2026-10-13");
    expect(dayOf("2026-10-12 19:32:00", LA)).toBe("2026-10-12");
    expect(dayOf("2026-10-12T19:32:00.000Z", SYD)).toBe("2026-10-13");
    // Early UTC morning is still the day before in Los Angeles: the old slice(0, 10) said the 13th.
    expect(dayOf("2026-10-13T03:00:00Z", LA)).toBe("2026-10-12");
  });

  it("passes a bare day through, and never throws on a stamp it can't read", () => {
    expect(dayOf("2026-10-12", SYD)).toBe("2026-10-12");
    expect(dayOf("2026-10-12", LA)).toBe("2026-10-12");
    expect(dayOf("not a date at all", SYD)).toBe("not a date");
  });

  it("stampDate writes that day the way the pages do", () => {
    expect(stampDate("2026-10-12 19:32:00", SYD)).toBe("Oct 13");
    expect(stampDate("2026-10-12 19:32:00", LA, { month: "short", day: "numeric", year: "numeric" })).toBe("Oct 12, 2026");
  });
});

describe("whenWords: weekday, date and time, the zone named on first use", () => {
  it("a Thursday 5 PM Pacific call is Friday morning in Sydney, before the US change", () => {
    const at = "2026-10-30T00:00:00Z"; // Thu 29 Oct, 5:00 PM PDT
    expect(whenWords(at, LA, { zone: true })).toBe("Thu 29 Oct, 5:00 PM PT");
    expect(whenWords(at, SYD, { zone: true })).toBe("Fri 30 Oct, 11:00 AM AEDT");
    expect(whenWords(at, SYD)).toBe("Fri 30 Oct, 11:00 AM");
  });

  it("and in the week after the US clocks go back on 1 November, the gap grows by an hour", () => {
    const at = "2026-11-06T01:00:00Z"; // Thu 5 Nov, 5:00 PM PST
    expect(whenWords(at, LA, { zone: true })).toBe("Thu 5 Nov, 5:00 PM PT");
    expect(whenWords(at, SYD, { zone: true })).toBe("Fri 6 Nov, 12:00 PM AEDT");
  });

  it("names zones the way people write them", () => {
    expect(zoneName(SYD, new Date("2026-10-30T00:00:00Z"))).toBe("AEDT");
    expect(zoneName(LA, new Date("2026-10-30T00:00:00Z"))).toBe("PT");
    expect(zoneName("Europe/London", new Date("2026-12-01T00:00:00Z"))).toMatch(/^(GMT|UTC)$/);
  });
});

describe("today flips at the member's own midnight", () => {
  it("for a Sydney member, at Sydney midnight, not UTC's or Pacific's", () => {
    expect(todayInTz(SYD, new Date("2026-10-19T12:59:59Z"))).toBe("2026-10-19");
    expect(todayInTz(SYD, new Date("2026-10-19T13:00:00Z"))).toBe("2026-10-20");
    // The same instant is still the 19th in Los Angeles.
    expect(todayInTz(LA, new Date("2026-10-19T13:00:00Z"))).toBe("2026-10-19");
  });
});

describe("Settings' zone list", () => {
  it("checks a typed zone and writes it as the zone database does; offsets and made-up zones are refused", () => {
    expect(canonicalZone("Australia/Sydney")).toBe(SYD);
    expect(canonicalZone("australia/sydney")).toBe(SYD);
    expect(canonicalZone("  America/Los_Angeles ")).toBe(LA);
    expect(canonicalZone("+10:00")).toBeNull();
    expect(canonicalZone("GMT+10")).toBeNull();
    expect(canonicalZone("Mars/Olympus_Mons")).toBeNull();
    expect(canonicalZone("")).toBeNull();
    expect(canonicalZone(null)).toBeNull();
  });

  it("lists every zone the runtime knows, A to Z, with UTC, and keeps a saved zone the list lacks", () => {
    const list = allZones();
    expect(list.length).toBeGreaterThan(300);
    expect(list).toContain(SYD);
    expect(list).toContain(LA);
    expect(list).toContain("UTC");
    expect([...list].sort((a, b) => a.localeCompare(b))).toEqual(list);
    expect(allZones("Asia/Calcutta")[0]).toBe(list.includes("Asia/Calcutta") ? list[0] : "Asia/Calcutta");
  });
});

describe("the one-time line", () => {
  const own = (seen: string | null) => ({ switchedInto: null, team: null, membership: { tzPromptSeenAt: seen } });
  it("shows on the member's own sign-in until seen; never to a coach switched in or a team member", () => {
    expect(zoneNoticeDue(own(null))).toBe(true);
    expect(zoneNoticeDue(own("2026-10-19T08:00:00.000Z"))).toBe(false);
    expect(zoneNoticeDue({ ...own(null), switchedInto: { membershipId: "m" } })).toBe(false);
    expect(zoneNoticeDue({ ...own(null), team: { id: "t" } })).toBe(false);
  });

  it("says the zone and where to change it, and says so when the coach's zone stands in", () => {
    expect(zoneNoticeText(SYD, "AEDT", false)).toBe("We're showing times in Australia/Sydney (AEDT). Change it in Settings.");
    expect(zoneNoticeText("UTC", "UTC", false)).toBe("We're showing times in UTC. Change it in Settings.");
    expect(zoneNoticeText(LA, "PT", true)).toBe("We're showing times in America/Los_Angeles (PT), your coach's zone, because your browser didn't tell us yours. Change it in Settings.");
  });
});
