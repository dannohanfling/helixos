import { describe, expect, it } from "vitest";
import { assignSteps, canSee, intake, inviteeMembers, meetingFields, programInAudience, shownTitle, signStandardWebhook, verifyStandardWebhook } from "@/lib/engine/recordings";
import { DEFAULT_RULES } from "@/lib/engine/recording-rules";

describe("audience by program (rev 263; Elite and Luxe are Academy and above)", () => {
  it("Accelerator calls go to everyone, Academy calls to Academy and above", () => {
    for (const t of ["Accelerator", "Academy", "Elite", "Luxe"]) expect(programInAudience("accelerator_academy", t), t).toBe(true);
    expect(programInAudience("academy", "Accelerator")).toBe(false);
    for (const t of ["Academy", "Elite", "Luxe"]) expect(programInAudience("academy", t), t).toBe(true);
    expect(programInAudience("members", "Luxe")).toBe(false);
  });
  it("a draft is visible to nobody; named members see only their own", () => {
    const maya = { userId: "u1", programTier: "Elite", role: "client" as const };
    const jordan = { userId: "u2", programTier: "Academy", role: "client" as const };
    expect(canSee({ status: "draft", audience: "accelerator_academy", audienceUserIds: [] }, maya)).toBe(false);
    expect(canSee({ status: "published", audience: "members", audienceUserIds: ["u1"] }, maya)).toBe(true);
    expect(canSee({ status: "published", audience: "members", audienceUserIds: ["u1"] }, jordan)).toBe(false);
    expect(canSee({ status: "published", audience: "academy", audienceUserIds: [] }, jordan)).toBe(true);
    expect(canSee({ status: "published", audience: null, audienceUserIds: [] }, jordan)).toBe(false);
  });
});

describe("intake: what an arriving meeting becomes (rev 491: Danno's series and slots)", () => {
  const from = "2026-10-01T00:00:00Z";
  const coach = ["coach@evolve.test"];
  const group = [{ name: "Maya", email: "maya@x.test" }, { name: "Danno", email: "coach@evolve.test" }];
  const at = (title: string, startedAt: string, invitees = group) => intake({ title, startedAt, createdAt: null, invitees }, from, DEFAULT_RULES, coach);
  it("a series named in the title publishes at once, whatever the punctuation", () => {
    expect(at("Evolve Omega: Automation Accelerator", "2026-10-06T17:00:00Z")).toEqual({ status: "published", audience: "accelerator_academy", titleMatch: "exact", note: null, clearTitle: null });
    expect(at("evolve omega | COMMUNITY-BUILDING", "2026-10-06T17:00:00Z")).toMatchObject({ status: "published", audience: "academy" });
  });
  it("a call no series names publishes by its slot, with HelixOS's clear title", () => {
    // Monday 9:07 AM in Los Angeles: the Accelerator slot.
    expect(at("Impromptu Zoom Meeting", "2026-10-05T16:07:00Z")).toEqual({ status: "published", audience: "accelerator_academy", titleMatch: "slot", note: null, clearTitle: "Evolve Omega Accelerator · Mon 9 AM" });
  });
  it("only the coach on the call stays a draft, even inside a slot; so does anything recorded before the rules", () => {
    expect(at("Impromptu Zoom Meeting", "2026-10-05T16:07:00Z", [{ name: "Danno", email: "coach@evolve.test" }])).toMatchObject({ status: "draft", audience: null });
    expect(at("Evolve Omega: Business Strategy", "2026-09-20T17:00:00Z")).toEqual({ status: "draft", audience: null, titleMatch: "exact", note: null, clearTitle: null });
    expect(at("Team sync", "2026-10-06T23:00:00Z")).toEqual({ status: "draft", audience: null, titleMatch: "none", note: null, clearTitle: null });
  });
  it("shows HelixOS's title when a slot gave one, else Fathom's", () => {
    expect(shownTitle({ title: "Impromptu Zoom Meeting", clearTitle: "Evolve Omega Academy · Fri 1 PM" })).toBe("Evolve Omega Academy · Fri 1 PM");
    expect(shownTitle({ title: "Team sync", clearTitle: null })).toBe("Team sync");
  });
});

describe("meeting fields, invitees and steps", () => {
  const raw = {
    recording_id: 9101,
    title: "Evolve Omega Accelerator – Week 3",
    url: "https://fathom.video/calls/815301799",
    share_url: "https://fathom.video/share/acc-9101",
    created_at: "2026-10-02T17:00:00Z",
    recording_start_time: "2026-10-02T17:01:00Z",
    recording_end_time: "2026-10-02T17:55:00Z",
    calendar_invitees: [{ name: "Maya Torres", email: "Client@demo.helixos.app" }, { name: "Danno Hanfling", email: "coach@demo.helixos.app" }, { name: "", email: "" }],
    default_summary: { template_name: "general", markdown_formatted: "## Purpose\nWeek 3." },
    action_items: [
      { description: "Post the comment ladder on Thursday", completed: false, recording_timestamp: "00:14:02", recording_playback_url: "https://fathom.video/share/acc-9101?timestamp=842", assignee: { name: "Maya Torres", email: "client@demo.helixos.app" } },
      { description: "Send the replay link", completed: false, assignee: { name: "Danno Hanfling", email: null } },
      { description: "   ", completed: false },
    ],
  };
  it("keeps what the row needs and drops empty items and invitees", () => {
    const f = meetingFields(raw)!;
    expect(f.fathomRecordingId).toBe("9101");
    expect(f.startedAt).toBe("2026-10-02T17:01:00Z");
    expect(f.summary).toContain("Week 3");
    expect(f.actionItems).toHaveLength(2);
    expect(f.actionItems[0]).toMatchObject({ assigneeEmail: "client@demo.helixos.app", timestamp: "00:14:02" });
    expect(f.invitees).toEqual([{ name: "Maya Torres", email: "client@demo.helixos.app" }, { name: "Danno Hanfling", email: "coach@demo.helixos.app" }]);
    expect(meetingFields({ title: "no id" })).toBeNull();
  });
  it("the members on the call are found by email, whatever the case", () => {
    const f = meetingFields(raw)!;
    expect(inviteeMembers(f.invitees, [{ userId: "u1", email: "client@demo.helixos.app", name: "Maya Torres" }, { userId: "u2", email: "client2@demo.helixos.app", name: "Jordan Lee" }])).toEqual(["u1"]);
  });
  it("a step lands on the audience member the assignee email names, or an unambiguous name; never a guess", () => {
    const f = meetingFields(raw)!;
    const audience = [
      { userId: "u1", email: "client@demo.helixos.app", name: "Maya Torres" },
      { userId: "u3", email: "d1@example.com", name: "Danno Hanfling" },
      { userId: "u4", email: "d2@example.com", name: "Danno Hanfling" },
    ];
    expect(assignSteps(f.actionItems, audience)).toEqual([{ itemIndex: 0, userId: "u1", text: "Post the comment ladder on Thursday", assigneeEmail: "client@demo.helixos.app" }]);
    expect(assignSteps(f.actionItems, audience.slice(0, 2))).toHaveLength(2);
    expect(assignSteps(f.actionItems, [{ userId: "u2", email: "client2@demo.helixos.app", name: "Jordan Lee" }])).toEqual([]);
  });
});

describe("Standard Webhooks signature (how Fathom signs)", () => {
  const secret = `whsec_${Buffer.from("a-secret-of-thirty-two-bytes-long!!").toString("base64")}`;
  const body = JSON.stringify({ recording_id: 1, title: "Evolve Omega Academy" });
  const now = 1_790_000_000_000;
  const ts = String(Math.floor(now / 1000));
  it("accepts a fresh, correctly signed call and refuses a tampered body, a wrong secret, an old timestamp or a missing header", () => {
    const sig = signStandardWebhook(secret, "msg_1", ts, body);
    expect(verifyStandardWebhook(secret, { id: "msg_1", timestamp: ts, signature: sig }, body, now)).toEqual({ ok: true });
    expect(verifyStandardWebhook(secret, { id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sig}` }, body, now)).toEqual({ ok: true });
    expect(verifyStandardWebhook(secret, { id: "msg_1", timestamp: ts, signature: sig }, body.replace("Academy", "Accelerator"), now).ok).toBe(false);
    expect(verifyStandardWebhook("whsec_b3RoZXI=", { id: "msg_1", timestamp: ts, signature: sig }, body, now).ok).toBe(false);
    expect(verifyStandardWebhook(secret, { id: "msg_1", timestamp: ts, signature: sig }, body, now + 10 * 60 * 1000).ok).toBe(false);
    expect(verifyStandardWebhook(secret, { id: null, timestamp: ts, signature: sig }, body, now).ok).toBe(false);
    expect(verifyStandardWebhook("", { id: "msg_1", timestamp: ts, signature: sig }, body, now).ok).toBe(false);
  });
});
