import { describe, expect, it } from "vitest";
import { alignPost } from "../groups";
import { staleScheduled } from "../ladder";
import { CHANNEL_SPECS, hashtagsFor, repurpose, repurposeAll } from "../repurpose";

const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const base = { title: "Why most diets fail by week 3", hook: "It's not willpower. It's the plan.", body: "Most plans ask for 3 hours on Sunday.\nNobody has 3 hours on Sunday.\nYou need 12 minutes on Tuesday.", hasCta: true, hashtag: "#daily", firstName: "Sarah" };
const CTA = "Comment PLAN and I'll send the 12-minute version.";

describe("the CTA is its own field, composed once at render", () => {
  it("places the chosen CTA exactly once on every channel that carries a CTA and never a canned one beside it", () => {
    for (const v of repurposeAll({ ...base, ctaText: CTA })) {
      const spec = CHANNEL_SPECS.find((c) => c.key === v.channel)!;
      if (["other_groups", "threads", "skool", "fb_group"].includes(v.channel)) {
        expect(count(v.body, CTA), v.channel).toBe(0);
        continue;
      }
      expect(count(v.body, CTA), v.channel).toBe(1);
      expect(v.body, v.channel).not.toMatch(/Want the full version|Link in bio|Full breakdown in the first comment|DM me "more"|If you want the full breakdown/);
      expect(v.body.length).toBeLessThanOrEqual(spec.maxChars + 20);
    }
  });
  it("keeps each channel's own default line when no CTA was chosen", () => {
    expect(repurpose(base, "fb_personal").body).toContain("Want the full version?");
    expect(repurpose(base, "instagram").body).toContain("Link in bio");
    expect(repurpose({ ...base, ctaText: "   " }, "email").body).toContain("If you want the full breakdown");
  });
  it("does not add a CTA when the post has none, whatever the field says", () => {
    expect(repurpose({ ...base, hasCta: false, ctaText: CTA }, "fb_personal").body).not.toContain(CTA);
  });
  it("is stable across re-renders: rendering the rendered version does not grow it", () => {
    const once = repurpose({ ...base, ctaText: CTA }, "fb_page").body;
    const again = repurpose({ ...base, body: base.body, ctaText: CTA }, "fb_page").body;
    expect(again).toBe(once);
  });
  it("uses the chosen CTA in the client's own group and never in a guest group", () => {
    expect(count(alignPost({ ...base, ctaText: CTA }, { name: "Mine", kind: "own" }).body, CTA)).toBe(1);
    expect(alignPost({ ...base, ctaText: CTA }, { name: "Theirs", kind: "prospect", rules: "No links. No self-promo." }).body).not.toContain(CTA);
  });
  it("does not tag a body twice when the hashtag line is already in it", () => {
    const tags = hashtagsFor(base);
    const withTags = { ...base, body: `${base.body}\n${tags}` };
    expect(count(repurpose(withTags, "instagram").body, tags)).toBe(1);
    expect(count(repurpose(withTags, "linkedin").body, tags)).toBe(1);
    expect(count(repurpose(base, "instagram").body, tags)).toBe(1);
  });
});

describe("the seam between a ladder and its schedule", () => {
  const l = { copy: "New body.\nRead them in order. 👇\nWhat would you add?", hook: "New hook", igCaption: "New caption", threadsChain: ["one", "two"] };
  const v = (over: Partial<Parameters<typeof staleScheduled>[1][number]>) => ({ id: "v1", channel: "fb_page", groupId: "", status: "scheduled", body: "Old body", postAt: "2026-09-10T09:00:00", externalId: null, externalStatus: null, ...over });
  it("names a scheduled channel post whose text is older than the ladder's", () => {
    const out = staleScheduled(l, [v({})]);
    expect(out).toEqual([{ variantId: "v1", channel: "fb_page", body: l.copy, postAt: "2026-09-10T09:00:00", inGhl: false }]);
  });
  it("marks the ones GoHighLevel holds as scheduled, and only those", () => {
    expect(staleScheduled(l, [v({ externalId: "post_1", externalStatus: "scheduled" })])[0].inGhl).toBe(true);
    expect(staleScheduled(l, [v({ externalId: "post_1", externalStatus: "published" })])[0].inGhl).toBe(false);
    expect(staleScheduled(l, [v({ externalId: null, externalStatus: "manual" })])[0].inGhl).toBe(false);
  });
  it("is quiet for posts that already match, drafts, posted ones and group posts", () => {
    expect(staleScheduled(l, [v({ body: l.copy })])).toEqual([]);
    expect(staleScheduled(l, [v({ status: "draft" })])).toEqual([]);
    expect(staleScheduled(l, [v({ status: "posted" })])).toEqual([]);
    expect(staleScheduled(l, [v({ groupId: "g1" })])).toEqual([]);
  });
  it("compares each channel to its own ladder text", () => {
    const out = staleScheduled(l, [v({ id: "ig", channel: "instagram", body: "Old caption" }), v({ id: "th", channel: "threads", body: "one\n\n---\n\ntwo" })]);
    expect(out.map((s) => s.channel)).toContain("instagram");
    expect(out.find((s) => s.channel === "instagram")?.body).toBe("New caption");
  });
});
