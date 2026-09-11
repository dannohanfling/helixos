import { describe, expect, it } from "vitest";
import { freeTextProofUsable } from "../webinar";
import { offerOnePager, scoreOffer } from "../offer-score";
import { CHANNEL_SPECS, formatClause, repurpose, repurposeAll, toneClause } from "../repurpose";
import { ACTS, SECTION_TEMPLATES, deckOutline, nextStep, readinessScore, webinarProgress } from "../webinar";

const strongOffer = {
  name: "90-Day Reset",
  avatar: "Busy moms of school-age kids who've tried every diet and keep quitting by week three.",
  coreProblem: "I lose 10 pounds and gain it back every single time and I'm sick of starting over.",
  promise: "I help busy moms drop 15 lbs in 90 days without giving up wine or weekends.",
  mechanismName: "The 12-Minute Tuesday System",
  pathSteps: ["Reset", "Rhythm", "Results"],
  container: "Group program",
  price: 1500,
  guarantee: "If you follow the plan for 90 days and don't lose 10 lbs, I coach you free until you do.",
  whyNow: "Next cohort opens Monday. 12 seats.",
  oneBelief: "If they believe the plan does the work and they only have to follow it, they buy.",
  objTime: "It's 12 minutes on a Tuesday. You spend longer picking a show.",
  objMoney: "It's less than the groceries you throw away each month.",
  objPartner: "Bring them to the call. Most partners want this for you.",
  objTriedBefore: "You didn't fail the plans. The plans failed you: no rhythm, no accountability.",
  objDiy: "You could. You haven't. That's the point.",
  forYouIf: "You'll show up to two 30-minute calls a week and follow the plan.",
  notForYouIf: "You want a magic pill or you won't do the check-ins.",
};
const stack = [
  { name: "Core program", type: "core" as const, perceivedValue: 3000, beliefBreak: "vehicle" as const },
  { name: "Meal templates", type: "bonus" as const, perceivedValue: 500, beliefBreak: "internal" as const },
  { name: "Weekend playbook", type: "bonus" as const, perceivedValue: 300, beliefBreak: "external" as const },
  { name: "Office hours", type: "bonus" as const, perceivedValue: 4000, beliefBreak: "none" as const },
];

describe("offer score", () => {
  it("scores a complete offer as ready", () => {
    const r = scoreOffer(strongOffer, stack);
    // Objections answered from the bank count the same as the older fixed fields, toward the same threshold
    const noFields = { ...strongOffer, objTime: null, objMoney: null, objPartner: null, objTriedBefore: null, objDiy: null };
    expect(scoreOffer(noFields, stack, 0).checks.find((c) => c.key === "objections")?.pass).toBe(false);
    expect(scoreOffer(noFields, stack, 4).checks.find((c) => c.key === "objections")?.pass).toBe(true);
    expect(scoreOffer({ ...noFields, objTime: strongOffer.objTime }, stack, 3).checks.find((c) => c.key === "objections")?.pass).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.verdict).toBe("ready");
    expect(r.multiple).toBeCloseTo(7800 / 1500, 2);
  });
  it("flags a vague promise and thin stack", () => {
    const r = scoreOffer({ name: "Coaching", promise: "Feel better and grow", price: 2000 }, [{ name: "Calls", type: "core", perceivedValue: 2000, beliefBreak: "none" }]);
    expect(r.verdict).toBe("not_ready");
    const failing = r.checks.filter((c) => !c.pass).map((c) => c.key);
    expect(failing).toContain("promise");
    expect(failing).toContain("bonuses");
    expect(failing).toContain("multiple");
    expect(failing).toContain("belief_map");
  });
  it("renders a one-pager", () => {
    const md = offerOnePager(strongOffer, stack);
    expect(md).toContain("# 90-Day Reset");
    expect(md).toContain("1. Reset");
    expect(md).toContain("$1,500");
  });
});

describe("repurpose", () => {
  const src = { title: "Why most diets fail by week 3", hook: "It's not willpower. It's the plan.", body: "Most plans ask for 3 hours on Sunday.\nNobody has 3 hours on Sunday.\nYou need 12 minutes on Tuesday.", hasCta: true, hashtag: "#daily", firstName: "Sarah" };
  it("produces every channel with limits respected", () => {
    const all = repurposeAll(src);
    expect(all.length).toBe(CHANNEL_SPECS.length);
    for (const v of all) {
      const spec = CHANNEL_SPECS.find((c) => c.key === v.channel)!;
      expect(v.body.length).toBeLessThanOrEqual(spec.maxChars + 20);
    }
  });
  it("carries tone and format on the channel: the ladder's Facebook line verbatim, a signed-off line on every channel, no house practice, no restated limit", () => {
    const line = "4th-grade reading level. Sentences average 5–7 words. Line break between every sentence or short thought.";
    for (const c of CHANNEL_SPECS) {
      expect(c.format.length, c.key).toBeGreaterThan(0);
      if (c.key === "fb_personal" || c.key === "fb_page") expect(c.format, c.key).toBe(line);
      // The limit and the link rule are printed beside the tone by every prompt; neither column may say them again
      expect(c.tone, c.key).not.toMatch(/link|characters/i);
      expect(`${c.tone} ${c.format}`, c.key).not.toMatch(/daily hashtag/i);
    }
    // LinkedIn deliberately drops the 5–7 word rhythm; Skool deliberately does not lead with a hook
    expect(CHANNEL_SPECS.find((c) => c.key === "linkedin")!.format).not.toMatch(/5–7/);
    expect(CHANNEL_SPECS.find((c) => c.key === "skool")!.format).toMatch(/^Lead with the point, not a tease/);
    // An empty tone is allowed and appends nothing, never filler
    const empties = CHANNEL_SPECS.filter((c) => !c.tone).map((c) => c.key);
    expect(empties).toEqual(["stories", "instagram", "email"]);
    expect(toneClause(CHANNEL_SPECS.find((c) => c.key === "instagram"))).toBe("");
    expect(toneClause(CHANNEL_SPECS.find((c) => c.key === "threads"))).toBe(" Conversational.");
    expect(formatClause(CHANNEL_SPECS.find((c) => c.key === "fb_page"))).toBe(` Format: ${line}`);
    expect(formatClause(undefined)).toBe("");
  });
  it("keeps other groups pitch-free and gives email a subject", () => {
    expect(repurpose(src, "other_groups").body).not.toMatch(/link|comment "more"/i);
    const email = repurpose(src, "email");
    expect(email.subject).toBeTruthy();
    expect(email.body).toMatch(/^Hey Sarah/);
    expect(email.body).toContain("P.S.");
  });
  it("threads stays under 500 and stories has 3 frames", () => {
    expect(repurpose(src, "threads").body.length).toBeLessThanOrEqual(500);
    expect(repurpose(src, "stories").body.split("Frame ").length - 1).toBe(3);
  });
});

describe("webinar structure", () => {
  it("loads 5 acts and 20 sections in order", () => {
    expect(ACTS.map((a) => a.key)).toEqual(["opening", "vehicle", "internal", "external", "closing"]);
    expect(SECTION_TEMPLATES.length).toBe(20);
    expect(SECTION_TEMPLATES[0].name).toBe("Hook");
    expect(SECTION_TEMPLATES[19].act).toBe("closing");
  });
  it("computes readiness", () => {
    const all5 = Object.fromEntries(["promise", "audience", "vehicle", "internal", "external", "proof", "stories", "offer", "cta", "objections", "convert"].map((k) => [k, 5]));
    expect(readinessScore(all5).verdict).toBe("ready");
    expect(readinessScore({ ...all5, proof: 2 }).verdict).toBe("needs_work");
    expect(readinessScore({ ...all5, proof: 2 }).weakest).toEqual(["Proof sufficiency"]);
  });
  it("tracks progress and the next step", () => {
    const sections = SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, status: "todo", script: null, assetId: null, durationMin: t.durationMin }));
    const p = webinarProgress({ audience: "Busy moms", promise: "Drop 15 lbs in 90 days", mechanismName: "12-Minute Tuesday", desiredResult: "A body they like" }, sections, [], null);
    expect(p.steps.foundation).toBe(1);
    expect(nextStep(p.steps)).toBe("beliefs");
    expect(p.totalMinutes).toBeGreaterThan(60);
  });
  it("derives a deck from sections", () => {
    const slides = deckOutline(SECTION_TEMPLATES.map((t) => ({ order: t.order, act: t.act, name: t.name, keyPoints: t.exampleKeyPoints, script: t.exampleScript })));
    expect(slides.length).toBeGreaterThanOrEqual(20);
    expect(slides[0].section).toBe("Hook");
  });
});

describe("a typed webinar proof is gated by tick two", () => {
  it("usable with the tick, or when written before the tick existed; never when typed since without it", () => {
    expect(freeTextProofUsable({ proof: "Priya went from 2 to 9 calls.", proofPermissionAt: "2026-09-11T00:00:00Z", proofChangedAt: "2026-09-11T00:00:00Z" })).toBe(true);
    expect(freeTextProofUsable({ proof: "Priya went from 2 to 9 calls.", proofPermissionAt: null, proofChangedAt: null })).toBe(true);
    expect(freeTextProofUsable({ proof: "Priya went from 2 to 9 calls.", proofPermissionAt: null, proofChangedAt: "2026-09-11T00:00:00Z" })).toBe(false);
    expect(freeTextProofUsable({ proof: "   ", proofPermissionAt: "2026-09-11T00:00:00Z", proofChangedAt: null })).toBe(false);
  });
});
