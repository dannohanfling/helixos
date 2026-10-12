import { describe, expect, it } from "vitest";
import { pausedLine, safeNext } from "../next-path";
import { formatDateTime, instantOf } from "@/lib/dates";

describe("where sign-in goes next (rev 843)", () => {
  it("only HelixOS's own pages", () => {
    expect(safeNext("/goals?tab=x")).toBe("/goals?tab=x");
    expect(safeNext("//evil.example.com")).toBe("/today");
    expect(safeNext("/\\evil.example.com")).toBe("/today");
    expect(safeNext("https://evil.example.com")).toBe("/today");
    expect(safeNext("/today\n")).toBe("/today");
    expect(safeNext("/login?next=/x")).toBe("/today");
    expect(safeNext(null)).toBe("/today");
  });
  it("a pause says how long and that the right password waits too", () => {
    expect(pausedLine(30_000)).toMatch(/^Sign-in for this email is paused for 1 more minute after/);
    expect(pausedLine(12 * 60_000)).toContain("12 more minutes");
    expect(pausedLine(60_000)).toContain("Even the right password waits until then.");
  });
});

describe("times in the reader's zone (rev 843)", () => {
  it("a stored time with no zone is UTC, and the label says which zone", () => {
    expect(instantOf("2026-10-12 19:32:00").toISOString()).toBe("2026-10-12T19:32:00.000Z");
    expect(instantOf("2026-10-12T19:32:00.000Z").toISOString()).toBe("2026-10-12T19:32:00.000Z");
    expect(formatDateTime("2026-10-12 19:32:00", "America/New_York", { zone: true })).toBe("Oct 12, 3:32 PM EDT");
    expect(formatDateTime("2026-10-12 19:32:00", "America/Los_Angeles")).toBe("Oct 12, 12:32 PM");
  });
});
