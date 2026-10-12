import { describe, expect, it } from "vitest";
import { ADD_PERMISSION, PICTURE_CHANNELS, held, instagramCause, jpegPlan, mediaScopeMissing } from "../post-picture";
import { fixFor, outcomeOf } from "../channel-outcome";
import { GHL_SCOPES } from "../ghl-scopes";

describe("the picture every channel takes (rev 840)", () => {
  it("a made graphic goes at 1080 × 1350; photos keep Instagram's frame and stay at most 1440 on the long side", () => {
    expect(jpegPlan(2160, 2700, "graphic")).toEqual({ width: 1080, height: 1350 });
    expect(jpegPlan(1200, 1500, "photo")).toEqual({ width: 1152, height: 1440 });
    // Taller than 4:5 is cropped to 4:5; wider than 1.91:1 to 1.91:1; then scaled.
    expect(jpegPlan(1000, 2000, "photo")).toEqual({ width: 1000, height: 1250 });
    const wide = jpegPlan(4000, 1000, "photo");
    expect(wide.width / wide.height).toBeCloseTo(1.91, 2);
    expect(Math.max(...Object.values(jpegPlan(4000, 3000, "photo")))).toBe(1440);
  });
  it("covers the Page, Instagram feed and Stories, LinkedIn and Threads, and never a personal profile or group", () => {
    for (const c of ["fb_page", "instagram", "stories", "linkedin", "threads"]) expect(PICTURE_CHANNELS.has(c)).toBe(true);
    for (const c of ["fb_personal", "fb_group", "other_groups", "email", "skool"]) expect(PICTURE_CHANNELS.has(c)).toBe(false);
  });
  it("medias.write is on the list the member copies, and in use now", () => {
    expect(GHL_SCOPES.find((s) => s.scope === "medias.write")?.use).toBe("now");
    expect(mediaScopeMissing(403, "The token does not have access to this scope: medias.write")).toBe(true);
    expect(mediaScopeMissing(403, "This location is on hold due to a failed payment.")).toBe(false);
    expect(mediaScopeMissing(422, "medias.write")).toBe(false);
  });
});

describe("failing loudly (rev 840)", () => {
  it("names Instagram's real cause", () => {
    expect(instagramCause("anything", { caption: "x", hasPicture: false })).toMatch(/needs a picture/);
    expect(instagramCause("media should not be empty", { caption: "x", hasPicture: true })).toMatch(/needs a picture/);
    expect(instagramCause("refused", { caption: "y".repeat(2300), hasPicture: true })).toBe("Instagram takes a caption of 2,200 characters at most; this one is 2,300.");
    expect(instagramCause("The aspect ratio is not supported", { caption: "x", hasPicture: true })).toMatch(/4:5 to 1\.91:1/);
    expect(instagramCause("something else entirely", { caption: "x", hasPicture: true })).toBeNull();
  });
  it("a channel held for its picture offers Retry; a missing permission points to Publishing", () => {
    expect(fixFor(held("the picture couldn't be read"))).toEqual({ where: "again", label: "Retry" });
    expect(fixFor(ADD_PERMISSION)).toEqual({ where: "publishing", label: "Add the permission" });
    const row = { id: "v", channel: "instagram", groupId: "", status: "scheduled", postAt: null, postedAt: null, externalId: null, externalStatus: "failed", externalError: held("GoHighLevel didn't take the picture (500)."), externalSyncedAt: null, createdAt: "2026-10-12T00:00:00Z" };
    const o = outcomeOf(row as Parameters<typeof outcomeOf>[0], { wall: "2026-10-12T10:00", iso: "2026-10-12T17:00:00Z", today: "2026-10-12", tz: "America/Los_Angeles" });
    expect(o.state).toBe("failed");
    expect(o.canRetry).toBe(true);
    expect(o.reason).toBe("Picture didn't attach: GoHighLevel didn't take the picture.");
  });
});
