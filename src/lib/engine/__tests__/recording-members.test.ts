import { describe, expect, it } from "vitest";
import { groupActionItems, isFathomUrl, itemMoment, summaryMoment, timestampLabel, weekHeading } from "../recording-members";

const item = (description: string, assigneeName: string | null, assigneeEmail: string | null, timestamp: string | null = null, playbackUrl: string | null = null) => ({ description, completed: false, timestamp, playbackUrl, assigneeName, assigneeEmail });

describe("Recordings for members (revs 496 to 498)", () => {
  it("links a timestamp only into fathom.video, labelled as a clock", () => {
    expect(isFathomUrl("https://fathom.video/share/x?timestamp=5")).toBe(true);
    expect(isFathomUrl("https://app.fathom.video/calls/1")).toBe(true);
    expect(isFathomUrl("http://fathom.video/share/x")).toBe(false);
    expect(isFathomUrl("https://fathom.video.evil.test/x")).toBe(false);
    expect(isFathomUrl("javascript:alert(1)")).toBe(false);
    expect([timestampLabel("00:14:02"), timestampLabel("01:02:03"), timestampLabel("842"), timestampLabel("0:05")]).toEqual(["14:02", "1:02:03", "14:02", "0:05"]);
    expect(itemMoment(item("a", null, null, "00:09:12", "https://fathom.video/share/a?timestamp=552"), null)).toEqual({ href: "https://fathom.video/share/a?timestamp=552", label: "▶ 9:12" });
    expect(itemMoment(item("a", null, null, "00:01:00", "https://evil.test/x"), "https://fathom.video/share/a")).toEqual({ href: "https://fathom.video/share/a?timestamp=60", label: "▶ 1:00" });
    expect(itemMoment(item("a", null, null, "00:01:00", null), "https://evil.test/x")).toBeNull();
    expect(itemMoment(item("a", null, null, null, "https://fathom.video/share/a"), null)).toBeNull();
    expect(summaryMoment("https://fathom.video/share/a?timestamp=724")).toEqual({ href: "https://fathom.video/share/a?timestamp=724", label: "▶ 12:04" });
    expect(summaryMoment("https://example.com/x")).toBeNull();
  });
  it("groups the items under each person by email, the viewer's own first, Unassigned last, never an email as a name", () => {
    const items = [item("one", "Jordan Lee", "j@x.test"), item("two", "Maya", "m@x.test"), item("three", null, null), item("four", "guest@else.test", null), item("five", "Kim Guest", "kim@else.test"), item("six", "Maya Torres", "M@x.test")];
    const people = [{ name: "Maya Torres", email: "m@x.test" }, { name: "Jordan Lee", email: "j@x.test" }];
    const member = groupActionItems(items, people, { email: "m@x.test", name: "Maya Torres", role: "client" });
    expect(member.map((g) => `${g.label}:${g.items.map((i) => i.index).join(",")}`)).toEqual(["Yours:1,5", "Jordan Lee:0", "Kim Guest:4", "Unassigned:2,3"]);
    const coach = groupActionItems(items, people, { email: "danno@x.test", name: "Danno", role: "coach" });
    expect(coach.map((g) => g.label)).toEqual(["Jordan Lee", "Maya Torres", "Kim Guest", "Unassigned"]);
    expect(JSON.stringify(coach.map((g) => g.label))).not.toContain("@");
  });
  it("heads the list by week: this week, last week, then the week's Monday", () => {
    const now = new Date("2026-10-07T18:00:00Z"); // a Wednesday
    expect(weekHeading("2026-10-05T16:00:00Z", "America/Los_Angeles", now)).toBe("This week");
    expect(weekHeading("2026-10-02T16:00:00Z", "America/Los_Angeles", now)).toBe("Last week");
    expect(weekHeading("2026-09-22T16:00:00Z", "America/Los_Angeles", now)).toMatch(/^Week of Sep 21$/);
    expect(weekHeading(null, "UTC", now)).toBe("Date unknown");
  });
});
