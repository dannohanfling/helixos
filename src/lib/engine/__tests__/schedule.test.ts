import { describe, expect, it } from "vitest";
import { asRefusal, asTargetRefusal, parseScheduleReport, scheduleNeedsOwner, scheduleState, viaOwnersConnector } from "@/lib/engine/schedule";

const at = (s: string) => Date.parse(s);

describe("the Schedule board (H-1838, plan H-1843)", () => {
  it("a job is its last status until its next run is over an hour late with no report since: then it's missed", () => {
    const j = { lastStatus: "done" as const, lastAt: "2026-10-23T19:52:00Z", nextAt: "2026-10-24T19:50:00Z" };
    expect(scheduleState(j, at("2026-10-24T20:30:00Z"))).toBe("done");
    expect(scheduleState(j, at("2026-10-24T20:51:00Z"))).toBe("missed");
    expect(scheduleState({ ...j, lastStatus: "started", lastAt: "2026-10-24T19:51:00Z" }, at("2026-10-24T21:00:00Z"))).toBe("started");
    expect(scheduleState({ lastStatus: null, lastAt: null, nextAt: null }, at("2026-10-24T21:00:00Z"))).toBe("new");
  });
  it("counts on What needs you only when the job said it's the owner's to fix, and it failed or was missed", () => {
    const failed = { needsYou: true, lastStatus: "failed" as const, lastAt: "2026-10-24T19:51:00Z", nextAt: null };
    expect(scheduleNeedsOwner(failed, at("2026-10-24T20:00:00Z"))).toBe(true);
    expect(scheduleNeedsOwner({ ...failed, needsYou: false }, at("2026-10-24T20:00:00Z"))).toBe(false);
    expect(scheduleNeedsOwner({ ...failed, lastStatus: "done" }, at("2026-10-24T20:00:00Z"))).toBe(false);
    expect(scheduleNeedsOwner({ needsYou: true, lastStatus: "done", lastAt: "2026-10-23T19:52:00Z", nextAt: "2026-10-24T19:50:00Z" }, at("2026-10-24T21:00:00Z"))).toBe(true);
  });
  it("reads a report: job and status required, next_at as UTC, a key-like reason scrubbed", () => {
    expect(parseScheduleReport({ status: "done" })).toMatchObject({ ok: false });
    expect(parseScheduleReport({ job: "Daily triage", status: "finished" })).toMatchObject({ ok: false });
    expect(parseScheduleReport({ job: "Daily triage", status: "done", next_at: "tomorrow" })).toMatchObject({ ok: false });
    const r = parseScheduleReport({ job: "  Daily   Triage ", status: "failed", when: "Daily 12:50 PM PT", reason: "Flow limit sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", next_at: "2026-10-24T19:50:00Z", needs_you: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report).toMatchObject({ job: "Daily   Triage", jobKey: "daily triage", status: "failed", when: "Daily 12:50 PM PT", nextAt: "2026-10-24T19:50:00.000Z", needsYou: true, removed: 1 });
    expect(r.report.reason).not.toMatch(/sk-ant/);
  });
});

describe("Cowork agents speak as themselves with `as` (H-1843)", () => {
  const own = { agentToken: false, role: "coach", switched: false, team: false };
  it("only on the coach's own connector, signed in as themselves", () => {
    expect(asRefusal(own)).toBeNull();
    expect(asRefusal({ ...own, agentToken: true })).toMatch(/agent token/);
    expect(asRefusal({ ...own, switched: true })).toMatch(/switched/);
    expect(asRefusal({ ...own, team: true })).toMatch(/team member/);
    expect(asRefusal({ ...own, role: "client" })).toMatch(/coach/);
  });
  it("only names a Claude Cowork agent already on the Forum", () => {
    expect(asTargetRefusal("Pictor", { platform: "Claude Cowork" })).toBeNull();
    expect(asTargetRefusal("Pictor", null)).toMatch(/no agent called "Pictor"/);
    expect(asTargetRefusal("Hermes", { platform: "Claude Code" })).toMatch(/isn't a Claude Cowork agent/);
  });
  it("records the post as made through the owner's connector", () => {
    expect(viaOwnersConnector("Danno")).toBe("Danno's connector");
  });
});
