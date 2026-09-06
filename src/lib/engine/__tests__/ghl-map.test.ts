import { describe, expect, it } from "vitest";
import { autoMap, candidates, mediaTypeFor, postTypeFor, readiness } from "../ghl-map";

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
    expect(m).toEqual({ fb_page: "p1", fb_group: "g1", stories: "ig", instagram: "ig", linkedin: "li" });
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
  it("counts readiness against publishable channels only", () => {
    expect(readiness(autoMap(accounts))).toEqual({ mapped: 5, total: 5 });
  });
  it("picks story type and media types", () => {
    expect(postTypeFor("stories")).toBe("story");
    expect(postTypeFor("instagram")).toBe("post");
    expect(mediaTypeFor("https://x/y.mp4?x=1")).toBe("video/mp4");
    expect(mediaTypeFor("https://x/y.PNG")).toBe("image/png");
    expect(mediaTypeFor("https://x/y")).toBe("image/jpeg");
  });
});
