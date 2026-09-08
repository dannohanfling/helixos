import { describe, expect, it } from "vitest";
import { candidates, classify, type PlannerPostLike, type TrackedLike } from "../planner-audit";

const tracked: TrackedLike[] = [{ variantId: "v1", externalId: "post_1", channel: "fb_page", body: "Twelve minutes on Tuesday.\nBeats three hours.", itemTitle: "GHL end to end", postAt: "2026-09-10T09:00:00" }];
const mapping = { fb_page: "acc_fb", instagram: "acc_ig" };
const planner: PlannerPostLike[] = [
  { id: "post_1", status: "scheduled", summary: "Twelve minutes on Tuesday.\nBeats three hours.", scheduleDate: "2026-09-10T09:00:00.000Z", accountIds: ["acc_fb"] },
  { id: "post_2", status: "scheduled", summary: "Twelve minutes on Tuesday.\nBeats three hours.", scheduleDate: "2026-09-10T09:00:00.000Z", accountIds: ["acc_fb"] },
  { id: "post_3", status: "scheduled", summary: "Something else entirely.", scheduleDate: "2026-09-12T09:00:00.000Z", accountIds: ["acc_fb"] },
];
const byId = new Map(planner.map((p) => [p.id, p]));

describe("planner audit: finding what HelixOS no longer tracks", () => {
  it("unions the sync log and the planner list and drops everything a variant tracks", () => {
    const c = candidates(tracked, [{ ghlPostId: "post_2", channel: "fb_page", accountId: "acc_fb", loggedAt: "2026-09-01T10:00:00Z" }, { ghlPostId: "post_1", channel: "fb_page", accountId: "acc_fb", loggedAt: "2026-09-01T09:00:00Z" }, { ghlPostId: "post_9", channel: "instagram", accountId: "acc_ig", loggedAt: "2026-08-01T09:00:00Z" }], planner);
    expect(c.map((x) => x.ghlPostId)).toEqual(["post_9", "post_2", "post_3"]);
    expect(c.find((x) => x.ghlPostId === "post_2")?.seenIn).toEqual(["log", "planner"]);
    expect(c.find((x) => x.ghlPostId === "post_3")?.seenIn).toEqual(["planner"]);
  });
  it("works from the log alone when the planner list is unavailable", () => {
    const c = candidates(tracked, [{ ghlPostId: "post_2", channel: "fb_page", accountId: "acc_fb", loggedAt: "2026-09-01T10:00:00Z" }], null);
    expect(c.map((x) => x.ghlPostId)).toEqual(["post_2"]);
  });
});

describe("planner audit: verdicts", () => {
  const cand = (id: string) => ({ ghlPostId: id, seenIn: ["planner" as const], channel: "fb_page", accountId: "acc_fb", loggedAt: null });
  it("calls a still-scheduled post with a tracked twin of the same text and account a duplicate, and only that", () => {
    const r = classify(cand("post_2"), byId.get("post_2")!, null, tracked, mapping, byId);
    expect(r.verdict).toBe("duplicate");
    expect(r.twin?.externalId).toBe("post_1");
    expect(r.twin?.sameTime).toBe(true);
  });
  it("leaves a different text to a person", () => {
    const r = classify(cand("post_3"), byId.get("post_3")!, null, tracked, mapping, byId);
    expect(r.verdict).toBe("orphan");
    expect(r.twin?.sameText).toBe(false);
  });
  it("compares against what HelixOS sent when the planner does not list the tracked post", () => {
    const live = { id: "post_2", status: "scheduled", summary: "Twelve minutes on Tuesday. Beats three hours.", scheduleDate: null, accountIds: ["acc_fb"] };
    const r = classify(cand("post_2"), live, null, tracked, mapping, new Map());
    expect(r.verdict).toBe("duplicate");
    expect(r.twin?.sameTime).toBe(false);
  });
  it("never calls a published, missing or unanswered post a duplicate", () => {
    expect(classify(cand("post_2"), { ...byId.get("post_2")!, status: "published" }, null, tracked, mapping, byId).verdict).toBe("published");
    expect(classify(cand("post_7"), null, null, tracked, mapping, byId).verdict).toBe("gone");
    expect(classify(cand("post_8"), null, "429 rate limited", tracked, mapping, byId).verdict).toBe("unknown");
  });
  it("does not match across accounts", () => {
    const live = { id: "post_5", status: "scheduled", summary: "Twelve minutes on Tuesday.\nBeats three hours.", scheduleDate: null, accountIds: ["acc_ig"] };
    const r = classify({ ...cand("post_5"), accountId: "acc_ig" }, live, null, tracked, mapping, byId);
    expect(r.verdict).toBe("orphan");
    expect(r.twin).toBeNull();
  });
});
