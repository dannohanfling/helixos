import { describe, expect, it } from "vitest";
import { BEHAVIORS, BOT_FEATURES, DEFAULT_RULES, featureState, readRule, readSetup, ruleOf, unlockState, type Behavior } from "../bot-features";

const facts = (behaviors: Behavior[] = [], points = 0) => ({ behaviors: new Set(behaviors), points, tierName: "", tierMin: (n: string) => (n === "Sage" ? 500 : null) });

describe("Bot Features", () => {
  it("carries Danno's eight features in his order, with his copy", () => {
    expect(BOT_FEATURES.map((f) => f.name)).toEqual(["No-Show Rescue", "Freebie Delivery", "Seat Filler", "Proof Collector", "Win-Back Nudge", "Referral Engine", "Regulars Club", "Ladder Dripper"]);
    expect(BOT_FEATURES.find((f) => f.key === "proof_collector")!.description).toBe("Your bot asks happy clients what changed for them, saves their words with permission, and sends your review link.");
    expect(BOT_FEATURES.find((f) => f.key === "freebie_delivery")!.shortLine).toBe("Sends your free guide to anyone who messages FREE.");
    expect(BOT_FEATURES.find((f) => f.key === "referral_engine")!.ghl).toEqual({ build: "referrer reward", tags: ["EO Referrer", "EO Referred"] });
    expect(BOT_FEATURES.filter((f) => f.comingSoon).map((f) => f.key)).toEqual(["ladder_dripper"]);
    for (const f of BOT_FEATURES) expect(f.steps).toHaveLength(3);
  });

  it("reads each kind of rule: free, a milestone, a tier with its progress, points reached (never spent)", () => {
    expect(unlockState({ type: "free", value: "" }, facts()).unlocked).toBe(true);
    expect(unlockState({ type: "behavior", value: "first_client" }, facts())).toEqual({ unlocked: false, line: "book your first client", progress: null });
    expect(unlockState({ type: "behavior", value: "first_client" }, facts(["first_client"])).unlocked).toBe(true);
    expect(unlockState({ type: "tier", value: "Sage" }, facts([], 250))).toEqual({ unlocked: false, line: "reach Sage tier", progress: 50 });
    expect(unlockState({ type: "tier", value: "Sage" }, facts([], 500)).unlocked).toBe(true);
    expect(unlockState({ type: "points", value: "1000" }, facts([], 999))).toMatchObject({ unlocked: false, line: "reach 1,000 points", progress: 100 });
    expect(unlockState({ type: "points", value: "1000" }, facts([], 1000)).unlocked).toBe(true);
  });

  it("puts a card in one of its states: Coming soon over all, then On, Requested, Unlocked, Locked", () => {
    const free = BOT_FEATURES[0];
    const soon = BOT_FEATURES.find((f) => f.comingSoon)!;
    expect(featureState(soon, true, { state: "on" })).toBe("coming_soon");
    expect(featureState(free, true, { state: "on" })).toBe("on");
    expect(featureState(free, true, { state: "requested" })).toBe("requested");
    expect(featureState(free, true, null)).toBe("unlocked");
    expect(featureState(free, false, null)).toBe("locked");
  });

  it("uses the workspace's rule, else the default, and reads a rule from the rules page", () => {
    expect(ruleOf({}, "regulars_club")).toEqual(DEFAULT_RULES.regulars_club);
    expect(ruleOf({ regulars_club: { type: "points", value: "300" } }, "regulars_club")).toEqual({ type: "points", value: "300" });
    expect(readRule("points", " 0750 ", [])).toEqual({ type: "points", value: "750" });
    expect(readRule("points", "lots", [])).toBeNull();
    expect(readRule("tier", "Sage", ["Sage"])).toEqual({ type: "tier", value: "Sage" });
    expect(readRule("tier", "Pharaoh", ["Sage"])).toBeNull();
    expect(readRule("behavior", "contacts_25", [])).toEqual({ type: "behavior", value: "contacts_25" });
    expect(readRule("behavior", "anything", [])).toBeNull();
    expect(readRule("free", "ignored", [])).toEqual({ type: "free", value: "" });
    for (const b of BEHAVIORS) expect(readRule("behavior", b, [])).not.toBeNull();
  });

  it("checks the setup: required fields, full links, whole numbers, defaults kept", () => {
    const freebie = BOT_FEATURES.find((f) => f.key === "freebie_delivery")!;
    expect(readSetup(freebie, { guideName: "5-Day Plan", guideUrl: "" })).toEqual({ error: 'Fill in "Link to your free guide".', field: "guideUrl" });
    expect(readSetup(freebie, { guideName: "5-Day Plan", guideUrl: "example.com/guide" })).toMatchObject({ field: "guideUrl" });
    expect(readSetup(freebie, { guideName: " 5-Day Plan ", guideUrl: "https://example.com/guide" })).toEqual({ value: { guideName: "5-Day Plan", guideUrl: "https://example.com/guide" } });
    const club = BOT_FEATURES.find((f) => f.key === "regulars_club")!;
    expect(readSetup(club, { pointsPerCheckin: "ten", pointsNeeded: "", reward: "A free coffee" })).toMatchObject({ field: "pointsPerCheckin" });
    // A field left out takes its default; one the client cleared is empty, and a required one says so.
    expect(readSetup(club, { reward: "A free coffee" })).toEqual({ value: { pointsPerCheckin: "10", pointsNeeded: "100", reward: "A free coffee" } });
    expect(readSetup(club, { pointsPerCheckin: "", reward: "A free coffee" })).toMatchObject({ field: "pointsPerCheckin" });
    expect(readSetup(BOT_FEATURES[0], {})).toEqual({ value: {} });
  });
});
