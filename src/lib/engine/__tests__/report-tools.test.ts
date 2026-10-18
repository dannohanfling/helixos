import { describe, expect, it } from "vitest";
import { wellFormed } from "@/lib/engine/cut";
import { EXCERPT_CHARS, LIST_DEFAULT, LIST_MAX, excerpt, firstName, inState, listLimit, listRow } from "@/lib/engine/report-tools";
import { isCoachOwn } from "@/lib/mcp/registry";

// H-591: Issues and ideas on the connector. The list's filters, its cut and its sender, and who counts as the coach's own connection.
describe("reports on the connector (H-591)", () => {
  const fresh = { seenAt: null, doneAt: null };
  const seen = { seenAt: "2026-10-17 10:00:00", doneAt: null };
  const done = { seenAt: "2026-10-17 10:00:00", doneAt: "2026-10-17 11:00:00" };

  it("new is not Seen, open is not Done, all is every report", () => {
    expect([fresh, seen, done].map((r) => inState(r, "new"))).toEqual([true, false, false]);
    expect([fresh, seen, done].map((r) => inState(r, "open"))).toEqual([true, true, false]);
    expect([fresh, seen, done].map((r) => inState(r, "all"))).toEqual([true, true, true]);
  });

  it("lists 20 by default and never more than 50", () => {
    expect(listLimit(undefined)).toBe(LIST_DEFAULT);
    expect(listLimit(0)).toBe(1);
    expect(listLimit(7.9)).toBe(7);
    expect(listLimit(500)).toBe(LIST_MAX);
    expect(listLimit(Number.NaN)).toBe(LIST_DEFAULT);
  });

  it("cuts the description at 200 characters, never through an emoji", () => {
    expect(excerpt("  short  ")).toBe("short");
    const long = "a".repeat(199) + "🏟️" + "b".repeat(50);
    const cut = excerpt(long);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(EXCERPT_CHARS + 1);
    expect(wellFormed(cut)).toBe(cut);
  });

  it("names the sender by first name and member id only, and never carries the store address", () => {
    const row = listRow(
      { id: "r1", kind: "issue", severity: "red", page: "/today", description: "It broke", screenshotUrl: "https://store.example/reports/w1/r1.jpg", talkToCoach: false, seenAt: null, doneAt: null, createdAt: "2026-10-17 20:32:00" },
      { name: "Maya Torres", memberId: "m1" },
      "Oct 17, 1:32 PM PDT",
      "2026-10-17T20:32:00.000Z",
    );
    expect(row.sender).toEqual({ firstName: "Maya", memberId: "m1" });
    expect(row.hasScreenshot).toBe(true);
    expect(JSON.stringify(row)).not.toMatch(/store\.example|reports\/w1/);
    expect(row.createdAt).toBe("Oct 17, 1:32 PM PDT");
    expect(firstName(null)).toBe("A member");
  });

  it("the coach's own connection: the coach, not switched, not a team member, never an agent token", () => {
    const coach = { role: "coach" as const, switchedInto: null, team: null };
    expect(isCoachOwn({ agentToken: false, viewer: coach })).toBe(true);
    expect(isCoachOwn({ agentToken: true, viewer: coach })).toBe(false);
    expect(isCoachOwn({ agentToken: false, viewer: { ...coach, role: "client" } })).toBe(false);
    expect(isCoachOwn({ agentToken: false, viewer: { ...coach, switchedInto: { id: "x" } as never } })).toBe(false);
    expect(isCoachOwn({ agentToken: false, viewer: { ...coach, team: { id: "t" } as never } })).toBe(false);
    expect(isCoachOwn(undefined)).toBe(false);
  });
});
