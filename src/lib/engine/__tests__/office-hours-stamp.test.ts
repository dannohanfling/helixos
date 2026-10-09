import { describe, expect, it } from "vitest";
import { byStamp, stampLine, storedUtc } from "../office-hours";

/** Office Hours: when the client sent a request, and when they changed it (rev 625). */
describe("Office Hours: Submitted and Edited, in the viewer's zone", () => {
  it("reads SQLite's own time as UTC and an ISO string as it is", () => {
    expect(storedUtc("2026-10-09 17:42:07")?.toISOString()).toBe("2026-10-09T17:42:07.000Z");
    expect(storedUtc("2026-10-09T17:42:07.000Z")?.toISOString()).toBe("2026-10-09T17:42:07.000Z");
    expect(storedUtc(null)).toBeNull();
    expect(storedUtc("not a time")).toBeNull();
  });
  it("says the day, the time and the zone; today and yesterday in words; the title carries seconds", () => {
    const la = "America/Los_Angeles";
    expect(stampLine("Submitted", "2026-10-09 17:42:07", la, "2026-10-16").label).toBe("Submitted Fri, Oct 9 · 10:42 AM PT");
    expect(stampLine("Submitted", "2026-10-09 17:42:07", la, "2026-10-09").label).toBe("Submitted today, 10:42 AM PT");
    expect(stampLine("Submitted", "2026-10-09 17:42:07", la, "2026-10-10").label).toBe("Submitted yesterday, 10:42 AM PT");
    expect(stampLine("Edited", "2026-10-09T18:05:00.000Z", la, "2026-10-16").label).toBe("Edited Oct 9 · 11:05 AM PT");
    expect(stampLine("Submitted", "2026-10-09 17:42:07", la, "2026-10-16").title).toContain("10:42:07");
    // The same instant reads in the coach's zone and the client's own.
    expect(stampLine("Submitted", "2026-10-09 17:42:07", "Europe/London", "2026-10-16").label).toBe("Submitted Fri, Oct 9 · 6:42 PM United Kingdom Time");
    expect(stampLine("Submitted", null, la, "2026-10-16")).toEqual({ label: "Submitted: date unknown", title: "" });
  });
  it("orders newest first, or oldest first when asked", () => {
    const rows = [{ id: "a", createdAt: "2026-10-09 10:00:00" }, { id: "b", createdAt: "2026-10-09T12:00:00.000Z" }, { id: "c", createdAt: "2026-10-08 23:00:00" }];
    expect([...rows].sort(byStamp("newest")).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect([...rows].sort(byStamp("oldest")).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
