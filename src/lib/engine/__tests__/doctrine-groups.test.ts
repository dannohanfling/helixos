import { describe, expect, it } from "vitest";
import { alignPost, groupChannel, groupReadiness, groupSpec, readRules } from "../groups";
import { CHANNEL_SPECS } from "../repurpose";
import { ADMIN_ONBOARDING_KEYS, clientFacing, simplePath } from "../pathway";
import { daysInMonth, monthProgress } from "../targets";
import { principlePost, principleReel, principleTraining } from "../doctrine";

const src = { title: "Why most diets fail by week 3", hook: "It's not willpower. It's the plan.", body: "Most plans ask for 3 hours on Sunday.\nNobody has 3 hours on Sunday.\nYou need 12 minutes on Tuesday. https://example.com/plan", hasCta: true };

describe("group alignment", () => {
  it("reads rules from free text", () => {
    const r = readRules({ name: "x", kind: "prospect", rules: "No links. No self-promo. Ask the admin before promoting." });
    expect(r.noLinks).toBe(true);
    expect(r.noPromo).toBe(true);
    expect(r.askFirst).toBe(true);
  });
  it("strips links and pitch in a strict prospect group and references the mission", () => {
    const g = { name: "Online Coaches", kind: "prospect" as const, mission: "Helping coaches grow without burning out", adminName: "Debbie Hull", adminValues: "Generosity first. Real stories over hype.", rules: "No links. No self-promo." };
    const out = alignPost(src, g);
    expect(out.body).not.toMatch(/https?:\/\//);
    expect(out.body).toMatch(/growing without burning out|grow without burning out/i);
    expect(out.body).toContain("Thanks Debbie");
    expect(out.ctaAllowed).toBe(false);
    expect(out.checks.find((c) => c.key === "links")?.ok).toBe(true);
    expect(out.checks.find((c) => c.key === "approval")).toBeUndefined();
  });
  it("keeps the CTA in your own group", () => {
    const out = alignPost(src, { name: "Mine", kind: "own" });
    expect(out.ctaAllowed).toBe(true);
    expect(out.body).toContain("Comment \"more\"");
  });
  it("bounds a group draft by its channel's spec, not a number of its own", () => {
    expect(groupChannel("own")).toBe("fb_group");
    expect(groupChannel("member")).toBe("other_groups");
    expect(groupChannel("prospect")).toBe("other_groups");
    expect(groupSpec("own").maxChars).toBe(CHANNEL_SPECS.find((c) => c.key === "fb_group")!.maxChars);
    const long = { ...src, body: Array.from({ length: 8 }, () => "x".repeat(400)).join("\n") };
    expect(alignPost(long, { name: "Mine", kind: "own" }).body.length).toBeLessThanOrEqual(groupSpec("own").maxChars);
    expect(alignPost(long, { name: "Theirs", kind: "prospect" }).body.length).toBeLessThanOrEqual(groupSpec("prospect").maxChars);
  });

  it("scores readiness", () => {
    expect(groupReadiness({ name: "x", kind: "member" })).toBe(0);
    expect(groupReadiness({ name: "x", kind: "member", mission: "a", rules: "b", adminValues: "c", whatWorks: "d" })).toBe(50);
  });
});

describe("simple pathway", () => {
  const stages = [{ key: "a", order: 1 }, { key: "b", order: 2 }];
  const lib = [
    { key: "a1", stageKey: "a", order: 1, name: "A1", points: 10, priority: "must" as const },
    { key: "a2", stageKey: "a", order: 2, name: "A2", points: 10, priority: "must" as const },
    { key: "a3", stageKey: "a", order: 3, name: "A3", points: 10, priority: "should" as const },
    { key: "a4", stageKey: "a", order: 4, name: "A4", points: 10, priority: "must" as const },
    { key: "a5", stageKey: "a", order: 5, name: "A5", points: 10, priority: "must" as const },
    { key: "b1", stageKey: "b", order: 1, name: "B1", points: 10, priority: "must" as const },
  ];
  it("shows at most 3 must-do tasks and hides extras", () => {
    const p = simplePath(stages, lib, []);
    expect(p.stageKey).toBe("a");
    expect(p.now.map((t) => t.key)).toEqual(["a1", "a2", "a4"]);
    expect(p.remaining).toBe(1);
    expect(p.extras.total).toBe(1);
  });
  it("puts revisions first and moves to the next stage when the path is verified", () => {
    const p = simplePath(stages, lib, [{ libraryTaskKey: "a2", status: "revision" }, { libraryTaskKey: "a1", status: "verified" }]);
    expect(p.now[0].key).toBe("a2");
    const q = simplePath(stages, lib, ["a1", "a2", "a4", "a5"].map((k) => ({ libraryTaskKey: k, status: "verified" as const })));
    expect(q.stageKey).toBe("b");
  });
});

describe("targets", () => {
  it("computes month pace", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    const rows = [{ dmsStarted: 30, cashCollected: 2000 }];
    const m = monthProgress(rows, { dmsStarted: 60, cashCollected: 5000 }, "2026-09", "2026-09-15");
    const dms = m.find((x) => x.key === "dmsStarted")!;
    expect(dms.pct).toBe(50);
    expect(dms.pace).toBe("on");
    expect(m.find((x) => x.key === "cashCollected")!.pace).toBe("behind");
    expect(m.find((x) => x.key === "posts")!.pace).toBe("none");
  });
});

describe("doctrine", () => {
  const p = { code: "Ω-02", symbol: "🜂", greekName: "Proteros Desmos", name: "Connection Precedes Conversion", summary: "Connection comes first. Conversion is the byproduct.", publicFigureStory: "Oprah's power came from emotional safety.\n\nHer audience never felt like a lead list." };
  it("writes a post, a reel, and a training from a principle", () => {
    expect(principlePost(p)).toContain("Oprah");
    expect(principlePost(p)).toContain("Proteros Desmos");
    expect(principleReel(p)).toMatch(/HOOK/);
    expect(principleReel(p)).toContain('comment "PROTEROS"');
    expect(principleTraining(p)).toMatch(/^1\. Name it/);
  });
});

describe("onboarding admin tasks never lead the client path", () => {
  it("demotes the contract, payment, intake, access and kickoff tasks to optional extras", () => {
    const stages = [{ key: "onboarding", order: 1 }, { key: "community", order: 2 }];
    const admin = Array.from(ADMIN_ONBOARDING_KEYS).map((key, i) => ({ key, stageKey: "onboarding", order: i + 1, name: `admin ${i}`, points: 10, priority: "must" as const }));
    const lib = [...admin, { key: "pick-home", stageKey: "onboarding", order: 4, name: "Choose where your community will live", points: 25, priority: "must" as const }];
    expect(clientFacing(lib).filter((t) => t.priority === "must").map((t) => t.key)).toEqual(["pick-home"]);
    const p = simplePath(stages, lib, []);
    expect(p.now.map((t) => t.key)).toEqual(["pick-home"]);
    expect(p.extras.total).toBe(admin.length);
    expect(p.now.some((t) => ADMIN_ONBOARDING_KEYS.has(t.key))).toBe(false);
  });
});
