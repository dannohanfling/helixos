import { describe, expect, it } from "vitest";
import { PUBLISHABLE,autoMap, candidates, mediaTypeFor, postTypeFor, readiness, manualChannelsSentence, publishedChannelsSentence } from "../ghl-map";

const accounts = [
  { id: "p1", name: "Page", platform: "facebook", type: "page", isExpired: false },
  { id: "g1", name: "Group", platform: "facebook", type: "group", isExpired: false },
  { id: "ig", name: "@me", platform: "instagram", type: "business", isExpired: false },
  { id: "li", name: "Me", platform: "linkedin", type: "profile", isExpired: false },
  { id: "old", name: "Expired", platform: "linkedin", type: "page", isExpired: true },
];

describe("ghl-map", () => {
  it("maps each publishable channel to the obvious account and never to an expired one", () => {
    const m = autoMap(accounts);
    // A Facebook group account is never mapped: Meta removed group posting for third-party tools in April 2024.
    expect(m).toEqual({ fb_page: "p1", stories: "ig", instagram: "ig", linkedin: "li" });
  });
  it("keeps an explicit \"don't auto-publish\" through the next check", () => {
    const m = autoMap(accounts, { linkedin: "" });
    expect(m.linkedin).toBe("");
    expect(readiness(m).mapped).toBe(3);
  });
  it("keeps a user's own choice and drops one whose account disappeared", () => {
    const m = autoMap(accounts, { linkedin: "old", fb_page: "p1" });
    expect(m.linkedin).toBe("li");
    expect(m.fb_page).toBe("p1");
  });
  it("offers only fitting candidates per channel", () => {
    expect(candidates("fb_group", accounts).map((a) => a.id)).toEqual(["g1"]);
    expect(candidates("threads", accounts)).toEqual([]);
  });
  it("counts readiness against publishable channels only: six, Threads among them", () => {
    expect(readiness(autoMap(accounts))).toEqual({ mapped: 4, total: 5 });
    const threads = { id: "6a944bb64bd88daddf7716f3_loc_28181292148220928_profile", name: "@me", platform: "threads", type: "profile", isExpired: false };
    expect(autoMap([...accounts, threads]).threads).toBe(threads.id);
    expect(candidates("threads", [...accounts, threads]).map((a) => a.id)).toEqual([threads.id]);
    expect(readiness(autoMap([...accounts, threads]))).toEqual({ mapped: 5, total: 5 });
  });
  it("what stays copy-and-paste and what publishes are said from the map, once, and Threads is on the publishing side", () => {
    expect(manualChannelsSentence()).toBe("Facebook personal, Your Facebook group, Other people's groups, Email and Skool community stay copy-and-paste. That's a platform limit, not ours.");
    expect(PUBLISHABLE.fb_group.via).toBeNull();
    expect(publishedChannelsSentence()).toContain("Threads");
    expect(publishedChannelsSentence()).not.toContain("Facebook personal");
    expect(PUBLISHABLE.threads.via).toBe("threads");
  });
  it("picks story type and media types", () => {
    expect(postTypeFor("stories")).toBe("story");
    expect(postTypeFor("instagram")).toBe("post");
    expect(mediaTypeFor("https://x/y.mp4?x=1")).toBe("video/mp4");
    expect(mediaTypeFor("https://x/y.PNG")).toBe("image/png");
    expect(mediaTypeFor("https://x/y")).toBe("image/jpeg");
  });
});
