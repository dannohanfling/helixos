import { describe, expect, it } from "vitest";
import { wallTimeToUtc } from "@/lib/dates";

describe("a member's wall-clock time becomes the UTC instant it names, whatever zone the server runs in", () => {
  it("reads the time in the member's zone, not the server's", () => {
    expect(wallTimeToUtc("2026-09-15T09:30", "America/Los_Angeles")).toBe("2026-09-15T16:30:00.000Z");
    expect(wallTimeToUtc("2026-09-15T09:30:00", "America/New_York")).toBe("2026-09-15T13:30:00.000Z");
    expect(wallTimeToUtc("2026-01-15T09:30:00", "America/Los_Angeles")).toBe("2026-01-15T17:30:00.000Z");
    expect(wallTimeToUtc("2026-09-15T09:30:00", "Europe/London")).toBe("2026-09-15T08:30:00.000Z");
    expect(wallTimeToUtc("2026-09-15T09:30:00", "Australia/Sydney")).toBe("2026-09-14T23:30:00.000Z");
    expect(wallTimeToUtc("2026-09-15T09:30:00", "UTC")).toBe("2026-09-15T09:30:00.000Z");
  });
  it("carries milliseconds and a Z, the Social Planner's shape; a string with its own offset is honoured", () => {
    expect(wallTimeToUtc("2026-09-15T09:30:00", "America/Chicago")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(wallTimeToUtc("2026-09-15T09:30:00-07:00", "Europe/Berlin")).toBe("2026-09-15T16:30:00.000Z");
    expect(wallTimeToUtc("2026-09-15T16:30:00.000Z", "Europe/Berlin")).toBe("2026-09-15T16:30:00.000Z");
  });
  it("garbage is null, never a throw and never a date", () => {
    expect(wallTimeToUtc("2026-09-15T:00", "America/Los_Angeles")).toBeNull();
    expect(wallTimeToUtc("not a time", "America/Los_Angeles")).toBeNull();
    expect(wallTimeToUtc("2026-09-15T09:30:00", "Mars/Olympus")).toBeNull();
    expect(wallTimeToUtc("2026-99-99T99:99:00Z", "UTC")).toBeNull();
  });
  it("a wall time in the hour the clock skips lands on the first instant after it, never before", () => {
    // Los Angeles springs forward on 8 Mar 2026 at 2am: 02:30 does not exist. It moves forward by the gap to 03:30 PDT = 10:30Z,
    // the same reading a clock would give, and later than asked rather than earlier.
    expect(wallTimeToUtc("2026-03-08T02:30:00", "America/Los_Angeles")).toBe("2026-03-08T10:30:00.000Z");
    expect(wallTimeToUtc("2026-03-08T01:59:00", "America/Los_Angeles")).toBe("2026-03-08T09:59:00.000Z");
  });
  it("crosses a daylight-saving boundary correctly", () => {
    // Los Angeles falls back on 1 Nov 2026 at 2am; 8 Nov is PST (UTC-8), 25 Oct is PDT (UTC-7).
    expect(wallTimeToUtc("2026-10-25T09:00:00", "America/Los_Angeles")).toBe("2026-10-25T16:00:00.000Z");
    expect(wallTimeToUtc("2026-11-08T09:00:00", "America/Los_Angeles")).toBe("2026-11-08T17:00:00.000Z");
  });
});
