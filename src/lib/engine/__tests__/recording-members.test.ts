import { describe, expect, it } from "vitest";
import { groupActionItems, isFathomUrl, itemMoment, summaryMoment, timestampLabel, timestampSeconds, weekHeading } from "../recording-members";

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
  it("groups the steps by person: email, then full name; the coach as \"<name> (coach)\"; the viewer's own first, the rest alphabetical, Everyone last; call order inside (rev 619)", () => {
    const items = [
      item("one", "Jordan Lee", "j@x.test", "00:20:00"),
      item("two", "Maya", "m@x.test", "00:12:45"),
      item("three", null, null),
      item("four", "guest@else.test", null),
      item("five", "Kim Guest", "kim@else.test"),
      item("six", "Maya Torres", "M@x.test", "00:03:10"),
      item("seven", "Alex Shaw", null, "600"),
      item("eight", "Danno Hanfling", "danno@x.test", "00:01:00"),
      item("nine", "Jordan Lee", "jordan.other@else.test", "00:05:00"),
    ];
    const people = [{ name: "Maya Torres", email: "m@x.test" }, { name: "Jordan Lee", email: "j@x.test" }, { name: "Alex Shaw", email: "a@x.test" }, { name: "Danno Hanfling", email: "danno@x.test", coach: true }];
    const member = groupActionItems(items, people, { email: "m@x.test", name: "Maya Torres", role: "client" });
    // Maya's two in call order (3:10 before 12:45); Alex matched by name alone; Jordan's two by email and by name, in call order;
    // the coach as "Danno (coach)"; no one, a guest and an unknown email under Everyone, last.
    expect(member.map((g) => `${g.label}:${g.items.map((i) => i.index).join(",")}`)).toEqual(["Your action steps:5,1", "Alex Shaw:6", "Danno (coach):7", "Jordan Lee:8,0", "Everyone / unassigned:2,3,4"]);
    expect(member.find((g) => g.everyone)?.label).toBe("Everyone / unassigned");
    const coach = groupActionItems(items, people, { email: "danno@x.test", name: "Danno Hanfling", role: "coach" });
    expect(coach.map((g) => g.label)).toEqual(["Danno (coach)", "Alex Shaw", "Jordan Lee", "Maya Torres", "Everyone / unassigned"]);
    expect(JSON.stringify([...member, ...coach].map((g) => g.label))).not.toContain("@");
    // A name two people share is no match: it goes to Everyone rather than a guess.
    const twins = groupActionItems([item("x", "Sam Lee", null)], [{ name: "Sam Lee", email: "s1@x.test" }, { name: "Sam Lee", email: "s2@x.test" }], { email: "z@x.test", name: "Z", role: "client" });
    expect(twins.map((g) => g.label)).toEqual(["Everyone / unassigned"]);
    expect([timestampSeconds("00:12:45"), timestampSeconds("765"), timestampSeconds(null), timestampSeconds("soon")]).toEqual([765, 765, null, null]);
  });
  it("heads the list by week: this week, last week, then the week's Monday", () => {
    const now = new Date("2026-10-07T18:00:00Z"); // a Wednesday
    expect(weekHeading("2026-10-05T16:00:00Z", "America/Los_Angeles", now)).toBe("This week");
    expect(weekHeading("2026-10-02T16:00:00Z", "America/Los_Angeles", now)).toBe("Last week");
    expect(weekHeading("2026-09-22T16:00:00Z", "America/Los_Angeles", now)).toMatch(/^Week of Sep 21$/);
    expect(weekHeading(null, "UTC", now)).toBe("Date unknown");
  });
});
