/** The Perfect Webinar structure as HelixOS teaches it: 5 acts, 20 sections, 3 belief breaks. */

import acts from "@/data/seed/webinar/acts.json";
import example from "@/data/seed/webinar/sections_example.json";
import stages from "@/data/seed/webinar/wizard_stages.json";

export type ActKey = "opening" | "vehicle" | "internal" | "external" | "closing";

export type Act = { key: ActKey; order: number; name: string; category: string | null; beliefType: string | null; purpose: string; coachingPrompt: string; tooltip: string | null; beliefFrom: string | null; beliefTo: string | null; example: string | null; soundbite: string | null };

export const ACTS: Act[] = (acts as Act[]).slice().sort((a, b) => a.order - b.order);

export type SectionTemplate = { key: string; order: number; act: ActKey; name: string; type: string; prompt: string; assetType: "story" | "analogy" | "objection" | "belief" | null; durationMin: number; exampleScript: string; exampleKeyPoints: string; exampleTransition: string | null };

const PROMPTS: Record<string, { prompt: string; asset: SectionTemplate["assetType"]; minutes: number }> = {
  Hook: { prompt: "Open a loop they need to close. One sentence that names the real problem, then the promise for the next 60 minutes. No teaching yet.", asset: null, minutes: 3 },
  "Credibility / Origin": { prompt: "One concrete reason to trust you, told as a moment, not a résumé. Pick an origin story from the bank or write your own.", asset: "story", minutes: 4 },
  "Problem Frame": { prompt: "Name the enemy. Why the old way is structurally broken. An analogy makes it land.", asset: "analogy", minutes: 5 },
  "Opportunity Frame": { prompt: "Reframe what becomes possible once the enemy is beaten. Data, a contrast, or a story.", asset: "story", minutes: 4 },
  "Mechanism Reveal": { prompt: "Introduce your named mechanism. Draw it on one whiteboard. Three to five parts, each with a name.", asset: "analogy", minutes: 6 },
  "Proof Block": { prompt: "Aggregate proof: numbers across clients, screenshots, before and afters. Don't argue, show.", asset: null, minutes: 3 },
  "Case Study": { prompt: "One person, in depth. Before, the pivot, after. Pick someone whose starting point matches the audience.", asset: "story", minutes: 4 },
  "Problem Frame (Internal)": { prompt: "Say the quiet part: 'even if this works, I can't do it.' Name the self-doubt so they feel seen.", asset: "belief", minutes: 3 },
  "Opportunity Frame (Internal)": { prompt: "They don't need to become someone else. The formula does the work. Show people like them who shipped.", asset: "story", minutes: 3 },
  "Mechanism Reveal (Internal)": { prompt: "The install protocol: what they do week by week, with zero invention required.", asset: null, minutes: 4 },
  "Proof Block (Internal)": { prompt: "Proof that non-experts finish. Completion rates, archetypes, the least technical person who did it.", asset: null, minutes: 2 },
  "Case Study (Internal)": { prompt: "One person who thought they couldn't, and did. Use their words.", asset: "story", minutes: 3 },
  "Problem Frame (External)": { prompt: "Name the outside forces they blame. Agree the facts are real. Set up the reframe.", asset: "objection", minutes: 3 },
  "Opportunity Frame (External)": { prompt: "Turn the obstacle into the advantage. Saturation means demand. Big players are slow.", asset: "analogy", minutes: 3 },
  "Mechanism Reveal (External)": { prompt: "The tactic that makes your approach win in hard conditions.", asset: null, minutes: 3 },
  "Proof Block (External)": { prompt: "Proof in crowded or hard markets. Small players beating big ones.", asset: null, minutes: 2 },
  "Case Study (External)": { prompt: "One client who won in the worst conditions.", asset: "story", minutes: 3 },
  "Offer Transition": { prompt: "Bridge from teaching to offer: 'you can build this yourself, or…'. Handle 'this sounds complicated' here.", asset: "objection", minutes: 2 },
  "Offer Stack + CTA": { prompt: "Present the stack. Link each component to one belief break. Anchor value, name the price, reverse the risk, say the next step.", asset: null, minutes: 8 },
  "Q&A + Close": { prompt: "Pre-empt the top objections, restack urgency, close with a callback to the opening hook.", asset: "objection", minutes: 8 },
};

export const SECTION_TEMPLATES: SectionTemplate[] = (example as { order: number; name: string; type: string | null; act: ActKey; keyPoints: string; script: string; transition: string | null }[])
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((s) => {
    const meta = PROMPTS[s.name] ?? { prompt: "", asset: null, minutes: 4 };
    return {
      key: s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      order: s.order,
      act: s.act,
      name: s.name,
      type: s.type ?? "Teaching",
      prompt: meta.prompt,
      assetType: meta.asset,
      durationMin: meta.minutes,
      exampleScript: s.script,
      exampleKeyPoints: s.keyPoints,
      exampleTransition: s.transition,
    };
  });

export type WizardStage = { order: number; name: string; description: string; inputs: string | null; output: string; validation: string | null };
export const WIZARD_STAGES: WizardStage[] = (stages as WizardStage[]).slice().sort((a, b) => a.order - b.order);

/** The app's 7 steps map onto the base's 10 wizard stages. */
export const STEPS = [
  { key: "foundation", label: "Foundation", icon: "🏁", stages: [1] },
  { key: "beliefs", label: "Beliefs", icon: "🧠", stages: [2] },
  { key: "script", label: "Script", icon: "✍️", stages: [3, 4, 5, 6, 8] },
  { key: "offer", label: "Offer", icon: "🎁", stages: [7] },
  { key: "deck", label: "Deck", icon: "🖼️", stages: [9] },
  { key: "review", label: "Readiness", icon: "✅", stages: [10] },
  { key: "run", label: "Run it", icon: "🚀", stages: [] },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export const READINESS_DIMENSIONS: { key: string; label: string; hint: string }[] = [
  { key: "promise", label: "Promise clarity", hint: "Is the big promise clear, specific, and desirable?" },
  { key: "audience", label: "Audience specificity", hint: "Is the ideal audience crystal clear?" },
  { key: "vehicle", label: "Vehicle belief handled", hint: "Does the webinar sell belief in the method?" },
  { key: "internal", label: "Internal belief handled", hint: "Are 'I can't do this' beliefs addressed?" },
  { key: "external", label: "External belief handled", hint: "Are 'the world won't let me' beliefs addressed?" },
  { key: "proof", label: "Proof sufficiency", hint: "Enough data, screenshots, testimonials?" },
  { key: "stories", label: "Story placement", hint: "Are stories placed for maximum impact?" },
  { key: "offer", label: "Offer clarity", hint: "Is the stack and price easy to understand?" },
  { key: "cta", label: "CTA alignment", hint: "Does the CTA match the audience's readiness?" },
  { key: "objections", label: "Objection handling", hint: "Are the top objections dissolved before Q&A?" },
  { key: "convert", label: "Likely to convert", hint: "Gut check. Would you buy from this?" },
];

export function readinessScore(ratings: Record<string, number>): { score: number; verdict: "ready" | "needs_work" | "not_ready"; weakest: string[] } {
  const vals = READINESS_DIMENSIONS.map((d) => Math.max(0, Math.min(5, ratings[d.key] ?? 0)));
  const total = vals.reduce((a, b) => a + b, 0);
  const score = Math.round((total / (READINESS_DIMENSIONS.length * 5)) * 100);
  const weakest = READINESS_DIMENSIONS.filter((d) => (ratings[d.key] ?? 0) <= 2).map((d) => d.label);
  return { score, verdict: score >= 80 && weakest.length === 0 ? "ready" : score >= 55 ? "needs_work" : "not_ready", weakest };
}

export type SectionLike = { sectionKey: string; act: ActKey; status: string; script: string | null; assetId: string | null; durationMin: number };

export function webinarProgress(webinar: { audience?: string | null; promise?: string | null; mechanismName?: string | null; desiredResult?: string | null; offerId?: string | null }, sections: SectionLike[], beliefs: { type: string; fromBelief: string | null; toBelief: string | null }[], review: { verdict: string } | null) {
  const foundation = [webinar.audience, webinar.promise, webinar.mechanismName, webinar.desiredResult].filter((v) => v && v.trim().length > 3).length / 4;
  const beliefsDone = ["vehicle", "internal", "external"].filter((t) => beliefs.some((b) => b.type === t && b.fromBelief && b.toBelief)).length / 3;
  const drafted = sections.filter((s) => s.status !== "todo" || (s.script && s.script.trim().length > 40)).length;
  const script = sections.length ? drafted / sections.length : 0;
  const offer = webinar.offerId ? 1 : 0;
  const review1 = review ? (review.verdict === "ready" ? 1 : 0.5) : 0;
  const steps: Record<StepKey, number> = { foundation, beliefs: beliefsDone, script, offer, deck: script >= 0.8 ? 1 : script, review: review1, run: 0 };
  const overall = Math.round(((foundation + beliefsDone + script * 3 + offer + review1) / 7) * 100);
  const totalMinutes = sections.reduce((a, s) => a + s.durationMin, 0);
  return { steps, overall, drafted, totalMinutes };
}

export function nextStep(progress: Record<StepKey, number>): StepKey {
  for (const s of STEPS) if (progress[s.key] < 1 && s.key !== "run") return s.key;
  return "run";
}

/** Derive a slide outline from the sections. One idea per slide. */
/**
 * A free-text proof is usable in a script only with tick two recorded, or when it was written before the tick existed
 * (grandfathered, like the bank's early approvals). Nothing typed since then reaches a script without the tick.
 */
export function freeTextProofUsable(b: { proof: string | null; proofPermissionAt: string | null; proofChangedAt: string | null }): boolean {
  if (!(b.proof ?? "").trim()) return false;
  return Boolean(b.proofPermissionAt) || !b.proofChangedAt;
}

export function deckOutline(sections: { order: number; act: ActKey; name: string; keyPoints: string | null; script: string | null }[]) {
  const slides: { n: number; section: string; act: ActKey; headline: string; body: string; visual: string }[] = [];
  let n = 1;
  for (const s of sections.slice().sort((a, b) => a.order - b.order)) {
    const points = (s.keyPoints ?? "")
      .split(/\n/)
      .map((p) => p.replace(/^[•\-*]\s*/, "").trim())
      .filter(Boolean);
    const firstLine = (s.script ?? "").split(/[.!?]\s/)[0]?.trim() ?? "";
    const headline = points[0] || firstLine || s.name;
    const visual = /proof/i.test(s.name) ? "One huge number. Source line small." : /case study/i.test(s.name) ? "Before / after bars. Photo. One quote." : /mechanism/i.test(s.name) ? "Hand-drawn diagram of the mechanism. Icons per part." : /offer stack/i.test(s.name) ? "Stack rows with checkmarks and values. Strikethrough total. Arrow to price." : /hook/i.test(s.name) ? "Big bold title. No bullets. Your name." : /q&a/i.test(s.name) ? "Split: 'Ask anything' / 'Claim your spot'. Timer." : "One line of text, lots of air.";
    slides.push({ n: n++, section: s.name, act: s.act, headline: headline.slice(0, 90), body: points.slice(1, 4).join("\n"), visual });
    if (points.length > 4) slides.push({ n: n++, section: s.name, act: s.act, headline: points[4].slice(0, 90), body: points.slice(5, 8).join("\n"), visual: "Bullets, max three." });
  }
  return slides;
}
