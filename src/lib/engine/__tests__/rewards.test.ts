import { describe, expect, it } from "vitest";
import { capStatus, catalogue, claimability, periodWindow, reopenText, requirementText, type CatalogueItem, type RewardsConfig } from "../rewards";
import prizes from "@/data/seed/prizes.json";
import rewards from "@/data/seed/rewards.json";

const noLinks: RewardsConfig = { perMonth: "calendar", bookingLinks: {} };
const withLinks: RewardsConfig = { perMonth: "calendar", bookingLinks: { "VIP Laser Coaching Call": "https://cal.example.test/vip", "Onboarding Champion": "https://cal.example.test/champion", "Digital Elite Performer Badge": "not a url" } };
const today = "2026-09-07";
const byName = (items: CatalogueItem[], name: string) => items.find((i) => i.name === name)!;
const base = { points: 100000, tierLevel: 9, claimed: new Set<string>(), claimDates: [] as string[], today, mode: "calendar" as const };

describe("catalogue", () => {
  it("lists every reward and prize, with links only where the config has a real URL", () => {
    const items = catalogue(rewards, prizes, withLinks);
    expect(items.filter((i) => i.kind === "reward")).toHaveLength(12);
    expect(items.filter((i) => i.kind === "prize")).toHaveLength(4);
    expect(byName(items, "VIP Laser Coaching Call").bookingUrl).toBe("https://cal.example.test/vip");
    expect(byName(items, "Digital Elite Performer Badge").bookingUrl).toBeNull(); // not a URL: still "Opening soon"
    expect(byName(items, "1-on-1 Funnel Makeover Call").bookingUrl).toBeNull();
    // prizes are milestones: the threshold is required, nothing is deducted
    const champion = byName(items, "Onboarding Champion");
    expect(champion).toMatchObject({ kind: "prize", cost: 0, minPoints: 250, tierRequired: null });
    // behaviour triggers with no cost and no tier can't be earned until the quest engine exists
    expect(byName(items, "Custom Chatbot Strategy Blueprint").earnable).toBe(false);
    expect(byName(items, "Live Feature Inside the Community").earnable).toBe(false);
    expect(byName(items, "VIP Laser Coaching Call").earnable).toBe(true);
  });
  it("describes what each rung asks for", () => {
    const items = catalogue(rewards, prizes, noLinks);
    expect(requirementText(byName(items, "VIP Laser Coaching Call"))).toBe("Sage+ · 750 pts · 5 a month");
    expect(requirementText(byName(items, "30 Days Access to Evolve Omega Academy"))).toBe("Sentinel+ · 10 a quarter");
    expect(requirementText(byName(items, "Onboarding Champion"))).toBe("250 pts reached");
  });
});

describe("cap periods", () => {
  it("calendar month and quarter reopen on the 1st; lifetime never reopens", () => {
    expect(periodWindow("Per Month", today, "calendar")).toEqual({ start: "2026-09-01", reopens: "2026-10-01" });
    expect(periodWindow("Per Month", "2026-12-15", "calendar")).toEqual({ start: "2026-12-01", reopens: "2027-01-01" });
    expect(periodWindow("Per Quarter", today, "calendar")).toEqual({ start: "2026-07-01", reopens: "2026-10-01" });
    expect(periodWindow("Per Quarter", "2026-11-02", "calendar")).toEqual({ start: "2026-10-01", reopens: "2027-01-01" });
    expect(periodWindow("Lifetime (Total)", today, "calendar")).toEqual({ start: "0000-01-01", reopens: null });
    expect(periodWindow(null, today, "calendar")).toBeNull();
    expect(reopenText("2026-10-01")).toBe("1 October");
  });
  it("rolling counts the last 30 days and reopens when the oldest claim ages out", () => {
    expect(periodWindow("Per Month", today, "rolling", ["2026-08-20", "2026-09-01"])).toEqual({ start: "2026-08-09", reopens: "2026-09-19" });
  });
  it("counts the whole workspace and says when it reopens", () => {
    const item = { cap: 3, capPeriod: "Per Month" as const };
    expect(capStatus(item, ["2026-08-30", "2026-09-02"], today, "calendar")).toMatchObject({ taken: 1, open: true, reopens: null });
    expect(capStatus(item, ["2026-09-01", "2026-09-02", "2026-09-05"], today, "calendar")).toMatchObject({ taken: 3, open: false, reopens: "2026-10-01", periodWord: "this month" });
    expect(capStatus({ cap: null, capPeriod: null }, ["2026-09-01"], today, "calendar").open).toBe(true);
    expect(capStatus({ cap: 1, capPeriod: "Lifetime (Total)" }, ["2020-01-01"], today, "calendar")).toMatchObject({ open: false, reopens: null });
  });
});

describe("claimability", () => {
  const items = catalogue(rewards, prizes, withLinks);
  const vip = byName(items, "VIP Laser Coaching Call"); // Sage, 750, 5 a month
  it("refuses without a link, whatever else is true", () => {
    expect(claimability(byName(items, "1-on-1 Funnel Makeover Call"), base)).toMatchObject({ ok: false, reason: "opening-soon", message: "Opening soon" });
    expect(claimability(byName(items, "Custom Chatbot Strategy Blueprint"), base)).toMatchObject({ ok: false, reason: "not-earnable" });
  });
  it("enforces tier, balance, one-per-client and the workspace cap, in that order", () => {
    expect(claimability(vip, { ...base, points: 400, tierLevel: 2 })).toMatchObject({ reason: "tier", message: "Unlocks at Sage" });
    expect(claimability(vip, { ...base, points: 700, tierLevel: 3 })).toMatchObject({ reason: "points", message: "50 more points" });
    expect(claimability(vip, { ...base, claimed: new Set(["VIP Laser Coaching Call"]) })).toMatchObject({ reason: "claimed" });
    const full = ["2026-09-01", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-06"];
    expect(claimability(vip, { ...base, claimDates: full })).toMatchObject({ reason: "cap", message: "All 5 taken this month. Opens again 1 October." });
    expect(claimability(vip, { ...base, claimDates: [...full.slice(0, 4), "2026-08-31"] })).toEqual({ ok: true });
    expect(claimability(vip, { ...base, claimDates: full, mode: "rolling" })).toMatchObject({ reason: "cap", message: "All 5 taken in the last 30 days. Opens again 1 October." });
  });
  it("treats a prize as a milestone: threshold required, no tier, nothing spent", () => {
    const champion = byName(items, "Onboarding Champion");
    expect(claimability(champion, { ...base, points: 249, tierLevel: 1 })).toMatchObject({ reason: "points", message: "1 more points" });
    expect(claimability(champion, { ...base, points: 250, tierLevel: 1 })).toEqual({ ok: true });
    expect(champion.cost).toBe(0);
  });
});
