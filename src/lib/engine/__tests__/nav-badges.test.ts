import { describe, expect, it } from "vitest";
import { badgeText, moreTab } from "../nav-badges";
import { NAV_GROUPS } from "@/components/nav-groups";

const coachMenu = ["/today", "/intentions", "/whats-new", "/coach", "/coach/inbox", "/coach/reports", "/coach/feedback"];

describe("moreTab", () => {
  it("adds up every shown count, What's new left out", () => {
    const tab = moreTab({ "/intentions": 1, "/whats-new": 4, "/coach/inbox": 2, "/coach/reports": 0, "/coach": 3 }, coachMenu);
    expect(tab).toEqual({ count: 6, text: "6", dot: false, label: "More, 6 waiting" });
  });
  it("is a plain dot for What's new alone", () => {
    expect(moreTab({ "/whats-new": 2, "/coach/inbox": 0 }, coachMenu)).toEqual({ count: 0, text: "0", dot: true, label: "More, something new" });
  });
  it("is nothing with nothing waiting", () => {
    expect(moreTab({ "/intentions": 0, "/whats-new": 0 }, coachMenu)).toEqual({ count: 0, text: "0", dot: false, label: "More" });
    expect(moreTab({}, [])).toMatchObject({ count: 0, dot: false });
  });
  it("leaves out a count for an item the menu doesn't show (a team member's Intentions)", () => {
    expect(moreTab({ "/intentions": 2, "/whats-new": 0 }, ["/today", "/whats-new"])).toMatchObject({ count: 0, dot: false, label: "More" });
    expect(moreTab({ "/intentions": 2, "/whats-new": 1 }, ["/today", "/whats-new"])).toMatchObject({ count: 0, dot: true });
  });
  it("caps the number at 9+, the label keeps the full count", () => {
    const tab = moreTab({ "/coach/inbox": 12, "/coach": 1 }, coachMenu);
    expect(tab.text).toBe("9+");
    expect(tab.label).toBe("More, 13 waiting");
  });
});

describe("badgeText", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [9, "9"],
    [10, "9+"],
    [250, "9+"],
  ])("%i reads %s", (n, text) => expect(badgeText(n)).toBe(text));
});

describe("every counted item is a menu item", () => {
  it("each badge href is in the menu, so the More page can show it", () => {
    const hrefs = new Set(NAV_GROUPS.flatMap((g) => g.items.map((n) => n.href)));
    // What's new is no menu item since H-164 §10: its count is the dot on the version line, under the logo and on the More page.
    for (const h of ["/intentions", "/coach/reports", "/coach/feedback", "/recordings", "/coach", "/coach#verify", "/coach/inbox", "/forum/inbox"]) expect(hrefs.has(h), h).toBe(true);
    expect(hrefs.has("/whats-new")).toBe(false);
  });
});
