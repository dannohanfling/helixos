import { describe, expect, it } from "vitest";
import { freeTextProofUsable } from "../webinar";
import { formatPrice, hasTimeframe, offerOnePager, scoreOffer } from "../offer-score";
import { CHANNEL_SPECS, formatClause, repurpose, repurposeAll, toneClause } from "../repurpose";
import { ACTS, SECTION_TEMPLATES, buildChecks, deckOutline, nextStep, offerStart, readinessScore, readyDecision, reviewStale, sectionPace, statusStale } from "../webinar";

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

describe("a timeframe is any clock, and a price carries its currency", () => {
  it("recognises a single sitting as a timeframe, not only days and weeks", () => {
    for (const s of ["in 90 days", "over 12 weeks", "this quarter", "in one 90-minute session", "in a single session", "in one call", "in a VIP day", "over one weekend", "in a 3-day intensive"]) expect(hasTimeframe(s), s).toBe(true);
    for (const s of ["without unpicking the career they've built", "to stop starting over"]) expect(hasTimeframe(s), s).toBe(false);
  });
  it("writes the code beside the symbol so NZD $1,997 is never read as US dollars", () => {
    expect(formatPrice(1997, "NZD")).toBe("NZD $1,997");
    expect(formatPrice(1200, null)).toBe("USD $1,200");
    expect(formatPrice(997, "GBP")).toBe("GBP £997");
    expect(formatPrice(5, "CHF")).toBe("CHF 5");
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
    const sections = SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, order: t.order, name: t.name, status: "todo", script: null, assetId: null, durationMin: t.durationMin }));
    const p = buildChecks({ webinar: { audience: "Busy moms", coreProblem: "Starting over", promise: "Drop 15 lbs in 90 days", mechanismName: "12-Minute Tuesday", desiredResult: "A body they like" }, sections, beliefs: [], review: null });
    expect(p.steps.foundation).toBe(1);
    expect(nextStep(p.steps)).toBe("beliefs");
    expect(p.totalMinutes).toBeGreaterThan(60);
  });
  describe("the build check is read off the record, itemised, and no rating moves it", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
    const sections = SECTION_TEMPLATES.map((t) => ({ sectionKey: t.key, act: t.act, order: t.order, name: t.name, status: "drafted", script: words(t.durationMin * 130), assetId: null, durationMin: t.durationMin }));
    const bare = ["vehicle", "internal", "external"].map((type) => ({ type, fromBelief: "from", toBelief: "to" }));
    const beliefs = bare.map((b) => ({ ...b, proofId: "p1", storyAssetId: "s1", evidenceId: "e1" }));
    const full = { audience: "Busy moms", coreProblem: "Starting over", promise: "Drop 15 lbs in 90 days", mechanismName: "12-Minute Tuesday", desiredResult: "A body they like", offerId: "o1" };
    const mapped = [{ beliefBreak: "vehicle" }, { beliefBreak: "internal" }];
    it("every check passes on a complete record, and each names what it read", () => {
      const b = buildChecks({ webinar: full, sections, beliefs, components: mapped, review: null });
      expect(b.must).toEqual([]);
      // The template's own durations start the offer with 24% left, which is the one warning on an otherwise complete record
      expect(b.summary).toBe(`${b.total - 1} of ${b.total} checks`);
      expect(b.checks.map((c) => c.key)).toEqual(["foundation", "beliefs", "proofs", "stories", "citations", "sections", "offer", "stack", "runtime", "offerStart", "pace"]);
      expect(b.checks.find((c) => c.key === "sections")!.detail).toBe("Every section has a script.");
    });
    it("what is missing is said by name: a section with key points only is not scripted, an unmapped component is counted", () => {
      const partial = sections.map((s, i) => (i < 2 ? { ...s, script: null, keyPoints: "• a point" } : s));
      const b = buildChecks({ webinar: { ...full, mechanismName: null, audience: "" }, sections: partial, beliefs: beliefs.slice(0, 2), components: [{ beliefBreak: "vehicle" }, { beliefBreak: "none" }], review: null });
      const by = Object.fromEntries(b.checks.map((c) => [c.key, c]));
      expect(by.foundation.detail).toBe("Missing: audience, named mechanism (or say why there is none).");
      expect(by.beliefs.detail).toBe("No from/to pair yet for: external.");
      expect(by.sections.label).toBe("All 20 sections scripted (18)");
      expect(by.sections.detail).toContain("2 with key points only (Hook, Credibility / Origin); 0 not started.");
      expect(by.stack.detail).toBe("1 of 2 components not tied to a belief break.");
      // The third act has no pair and nothing wired, so the three presence checks name it too
      expect(b.must.map((c) => c.key)).toEqual(["foundation", "beliefs", "proofs", "stories", "citations", "sections", "stack"]);
      expect(by.proofs.detail).toBe("Act 3 has no proof.");
      expect(b.scripted).toBe(18);
    });
    it("a session that deliberately names no mechanism passes foundation with its reason", () => {
      const b = buildChecks({ webinar: { ...full, mechanismName: null, mechanismWaivedReason: "No instrument may be named at this event." }, sections, beliefs, components: mapped, review: null });
      expect(b.checks[0].ok).toBe(true);
      expect(b.checks[0].detail).toBe("No named mechanism, by choice: No instrument may be named at this event.");
    });
    it("eleven fives never make an incomplete webinar ready, and the decision says which checks are open", () => {
      const all5 = Object.fromEntries(["promise", "audience", "vehicle", "internal", "external", "proof", "stories", "offer", "cta", "objections", "convert"].map((k) => [k, 5]));
      const incomplete = buildChecks({ webinar: { ...full, offerId: null }, sections, beliefs, components: [], review: { verdict: "ready" } });
      const d = readyDecision(readinessScore(all5), incomplete);
      expect(d.ready).toBe(false);
      expect(d.reasons).toEqual(["2 checks open: Offer linked; Stack mapped to belief breaks."]);
      // The rating did not move a single check
      const unrated = buildChecks({ webinar: { ...full, offerId: null }, sections, beliefs, components: [], review: null });
      expect(unrated.checks).toEqual(incomplete.checks);
      // And the record alone is not enough either: a complete record with a rating under 80 is not ready
      const complete = buildChecks({ webinar: full, sections, beliefs, components: mapped, review: { verdict: "needs_work" } });
      expect(readyDecision(readinessScore({ ...all5, proof: 2 }), complete)).toEqual({ ready: false, reasons: ["Your rating has Proof sufficiency at 2 or below."] });
      expect(readyDecision(readinessScore(all5), complete).ready).toBe(true);
      expect(readyDecision(null, complete).reasons).toEqual(["No readiness review saved yet."]);
    });
    it("a webinar with nothing wired to its acts is not ready, whatever the sliders say, and each act says what it lacks", () => {
      // Four foundation fields, three from/to pairs, twenty scripted sections, an offer linked and mapped, eleven fives
      const all5 = Object.fromEntries(["promise", "audience", "vehicle", "internal", "external", "proof", "stories", "offer", "cta", "objections", "convert"].map((k) => [k, 5]));
      const b = buildChecks({ webinar: full, sections, beliefs: bare, components: mapped, review: { verdict: "ready" } });
      expect(b.must.map((c) => c.key)).toEqual(["proofs", "stories", "citations"]);
      expect(b.checks.find((c) => c.key === "citations")!.detail).toBe("Act 1 has no citation; Act 2 has no citation; Act 3 has no citation.");
      expect(readyDecision(readinessScore(all5), b)).toEqual({ ready: false, reasons: ["3 checks open: Every act has a proof; Every act has a story; Every act has a citation."] });
      // One act wired, two not: the detail names the two
      const one = bare.map((x, i) => (i === 1 ? { ...x, proofId: "p1", storyAssetId: "s1", evidenceId: "e1" } : x));
      const partial = buildChecks({ webinar: full, sections, beliefs: one, components: mapped, review: null });
      expect(partial.checks.find((c) => c.key === "proofs")!.detail).toBe("Act 1 has no proof; Act 3 has no proof.");
      // A typed proof counts only with its permission tick (or written before the tick existed); a picked proof only while approved
      const typed = bare.map((x) => ({ ...x, proof: "Priya N.: 2 to 9 calls a week", proofChangedAt: "2026-09-01T00:00:00.000Z", proofPermissionAt: null, storyAssetId: "s1", evidenceId: "e1" }));
      expect(buildChecks({ webinar: full, sections, beliefs: typed, components: mapped, review: null }).must.map((c) => c.key)).toEqual(["proofs"]);
      expect(buildChecks({ webinar: full, sections, beliefs: typed.map((x) => ({ ...x, proofPermissionAt: "2026-09-02T00:00:00.000Z" })), components: mapped, review: null }).must).toEqual([]);
      expect(buildChecks({ webinar: full, sections, beliefs, components: mapped, known: { proofIds: ["other"], storyIds: ["s1"], evidenceIds: ["e1"] }, review: null }).checks.find((c) => c.key === "proofs")!.detail).toBe("Act 1 has no proof; Act 2 has no proof; Act 3 has no proof.");
    });
    it("a reference is not a presence: a deleted study or a removed story no longer counts once the known ids are supplied", () => {
      const known = { proofIds: ["p1"], storyIds: ["s1"], evidenceIds: ["e1"] };
      expect(buildChecks({ webinar: full, sections, beliefs, components: mapped, known, review: null }).must).toEqual([]);
      const gone = buildChecks({ webinar: full, sections, beliefs, components: mapped, known: { ...known, evidenceIds: [], storyIds: ["essence:0"] }, review: null });
      expect(gone.must.map((c) => c.key)).toEqual(["stories", "citations"]);
      expect(gone.checks.find((c) => c.key === "citations")!.detail).toBe("Act 1 has no citation; Act 2 has no citation; Act 3 has no citation.");
      // Without the known ids (the list and Today before they loaded them) the id alone counted; that blind spot is what known closes
      expect(buildChecks({ webinar: full, sections, beliefs, components: mapped, review: null }).must).toEqual([]);
    });
    it("the offer is a reference too: a linked offer whose row is gone fails offer linked and stack mapped, and says so", () => {
      const known = { proofIds: ["p1"], storyIds: ["s1"], evidenceIds: ["e1"], offerIds: ["o1"] };
      expect(buildChecks({ webinar: full, sections, beliefs, components: mapped, known, review: null }).must).toEqual([]);
      const gone = buildChecks({ webinar: full, sections, beliefs, components: [], known: { ...known, offerIds: [] }, review: null });
      expect(gone.must.map((c) => c.key)).toEqual(["offer", "stack"]);
      expect(gone.checks.find((c) => c.key === "offer")!.detail).toBe("The linked offer no longer exists. Pick another on the Offer step.");
      expect(gone.checks.find((c) => c.key === "stack")!.detail).toBe("The linked offer no longer exists.");
      // Without offer ids in the known set (older callers), the id alone still counts, as before
      expect(buildChecks({ webinar: full, sections, beliefs, components: mapped, known: { proofIds: ["p1"], storyIds: ["s1"], evidenceIds: ["e1"] }, review: null }).must).toEqual([]);
    });
    it("a script that introduces someone other than the presenter is a warning that names the section, the name and the presenter", () => {
      const wrong = sections.map((s, i) => (i === 0 ? { ...s, script: `I'm Danno Hanfling, and I've spent fifteen years helping people. ${s.script}` } : s));
      const b = buildChecks({ webinar: full, sections: wrong, beliefs, components: mapped, presenter: "Lindsey Brittain", review: null });
      const c = b.checks.find((x) => x.key === "presenterName")!;
      expect(c.level).toBe("warn");
      expect(c.ok).toBe(false);
      expect(c.detail).toBe('Hook says "I\'m Danno Hanfling"; the presenter is Lindsey Brittain.');
      expect(buildChecks({ webinar: full, sections, beliefs, components: mapped, presenter: "Lindsey Brittain", review: null }).checks.find((x) => x.key === "presenterName")!.ok).toBe(true);
      expect(buildChecks({ webinar: full, sections: wrong, beliefs, components: mapped, review: null }).checks.some((x) => x.key === "presenterName")).toBe(false);
    });
    it("a status of ready or scheduled outlives its checks, so it is marked stale with the broken checks named; nothing demotes it", () => {
      const broken = buildChecks({ webinar: full, sections, beliefs, components: mapped, known: { proofIds: [], storyIds: ["s1"], evidenceIds: ["e1"] }, review: null });
      expect(statusStale("scheduled", broken)).toEqual({ stale: true, note: "1 check has broken since it was marked scheduled: Every act has a proof." });
      expect(statusStale("building", broken).stale).toBe(false);
      expect(statusStale("ready", buildChecks({ webinar: full, sections, beliefs, components: mapped, review: null })).stale).toBe(false);
    });
    it("the stack check is left out, not guessed, when the components were not loaded", () => {
      const b = buildChecks({ webinar: full, sections, beliefs, review: null });
      expect(b.checks.some((c) => c.key === "stack")).toBe(false);
    });
    it("the offer start is a cumulative clock: a warning under 25% of the session left, never a block", () => {
      expect(offerStart(sections)).toEqual({ startMin: 58, totalMin: 76, remainingShare: 18 / 76 });
      const b = buildChecks({ webinar: full, sections, beliefs, components: mapped, review: null });
      const start = b.checks.find((c) => c.key === "offerStart")!;
      expect(start.label).toBe("Offer starts at 0:58 of 76 min");
      expect(start.ok).toBe(false);
      expect(start.level).toBe("warn");
      expect(start.detail).toBe("24% of the session remains for the offer, under the 25% it needs.");
      expect(b.must).toEqual([]);
    });
    it("a script is measured against its slot at 130 words a minute: long past 1.3x, thin under 0.4x", () => {
      expect(sectionPace({ script: words(390), durationMin: 3 })).toEqual({ words: 390, estimatedMin: 3, flag: null });
      expect(sectionPace({ script: words(650), durationMin: 3 })).toEqual({ words: 650, estimatedMin: 5, flag: "long" });
      expect(sectionPace({ script: words(130), durationMin: 8 })).toEqual({ words: 130, estimatedMin: 1, flag: "thin" });
      expect(sectionPace({ script: "too short to count", durationMin: 8 }).flag).toBeNull();
      const b = buildChecks({ webinar: full, sections: sections.map((s, i) => (i === 0 ? { ...s, script: words(650) } : s)), beliefs, components: mapped, review: null });
      expect(b.checks.find((c) => c.key === "pace")!.detail).toBe("Written long: Hook.");
    });
    it("a review older than the record's last edit is stale", () => {
      expect(reviewStale({ createdAt: "2026-09-15T10:00:00.000Z" }, "2026-09-16T10:00:00.000Z")).toBe(true);
      expect(reviewStale({ createdAt: "2026-09-16T10:00:00.000Z" }, "2026-09-15T10:00:00.000Z")).toBe(false);
      expect(reviewStale({ createdAt: "2026-09-16T10:00:00.000Z" }, null)).toBe(false);
      expect(reviewStale(null, "2026-09-16T10:00:00.000Z")).toBe(false);
    });
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
