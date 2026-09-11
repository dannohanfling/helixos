/** Offer optimizer: rule-based checks distilled from the OffersOS wizard and the Offer Builder stage. */

export type OfferInput = {
  name: string;
  avatar?: string | null;
  coreProblem?: string | null;
  promise?: string | null;
  mechanismName?: string | null;
  pathSteps?: string[] | null;
  container?: string | null;
  price?: number | null;
  guarantee?: string | null;
  scarcity?: string | null;
  urgency?: string | null;
  oneBelief?: string | null;
  difference?: string | null;
  whyNow?: string | null;
  whyTrust?: string | null;
  forYouIf?: string | null;
  notForYouIf?: string | null;
  objTime?: string | null;
  objMoney?: string | null;
  objPartner?: string | null;
  objTriedBefore?: string | null;
  objDiy?: string | null;
};

export type ComponentInput = { name: string; type: "core" | "bonus" | "guarantee"; perceivedValue: number; beliefBreak: "vehicle" | "internal" | "external" | "none" };

export type Check = { key: string; label: string; weight: number; pass: boolean; fix: string; group: "clarity" | "value" | "belief" | "risk" };

const filled = (s?: string | null, min = 12) => Boolean(s && s.trim().length >= min);
const hasNumber = (s?: string | null) => /\d/.test(s ?? "");
const hasTimeframe = (s?: string | null) => /\b(\d+\s*(day|days|week|weeks|month|months|year|years)|90-day|30-day|12-week|6-week|quarter)\b/i.test(s ?? "");
const hasWithout = (s?: string | null) => /\bwithout\b/i.test(s ?? "");

export function scoreOffer(offer: OfferInput, components: ComponentInput[], objectionsFromBank = 0): { score: number; checks: Check[]; stackValue: number; multiple: number; verdict: "ready" | "needs_work" | "not_ready" } {
  const bonuses = components.filter((c) => c.type === "bonus");
  const cores = components.filter((c) => c.type === "core");
  const stackValue = components.filter((c) => c.type !== "guarantee").reduce((a, c) => a + (c.perceivedValue || 0), 0);
  const price = offer.price ?? 0;
  const multiple = price > 0 ? stackValue / price : 0;
  const breaks = new Set(components.map((c) => c.beliefBreak));
  const checks: Check[] = [
    { key: "avatar", group: "clarity", label: "One specific person, not 'business owners'", weight: 10, pass: filled(offer.avatar, 25), fix: "Describe one person: who they are, what they want, what they've tried." },
    { key: "problem", group: "clarity", label: "A core problem in their words", weight: 8, pass: filled(offer.coreProblem, 20), fix: "Write the problem the way they'd say it at 10pm, not the way you'd diagnose it." },
    { key: "promise", group: "clarity", label: "Big Promise is specific and measurable", weight: 12, pass: filled(offer.promise, 20) && hasNumber(offer.promise), fix: "Add a number: pounds, clients, dollars, hours. Vague promises don't sell." },
    { key: "promise_time", group: "clarity", label: "Promise has a timeframe", weight: 6, pass: hasTimeframe(offer.promise), fix: "Add 'in 90 days' (or whatever is true). A promise without a clock is a wish." },
    { key: "promise_without", group: "clarity", label: "Promise names what they hate ('without…')", weight: 4, pass: hasWithout(offer.promise), fix: "Finish the sentence: 'without giving up X.' That's the line they repeat to a friend." },
    { key: "mechanism", group: "belief", label: "Named mechanism (your capital-letter method)", weight: 8, pass: filled(offer.mechanismName, 4), fix: "Give the method a name. 'My approach to X' is forgettable. 'The 12-Minute Tuesday System' is not." },
    { key: "path", group: "belief", label: "3 to 5 step framework", weight: 8, pass: (offer.pathSteps?.filter(Boolean).length ?? 0) >= 3 && (offer.pathSteps?.filter(Boolean).length ?? 0) <= 5, fix: "Map the journey in 3 to 5 named steps. Fewer feels thin, more feels like homework." },
    { key: "core", group: "value", label: "At least one core deliverable", weight: 8, pass: cores.length >= 1, fix: "Add the thing they're actually buying to the stack." },
    { key: "bonuses", group: "value", label: "3 or more bonuses", weight: 6, pass: bonuses.length >= 3, fix: "Add bonuses that remove reasons to stall: templates, a sprint, office hours, a swipe file." },
    { key: "multiple", group: "value", label: "Perceived value is 5x price or more", weight: 8, pass: price > 0 && multiple >= 5, fix: price > 0 ? `Stack is ${multiple.toFixed(1)}x price. Add value or name the value you already deliver.` : "Set a price so the value math can run." },
    { key: "belief_map", group: "belief", label: "Stack answers all three belief breaks", weight: 8, pass: breaks.has("vehicle") && breaks.has("internal") && breaks.has("external"), fix: "Tag components: one that proves the vehicle works, one that carries the technical load, one that wins the outside game." },
    { key: "one_belief", group: "belief", label: "The ONE belief (domino) is written", weight: 6, pass: filled(offer.oneBelief, 20), fix: "Finish: 'If they believe ___, they buy.' Everything in the webinar serves this line." },
    { key: "guarantee", group: "risk", label: "Guarantee or risk reversal", weight: 6, pass: filled(offer.guarantee, 15), fix: "What happens if it doesn't work? Say it plainly. Risk on you, not them." },
    { key: "why_now", group: "risk", label: "Why now (real urgency or scarcity)", weight: 4, pass: filled(offer.whyNow, 15) || filled(offer.urgency, 15) || filled(offer.scarcity, 15), fix: "Cohort dates, seat caps, bonus deadlines. Real, not manufactured." },
    // Answered objections: the bank's records this offer links that carry a reframe, plus any of the older fixed fields still filled. Same threshold, same weight, same group as before.
    { key: "objections", group: "risk", label: "Top 5 objections answered", weight: 6, pass: objectionsFromBank + [offer.objTime, offer.objMoney, offer.objPartner, offer.objTriedBefore, offer.objDiy].filter((o) => filled(o, 15)).length >= 4, fix: "Write your answer to: no time, no money, ask my partner, tried it before, I'll do it myself." },
    { key: "fit", group: "clarity", label: "'For you if / not for you if' written", weight: 4, pass: filled(offer.forYouIf, 15) && filled(offer.notForYouIf, 15), fix: "Saying who it's NOT for is what makes the right people lean in." },
  ];
  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.filter((c) => c.pass).reduce((a, c) => a + c.weight, 0);
  const score = Math.round((got / total) * 100);
  return { score, checks, stackValue, multiple, verdict: score >= 80 ? "ready" : score >= 55 ? "needs_work" : "not_ready" };
}

export function offerOnePager(offer: OfferInput, components: ComponentInput[]): string {
  const stack = components.filter((c) => c.type !== "guarantee").sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    `# ${offer.name}`,
    "",
    offer.promise ? `**${offer.promise}**` : "",
    "",
    offer.avatar ? `**Who it's for:** ${offer.avatar}` : "",
    offer.coreProblem ? `**The problem:** ${offer.coreProblem}` : "",
    offer.mechanismName ? `**The method:** ${offer.mechanismName}` : "",
    ...(offer.pathSteps?.filter(Boolean).length ? ["", "**The path:**", ...offer.pathSteps!.filter(Boolean).map((s, i) => `${i + 1}. ${s}`)] : []),
    "",
    "**What you get:**",
    ...stack.map((c) => `- ${c.name}${c.perceivedValue ? ` (value $${c.perceivedValue.toLocaleString()})` : ""}`),
    "",
    offer.price ? `**Investment:** $${offer.price.toLocaleString()}${offer.container ? ` · ${offer.container}` : ""}` : "",
    offer.guarantee ? `**Guarantee:** ${offer.guarantee}` : "",
    offer.whyNow ? `**Why now:** ${offer.whyNow}` : "",
    "",
    offer.forYouIf ? `**This is for you if:** ${offer.forYouIf}` : "",
    offer.notForYouIf ? `**This is not for you if:** ${offer.notForYouIf}` : "",
  ];
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").trim();
}
