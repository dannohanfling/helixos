import { describe, expect, it } from "vitest";
import { agoWords, boardStale, certLevel, certWords, certsToFlag, daysLeft, nextRateLimit, outboxCounts, rateLimitsShown, readExpiry, readPassTypeId } from "@/lib/engine/loyalty-health";

const now = new Date("2026-10-18T12:00:00Z");

describe("certificates (H-622 §2.2)", () => {
  it("counts whole days to the end of the expiry day", () => {
    expect(daysLeft("2026-10-18", now)).toBe(0);
    expect(daysLeft("2026-10-19", now)).toBe(1);
    expect(daysLeft("2027-01-03", now)).toBe(77);
    expect(daysLeft("2026-10-15", now)).toBe(-3);
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft("not a date", now)).toBeNull();
  });
  it("is amber under 60 days, red under 14, expired after the day", () => {
    expect(certLevel(null, now)).toBe("none");
    expect(certLevel("2027-11-01", now)).toBe("ok");
    expect(certLevel("2026-12-17", now)).toBe("ok"); // 60 days
    expect(certLevel("2026-12-16", now)).toBe("amber"); // 59 days
    expect(certLevel("2026-11-01", now)).toBe("amber"); // 14 days
    expect(certLevel("2026-10-31", now)).toBe("red"); // 13 days
    expect(certLevel("2026-10-17", now)).toBe("expired");
  });
  it("says it in words", () => {
    expect(certWords(null, now)).toBe("No date yet");
    expect(certWords("2026-10-18", now)).toBe("Expires today");
    expect(certWords("2026-10-19", now)).toBe("1 day left");
    expect(certWords("2027-01-03", now)).toBe("77 days left");
    expect(certWords("2026-10-17", now)).toBe("Expired 1 day ago");
  });
  it("names programs under 30 days on Coach, soonest first", () => {
    const rows = [
      { name: "Far", certExpiresAt: "2027-11-01" },
      { name: "Soon", certExpiresAt: "2026-11-10" },
      { name: "Sooner", certExpiresAt: "2026-10-25" },
      { name: "None", certExpiresAt: null },
    ];
    expect(certsToFlag(rows, now)).toEqual([{ name: "Sooner", days: 7 }, { name: "Soon", days: 23 }]);
  });
});

describe("typed values", () => {
  it("accepts a real date or blank, and refuses anything else", () => {
    expect(readExpiry("")).toEqual({ ok: true, value: null });
    expect(readExpiry("2027-01-03")).toEqual({ ok: true, value: "2027-01-03" });
    expect(readExpiry("2027-02-30").ok).toBe(false);
    expect(readExpiry("03/01/2027").ok).toBe(false);
  });
  it("accepts a Pass Type ID in reverse-domain form", () => {
    expect(readPassTypeId(" pass.com.evolveomega ")).toEqual({ ok: true, value: "pass.com.evolveomega" });
    expect(readPassTypeId("")).toEqual({ ok: true, value: null });
    expect(readPassTypeId("com.evolveomega").ok).toBe(false);
    expect(readPassTypeId("pass.com.<script>").ok).toBe(false);
  });
});

describe("429s in 24 hours (H-622 §2.5)", () => {
  it("counts within the window and starts a new one after 24 hours", () => {
    const first = nextRateLimit(0, null, now);
    expect(first).toEqual({ count: 1, at: now.toISOString() });
    const later = new Date(now.getTime() + 3_600_000);
    expect(nextRateLimit(first.count, first.at, later)).toEqual({ count: 2, at: now.toISOString() });
    const nextDay = new Date(now.getTime() + 86_400_000);
    expect(nextRateLimit(5, first.at, nextDay)).toEqual({ count: 1, at: nextDay.toISOString() });
  });
  it("shows the count only inside the window", () => {
    expect(rateLimitsShown(3, now.toISOString(), new Date(now.getTime() + 60_000))).toBe(3);
    expect(rateLimitsShown(3, now.toISOString(), new Date(now.getTime() + 86_400_000))).toBe(0);
    expect(rateLimitsShown(0, null, now)).toBe(0);
  });
});

describe("the board and the outbox", () => {
  it("calls a board stale after 30 minutes, or with none", () => {
    expect(boardStale(new Date(now.getTime() - 29 * 60_000).toISOString(), now)).toBe(false);
    expect(boardStale(new Date(now.getTime() - 31 * 60_000).toISOString(), now)).toBe(true);
    expect(boardStale(null, now)).toBe(true);
  });
  it("says how long ago", () => {
    expect(agoWords(null, now)).toBe("never");
    expect(agoWords(new Date(now.getTime() - 20_000).toISOString(), now)).toBe("just now");
    expect(agoWords(new Date(now.getTime() - 12 * 60_000).toISOString(), now)).toBe("12 min ago");
    expect(agoWords(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now)).toBe("3 h ago");
    expect(agoWords(new Date(now.getTime() - 3 * 86_400_000).toISOString(), now)).toBe("3 days ago");
  });
  it("counts waiting now, and failed and sent in the last 7 days, with the latest move", () => {
    const moves = [
      { status: "pending", createdAt: "2026-10-18 11:00:00", sentAt: null, lastNote: null },
      { status: "sent", createdAt: "2026-10-17 09:00:00", sentAt: "2026-10-17T09:00:05Z", lastNote: null },
      { status: "failed", createdAt: "2026-10-16 09:00:00", sentAt: null, lastNote: "no customer id" },
      { status: "sent", createdAt: "2026-10-01 09:00:00", sentAt: "2026-10-01T09:00:05Z", lastNote: null },
      { status: "failed", createdAt: "2026-09-30 09:00:00", sentAt: null, lastNote: "no customer id" },
    ];
    const c = outboxCounts(moves, now);
    expect(c).toMatchObject({ waiting: 1, failed7: 1, sent7: 1 });
    expect(c.last).toEqual({ at: "2026-10-18T11:00:00.000Z", status: "pending", note: null });
    expect(outboxCounts([], now)).toEqual({ waiting: 0, failed7: 0, sent7: 0, last: null });
  });
});
