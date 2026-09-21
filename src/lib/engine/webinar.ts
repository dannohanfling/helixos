/** The Perfect Webinar structure as HelixOS teaches it: 5 acts, 20 sections, 3 belief breaks. */

import { nameMismatch } from "./subject";
import acts from "@/data/seed/webinar/acts.json";
import example from "@/data/seed/webinar/sections_example.json";
import stages from "@/data/seed/webinar/wizard_stages.json";

export type ActKey = "opening" | "vehicle" | "internal" | "external" | "closing";

export type Act = { key: ActKey; order: number; name: string; category: string | null; beliefType: string | null; purpose: string; coachingPrompt: string; tooltip: string | null; beliefFrom: string | null; beliefTo: string | null; example: string | null; soundbite: string | null };

export const ACTS: Act[] = (acts as Act[]).slice().sort((a, b) => a.order - b.order);

export type SectionTemplate = { key: string; order: number; act: ActKey; name: string; type: string; prompt: string; assetType: "story" | "analogy" | "objection" | "belief" | null; durationMin: number; exampleScript: string; exampleKeyPoints: string; exampleTransition: string | null };

const PROMPTS: Record<string, { prompt: string; asset: SectionTemplate["assetType"]; minutes: number }> = {
  Hook: { prompt: "Open a loop they need to close. One sentence that names the real problem, then the promise for the next {runtime} minutes. No teaching yet.", asset: null, minutes: 3 },
  "Credibility / Origin": { prompt: "One concrete reason to trust you, told as a moment, not a résumé. Pick an origin story from the bank or write your own.", asset: "story", minutes: 4 },
  "Problem Frame": { prompt: "Name the enemy. Why the old way is structurally broken. An analogy makes it land.", asset: "analogy", minutes: 5 },
  "Opportunity Frame": { prompt: "Reframe what becomes possible once the enemy is beaten. Data, a contrast, or a story.", asset: "story", minutes: 4 },
  "Mechanism Reveal": { prompt: "Introduce your named mechanism. Draw it on one whiteboard. Three to five parts, each with a name.", asset: "analogy", minutes: 6 },
  "Proof Block": { prompt: "Aggregate proof: numbers across clients, screenshots, before and afters. Don't argue, show.", asset: null, minutes: 3 },
  "Case Study": { prompt: "One person, in depth. Before, the pivot, after. Pick someone whose starting point matches the audience.", asset: "story", minutes: 4 },
  "Problem Frame (Internal)": { prompt: "Say the quiet part: 'even if this works, I can't do it.' Name the self-doubt so they feel seen.", asset: "belief", minutes: 3 },
  "Opportunity Frame (Internal)": { prompt: "They don't need to become someone else. The formula does the work. Show people like them who shipped.", asset: "story", minutes: 3 },
  "Mechanism Reveal (Internal)": { prompt: "The install protocol: what they do as the programme unfolds, with zero invention required.", asset: null, minutes: 4 },
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

export type SectionLike = { sectionKey: string; act: ActKey; order?: number; name?: string; status: string; script: string | null; assetId?: string | null; durationMin: number; keyPoints?: string | null };
/** The origin story's eight beats (code-deck-density-spec §2.1): one slide each when filled. Labels and help are provisional. */
export const ORIGIN_BEATS: { key: string; label: string; help: string }[] = [
  { key: "wanted", label: "What you wanted", help: "The thing you were after before any of this: one sentence, in the past tense." },
  { key: "outside", label: "The struggle outside", help: "What was in the way that you could point at: the market, the money, the hours." },
  { key: "inside", label: "The struggle inside", help: "What was in the way that you could not point at: the doubt, the story you told yourself." },
  { key: "wall", label: "The wall", help: "The moment it stopped working. A day, a number, a conversation." },
  { key: "epiphany", label: "The epiphany", help: "What you saw that you had not seen. The belief that changed." },
  { key: "plan", label: "The plan", help: "What you built from it. Name the mechanism if it has one." },
  { key: "result", label: "The result", help: "What happened, with the number if you have one and the permission to say it." },
  { key: "transformation", label: "The transformation", help: "Who you are now that you were not then. The line the room remembers." },
];

export type BuildWebinar = { audience?: string | null; coreProblem?: string | null; promise?: string | null; mechanismName?: string | null; mechanismWaivedReason?: string | null; desiredResult?: string | null; offerId?: string | null; updatedAt?: string | null };
export type BuildCheck = { key: string; label: string; ok: boolean; level: "must" | "warn"; detail: string };
export type BuildResult = {
  checks: BuildCheck[];
  /** The must-checks still open: while any is, the webinar is not ready whatever anyone rates it. */
  must: BuildCheck[];
  warn: BuildCheck[];
  passed: number;
  total: number;
  /** "5 of 8 checks", the header's words; the open ones are named beside it. */
  summary: string;
  steps: Record<StepKey, number>;
  scripted: number;
  drafted: number;
  totalMinutes: number;
};

/** The pace a presenter speaks at, for turning a script's length into minutes. */
export const WORDS_PER_MINUTE = 130;
/** Written long past this multiple of the slot; thin below the lower one. */
export const PACE_LONG = 1.3;
export const PACE_THIN = 0.4;
/** The offer should start with at least this share of the session left. */
export const OFFER_REMAINING_MIN = 0.25;
const SCRIPT_MIN_CHARS = 40;
const filled = (v: string | null | undefined): boolean => Boolean(v && v.trim().length > 3);
export const hasScript = (s: { script: string | null }): boolean => Boolean(s.script && s.script.trim().length > SCRIPT_MIN_CHARS);
export const wordCount = (text: string | null | undefined): number => (text ?? "").trim().split(/\s+/).filter(Boolean).length;

/** A section's script against its slot: how many minutes the words take, and whether that is long or thin for the slot. */
export function sectionPace(s: { script: string | null; durationMin: number }): { words: number; estimatedMin: number; flag: "long" | "thin" | null } {
  const words = wordCount(s.script);
  const estimatedMin = Math.round((words / WORDS_PER_MINUTE) * 10) / 10;
  if (!hasScript(s)) return { words, estimatedMin, flag: null };
  const flag = estimatedMin > s.durationMin * PACE_LONG ? "long" : estimatedMin < s.durationMin * PACE_THIN ? "thin" : null;
  return { words, estimatedMin, flag };
}

/** Where the closing frame begins, as minutes into the session and the share of it left. Null with no closing section. */
export function offerStart(sections: { act: ActKey; order?: number; durationMin: number }[]): { startMin: number; totalMin: number; remainingShare: number } | null {
  const ordered = sections.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const totalMin = ordered.reduce((a, s) => a + s.durationMin, 0);
  let startMin = 0;
  for (const s of ordered) {
    if (s.act === "closing") return { startMin, totalMin, remainingShare: totalMin ? (totalMin - startMin) / totalMin : 0 };
    startMin += s.durationMin;
  }
  return null;
}

export const clock = (min: number): string => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

/**
 * The build check: every line is read off the record, named, and says what is missing. Nothing in it is a rating, and no
 * rating moves it. The must-checks decide whether "ready" can be set; the warnings only say something worth a look.
 * `components` undefined means the stack was not loaded (the list and Today), so that check is left out rather than guessed.
 */
export type BuildBelief = { type: string; fromBelief: string | null; toBelief: string | null; proofId?: string | null; proof?: string | null; proofPermissionAt?: string | null; proofChangedAt?: string | null; storyAssetId?: string | null; evidenceId?: string | null };
/** The acts as the coach reads them on the page. */
export const ACT_NUMBER: Record<string, string> = { vehicle: "Act 1", internal: "Act 2", external: "Act 3" };

/** The ids that still exist and still qualify: approved proofs, stories in scope (bank or Essence), citable studies. */
export type KnownRefs = { proofIds: string[]; storyIds: string[]; evidenceIds: string[]; offerIds?: string[] };

/**
 * What is wired to each act: a proof (an approved bank row, or a typed one with its permission tick), a story and a citation.
 * Presence is a check; the quality of each stays the coach's own rating. With `known`, an id whose row is gone or no longer
 * qualifies (a proof's approval withdrawn, a study deleted, a story removed) no longer counts: a reference is not a presence.
 */
export function actPresence(beliefs: BuildBelief[], known?: KnownRefs): { key: "proofs" | "stories" | "citations"; label: string; missing: string[] }[] {
  const acts = ["vehicle", "internal", "external"];
  const exists = (id: string | null | undefined, ids?: string[]) => Boolean(id && (!ids || ids.includes(id)));
  const has = {
    proofs: (b: BuildBelief | undefined) => Boolean(b && (exists(b.proofId, known?.proofIds) || freeTextProofUsable({ proof: b.proof ?? null, proofPermissionAt: b.proofPermissionAt ?? null, proofChangedAt: b.proofChangedAt ?? null }))),
    stories: (b: BuildBelief | undefined) => exists(b?.storyAssetId, known?.storyIds),
    citations: (b: BuildBelief | undefined) => exists(b?.evidenceId, known?.evidenceIds),
  };
  const word = { proofs: "proof", stories: "story", citations: "citation" } as const;
  return (["proofs", "stories", "citations"] as const).map((key) => ({
    key,
    label: `Every act has a ${word[key]}`,
    missing: acts.filter((t) => !has[key](beliefs.find((b) => b.type === t))).map((t) => `${ACT_NUMBER[t]} has no ${word[key]}`),
  }));
}

/** What the deck check reads: how many refusals the Deck step shows, and the deck's pace in slides a minute (null with no minutes). */
export type DeckCheckInput = { refused: number; rate: number | null };
/** The band a first draft should land in, from the reference deck (code-deck-density-spec §4). */
export const DECK_PACE_FLOOR = 1.2;

export function buildChecks(input: { webinar: BuildWebinar; sections: SectionLike[]; beliefs: BuildBelief[]; components?: { beliefBreak: string }[]; known?: KnownRefs; presenter?: string; presenterAliases?: string[]; deck?: DeckCheckInput; review: { verdict: string } | null }): BuildResult {
  const { webinar: w, beliefs, components, review } = input;
  // A section left out on purpose is not a section waiting for a script: it is out of every count below and off the clock.
  const omitted = input.sections.filter((s) => s.status === "omitted");
  const sections = input.sections.filter((s) => s.status !== "omitted");
  const checks: BuildCheck[] = [];
  const missingFoundation = [
    !filled(w.audience) ? "audience" : "",
    !filled(w.coreProblem) ? "core problem" : "",
    !filled(w.promise) ? "promise" : "",
    !filled(w.desiredResult) ? "desired result" : "",
    !filled(w.mechanismName) && !filled(w.mechanismWaivedReason) ? "named mechanism (or say why there is none)" : "",
  ].filter(Boolean);
  const foundationParts = 5 - missingFoundation.length;
  checks.push({ key: "foundation", label: "Foundation filled", ok: !missingFoundation.length, level: "must", detail: missingFoundation.length ? `Missing: ${missingFoundation.join(", ")}.` : filled(w.mechanismName) ? "Audience, problem, promise, result and mechanism are all there." : `No named mechanism, by choice: ${w.mechanismWaivedReason?.trim()}` });
  const missingBeliefs = ["vehicle", "internal", "external"].filter((t) => !beliefs.some((b) => b.type === t && b.fromBelief && b.toBelief));
  checks.push({ key: "beliefs", label: "Three belief shifts written", ok: !missingBeliefs.length, level: "must", detail: missingBeliefs.length ? `No from/to pair yet for: ${missingBeliefs.join(", ")}.` : "From and to written for all three acts." });
  // The three things a webinar most needs, per act, read off what is wired rather than asked of a slider.
  for (const p of actPresence(beliefs, input.known)) checks.push({ key: p.key, label: p.label, ok: !p.missing.length, level: "must", detail: p.missing.length ? `${p.missing.join("; ")}.` : "All three acts." });
  const scriptedRows = sections.filter(hasScript);
  const pointsOnly = sections.filter((s) => !hasScript(s) && (s.status !== "todo" || (s.keyPoints ?? "").trim()));
  const untouched = sections.length - scriptedRows.length - pointsOnly.length;
  const omittedNote = omitted.length ? ` ${omitted.length} left out on purpose: ${omitted.map((s) => s.name ?? s.sectionKey).join(", ")}.` : "";
  checks.push({ key: "sections", label: `All ${sections.length} sections scripted (${scriptedRows.length})`, ok: sections.length > 0 && scriptedRows.length === sections.length, level: "must", detail: (scriptedRows.length === sections.length ? "Every section has a script." : `${pointsOnly.length} with key points only${pointsOnly.length ? ` (${pointsOnly.map((s) => s.name ?? s.sectionKey).slice(0, 4).join(", ")}${pointsOnly.length > 4 ? ", …" : ""})` : ""}; ${untouched} not started.`) + omittedNote });
  // The offer is a reference too: with the known ids, a linked offer whose row is gone no longer counts, and the stack says why it is empty.
  const offerGone = Boolean(w.offerId && input.known?.offerIds && !input.known.offerIds.includes(w.offerId));
  checks.push({ key: "offer", label: "Offer linked", ok: Boolean(w.offerId) && !offerGone, level: "must", detail: offerGone ? "The linked offer no longer exists. Pick another on the Offer step." : w.offerId ? "The closing frame has an offer to present." : "Pick an offer on the Offer step; the stack and the price come from it." });
  if (components !== undefined) {
    const unmapped = components.filter((c) => c.beliefBreak === "none").length;
    checks.push({ key: "stack", label: "Stack mapped to belief breaks", ok: components.length > 0 && unmapped === 0 && !offerGone, level: "must", detail: offerGone ? "The linked offer no longer exists." : !w.offerId ? "No offer linked yet." : !components.length ? "The offer has no stack components." : unmapped ? `${unmapped} of ${components.length} components not tied to a belief break.` : `All ${components.length} components tied to a belief break.` });
  }
  const totalMinutes = sections.reduce((a, s) => a + s.durationMin, 0);
  checks.push({ key: "runtime", label: `Runtime between 55 and 95 min (${totalMinutes})`, ok: totalMinutes >= 55 && totalMinutes <= 95, level: "must", detail: totalMinutes < 55 ? "Short for a webinar that teaches and then offers." : totalMinutes > 95 ? "Long: the end is what gets cut when a session overruns." : "In range." });
  const start = offerStart(sections);
  checks.push({ key: "offerStart", label: start ? `Offer starts at ${clock(start.startMin)} of ${start.totalMin} min` : "Offer start time", ok: Boolean(start && start.remainingShare >= OFFER_REMAINING_MIN), level: "warn", detail: !start ? "No closing-frame section to start the offer from." : `${Math.round(start.remainingShare * 100)}% of the session remains for the offer${start.remainingShare < OFFER_REMAINING_MIN ? ", under the 25% it needs" : ""}.` });
  const paced = sections.map((s) => ({ s, p: sectionPace(s) })).filter((x) => x.p.flag);
  const long = paced.filter((x) => x.p.flag === "long").map((x) => x.s.name ?? x.s.sectionKey);
  const thin = paced.filter((x) => x.p.flag === "thin").map((x) => x.s.name ?? x.s.sectionKey);
  checks.push({ key: "pace", label: "Scripts fit their slots", ok: !paced.length, level: "warn", detail: !scriptedRows.length ? "Nothing scripted yet to measure." : !paced.length ? `Every script is within its slot at ${WORDS_PER_MINUTE} words a minute.` : [long.length ? `Written long: ${long.join(", ")}.` : "", thin.length ? `Thin for the slot: ${thin.join(", ")}.` : ""].filter(Boolean).join(" ") });
  // A script that introduces someone other than the presenter: the wrong name survived a review, a build check and an export once.
  if (input.presenter) {
    const wrong = sections.map((s) => ({ s, m: nameMismatch(s.script, input.presenter!, input.presenterAliases ?? []) })).filter((x) => x.m);
    checks.push({ key: "presenterName", label: "Scripts speak as the presenter", ok: !wrong.length, level: "warn", detail: wrong.length ? wrong.map((x) => `${x.s.name ?? x.s.sectionKey} says "I'm ${x.m!.found}"; the presenter is ${x.m!.presenter}.`).join(" ") : `No script introduces anyone but ${input.presenter}.` });
  }
  // The twelfth check reads the deck the export would make: a refused export is a must; a deck under the pace band is a warning.
  if (input.deck) {
    const { refused, rate } = input.deck;
    const thin = rate !== null && rate < DECK_PACE_FLOOR;
    checks.push({ key: "deck", label: refused ? "Deck exports" : "Deck moves at a live pace", ok: !refused && !thin, level: refused ? "must" : "warn", detail: refused ? `${refused} ${refused === 1 ? "refusal" : "refusals"} on the Deck step: a claim with a hole in it never leaves as a slide.` : rate === null ? "No minutes to pace the deck against: give the sections their minutes and this check can run." : `${rate} slides a minute; the band is ${DECK_PACE_FLOOR} to 1.5.${thin ? " Under the band: the deck sits still while the presenter talks." : ""}` });
  }
  const must = checks.filter((c) => c.level === "must" && !c.ok);
  const warn = checks.filter((c) => c.level === "warn" && !c.ok);
  const passed = checks.filter((c) => c.ok).length;
  const script = sections.length ? scriptedRows.length / sections.length : 0;
  const drafted = sections.filter((s) => s.status !== "todo" || hasScript(s)).length;
  const steps: Record<StepKey, number> = {
    foundation: foundationParts / 5,
    beliefs: (3 - missingBeliefs.length) / 3,
    script,
    offer: w.offerId ? 1 : 0,
    deck: script >= 0.8 ? 1 : script,
    review: review ? (review.verdict === "ready" && !must.length ? 1 : 0.5) : 0,
    run: 0,
  };
  return { checks, must, warn, passed, total: checks.length, summary: `${passed} of ${checks.length} checks`, steps, scripted: scriptedRows.length, drafted, totalMinutes };
}

/** Ready is the record and the rating together: every must-check passing, and the coach's own rating passing too. Never one alone. */
export function readyDecision(rating: { verdict: "ready" | "needs_work" | "not_ready"; weakest: string[] } | null, build: BuildResult): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!rating) reasons.push("No readiness review saved yet.");
  else if (rating.verdict !== "ready") reasons.push(rating.weakest.length ? `Your rating has ${rating.weakest.join(", ")} at 2 or below.` : "Your rating is under 80%.");
  if (build.must.length) reasons.push(`${build.must.length} ${build.must.length === 1 ? "check" : "checks"} open: ${build.must.map((c) => c.label).join("; ")}.`);
  return { ready: !reasons.length, reasons };
}

/**
 * A status of ready or scheduled outlives its checks the way a review outlives its version: nothing demotes it when a proof's
 * approval is withdrawn or a study is deleted. So the status is marked stale wherever it is shown, and the broken checks named.
 */
export function statusStale(status: string, build: BuildResult): { stale: boolean; note: string } {
  const stale = (status === "ready" || status === "scheduled") && build.must.length > 0;
  return { stale, note: stale ? `${build.must.length} ${build.must.length === 1 ? "check has" : "checks have"} broken since it was marked ${status}: ${build.must.map((c) => c.label).join("; ")}.` : "" };
}

/** A review saved before the record's last content edit is stale: it graded something that has since changed. */
export const reviewStale = (review: { createdAt: string } | null, updatedAt: string | null | undefined): boolean => Boolean(review && updatedAt && review.createdAt < updatedAt);

/** The three readiness dimensions the record grades itself: presence counted per act, the offer read from its record. */
export const DERIVED_DIMENSIONS = ["proof", "stories", "offer"] as const;
export type DerivedKey = (typeof DERIVED_DIMENSIONS)[number];
export type DerivedGrade = { key: DerivedKey; value: number; working: string };
const ofThree = (n: number): number => (n >= 3 ? 5 : n === 2 ? 3 : n === 1 ? 2 : 1);

/**
 * The grades the record can give itself, each with its working shown. Presence per act for proof and stories; the offer from
 * whether one is linked, its stack is mapped, and a price is set. A count is a grade here; the quality of what is there is not.
 */
export function derivedGrades(input: { proofs: number; stories: number; offer: { linked: boolean; components: number; mapped: number; price: number } }): DerivedGrade[] {
  const o = input.offer;
  const offerValue = !o.linked ? 1 : !o.components ? 2 : o.mapped < o.components ? 3 : o.price <= 0 ? 3 : 5;
  const offerWorking = !o.linked ? "No offer linked." : !o.components ? "Offer linked; its stack has no components." : o.mapped < o.components ? `Offer linked; ${o.components - o.mapped} of ${o.components} components not tied to a belief break.` : o.price <= 0 ? "Offer linked and mapped; no price set." : `Offer linked, ${o.components} components mapped, price set.`;
  return [
    { key: "proof", value: ofThree(input.proofs), working: `${input.proofs} of 3 acts have a proof.` },
    { key: "stories", value: ofThree(input.stories), working: `${input.stories} of 3 acts have a story.` },
    { key: "offer", value: offerValue, working: offerWorking },
  ];
}

export type Override = { value: number; reason: string };
/** A derived grade can be lowered with a reason, never raised: the record's count is the ceiling. Returns the grade that counts. */
export function applyOverride(grade: DerivedGrade, override: Override | undefined): number {
  if (!override || !override.reason.trim()) return grade.value;
  const v = Math.max(1, Math.min(5, Math.round(override.value)));
  return v < grade.value ? v : grade.value;
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

