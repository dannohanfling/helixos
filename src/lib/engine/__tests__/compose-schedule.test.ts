import { describe, expect, it } from "vitest";
import { localIso, staggerSchedule, type Target } from "../compose";
import { classify, type PlannerPostLike, type TrackedLike } from "../planner-audit";

const t = (key: string, channel: string): Target => ({ key: key as Target["key"], channel: channel as Target["channel"], groupId: "", label: key, icon: "", maxChars: 1000 }) as unknown as Target;

describe("the schedule is wall-clock time in the member's own zone, whatever zone the code runs in", () => {
  it("staggers by arithmetic on the typed wall time: 09:00 stays 09:00, 45 minutes apart, in any runtime zone", () => {
    const out = staggerSchedule([t("ch:linkedin", "linkedin"), t("ch:fb_page", "fb_page")], localIso("2026-09-15", "09:00"));
    const times = [...out.values()].sort();
    expect(times[0]).toBe("2026-09-15T09:00");
    expect(times[1]).toBe("2026-09-15T09:45");
    expect(times.every((x) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x))).toBe(true);
  });
  it("a start that is not a wall time schedules nothing, never 1970", () => {
    expect(staggerSchedule([t("a", "fb_page")], "2026-09-15T:00").size).toBe(0);
    expect(staggerSchedule([t("a", "fb_page")], "").size).toBe(0);
  });
  it("carries across midnight by the calendar, not by the runtime's clock", () => {
    const out = staggerSchedule([t("a", "fb_page"), t("b", "linkedin"), t("c", "instagram")], "2026-09-15T23:30:00");
    expect([...out.values()].sort().at(-1)).toBe("2026-09-16T01:00");
  });
  it("the planner audit compares an instant with an instant when the planner list lacks the tracked post", () => {
    // postAt arrives already converted to UTC by the query; the live post carries GoHighLevel's Z time. Same instant: same time.
    const tracked: TrackedLike[] = [{ variantId: "v1", externalId: "post_gone", channel: "fb_page", body: "Same text.", itemTitle: "Post", postAt: "2026-09-15T16:00:00.000Z" }];
    const live: PlannerPostLike = { id: "post_9", status: "scheduled", summary: "Same text.", scheduleDate: "2026-09-15T16:00:00.000Z", accountIds: ["acc_fb"] };
    const r = classify({ ghlPostId: "post_9", seenIn: ["planner"], channel: "fb_page", accountId: "acc_fb", loggedAt: null }, live, null, tracked, { fb_page: "acc_fb" }, new Map());
    expect(r.verdict).toBe("duplicate");
    expect(r.twin?.sameTime).toBe(true);
  });
});
