import { describe, expect, it } from "vitest";
import { attendeeSummary, fewNames, groupKey, groupOf, minutesOf, suggestAudience, whyLine } from "../recording-review";
import { DEFAULT_RULES, ruleMatch } from "../recording-rules";

const coach = ["danno@evolve.test"];
const p = (name: string, email: string) => ({ name, email });
const members = [{ userId: "m1", name: "Maya Torres", email: "maya@x.test" }, { userId: "m2", name: "Jordan Lee", email: "jordan@x.test" }];

describe("reviewing recording drafts (rev 488)", () => {
  const R = DEFAULT_RULES;
  const at = (title: string, invitees: { name: string; email: string }[], startedAt: string | null = null) => {
    const match = ruleMatch(title, startedAt, R);
    const group = groupOf(title, invitees, coach, match, R);
    return { match, group, key: groupKey(group, title) };
  };
  it("groups each call by the coach's series and slots, then one-to-ones, and a call with only the coach in Just you", () => {
    const g = [p("Maya", "maya@x.test")];
    expect(at("Evolve Omega: Automation Accelerator – Week 3", g).group).toMatchObject({ key: "series-automation-accelerator", label: "Automation Accelerator" });
    expect(at("Community Building with Danno", g).group.label).toBe("Community Building");
    expect(at("Impromptu Zoom Meeting", g, "2026-10-09T20:00:00Z").group).toMatchObject({ key: "slot-evolve-omega-academy", label: "Evolve Omega Academy" });
    expect(at("Randy and Danno", g).group.key).toBe("one_to_one");
    expect(at("Team sync", g).group.key).toBe("other");
    expect(at("Impromptu Zoom Meeting", [p("Danno", "danno@evolve.test")], "2026-10-09T20:00:00Z").group.key).toBe("just_you");
    expect(at("Impromptu Zoom Meeting", []).group.key).toBe("just_you");
    expect(at("Automation Accelerator", g).group.order).toBeLessThan(at("Randy and Danno", g).group.order);
  });
  it("suggests by the rules first, then where it went last time, then the one member on the call", () => {
    const acc = at("Evolve Omega: Automation Accelerator", [p("Maya", "maya@x.test")]);
    expect(suggestAudience(acc.group, acc.key, acc.match, [], [{ key: acc.key, audience: "academy", audienceUserIds: [], publishedAt: "2026-10-01" }])).toEqual({ audience: "accelerator_academy", userIds: [], why: "series", detail: "Automation Accelerator" });
    const slot = at("Impromptu Zoom Meeting", [p("Maya", "maya@x.test")], "2026-10-05T16:07:00Z");
    const s = suggestAudience(slot.group, slot.key, slot.match, ["m1"], []);
    expect(s).toMatchObject({ audience: "accelerator_academy", why: "slot" });
    expect(whyLine(s!)).toBe("It started at Mon 9 AM, your Evolve Omega Accelerator time.");
    const other = at("Team sync", [p("Maya", "maya@x.test")]);
    expect(suggestAudience(other.group, other.key, null, ["m1"], [])).toEqual({ audience: "members", userIds: ["m1"], why: "one_member" });
    expect(suggestAudience(other.group, other.key, null, ["m1", "m2"], [])).toBeNull();
    expect(suggestAudience(other.group, other.key, null, ["m1", "m2"], [{ key: other.key, audience: "academy", audienceUserIds: [], publishedAt: "2026-10-01" }])).toEqual({ audience: "academy", userIds: [], why: "last" });
    const one = at("Maya and Danno", [p("Maya", "maya@x.test")]);
    expect(suggestAudience(one.group, one.key, null, ["m1", "m2"], [])).toEqual({ audience: "members", userIds: ["m1", "m2"], why: "one_to_one" });
    const alone = at("Impromptu Zoom Meeting", [], "2026-10-05T16:07:00Z");
    expect(suggestAudience(alone.group, alone.key, alone.match, [], [])).toBeNull();
  });
  it("remembers a recurring one-to-one by its title, dates aside", () => {
    const a = at("Randy and Danno 3 Oct", [p("R", "r@x.test")]);
    const b = at("Randy and Danno 10 Oct", [p("R", "r@x.test")]);
    expect(a.key).toBe(b.key);
    expect(suggestAudience(b.group, b.key, null, [], [{ key: a.key, audience: "members", audienceUserIds: ["m9"], publishedAt: "2026-10-03" }])).toEqual({ audience: "members", userIds: ["m9"], why: "last" });
  });
  it("says who was on the call without a guest's email", () => {
    const s = attendeeSummary([p("Maya Torres", "maya@x.test"), p("A guest", "guest@else.test"), p("", "raw@else.test"), p("Danno", "danno@evolve.test")], members, coach);
    expect(s.line).toBe("4 people: 1 member, 2 guests, and you");
    expect(s.memberNames).toEqual(["Maya Torres"]);
    expect(JSON.stringify(s)).not.toContain("@");
  });
  it("names three, then a count; and a call's minutes", () => {
    expect(fewNames(["A", "B"])).toBe("A, B");
    expect(fewNames(["A", "B", "C", "D", "E"])).toBe("A, B, C +2");
    expect(minutesOf("2026-10-01T10:00:00Z", "2026-10-01T10:55:00Z")).toBe(55);
    expect(minutesOf(null, "2026-10-01T10:55:00Z")).toBeNull();
  });
});
