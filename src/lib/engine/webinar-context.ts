/**
 * The resolver: give me everything wired to this section. One read of the record, in running order, with a cumulative clock,
 * for the three things that consume it: the run sheet, the deck, and the readiness grades. Pure. Nothing here invents a
 * fact: a slot with nothing wired to it is null, and a bracketed placeholder is reported, never filled.
 */
import { isUnreviewed, unreviewedCountLine } from "@/lib/engine/provenance";
import { ACTS, ACT_NUMBER, clock, freeTextProofUsable, sectionPace, type ActKey } from "./webinar";
import { formatPrice } from "./offer-score";
import { ORIGIN_BEATS } from "./webinar";

export type ProofRow = { id: string; who: string | null; name: string; quote?: string | null; longVersion?: string | null; shortVersion?: string | null; resultAfter?: string | null; status: string };
export type AssetRow = { id: string; type: string; name: string; body: string; summary?: string | null; useWhen?: string | null; reframe?: string | null; proof?: string | null; extra?: Record<string, string | null> };
export type EssenceStory = { name: string; summary: string; when_to_use?: string };
export type CitableRow = { id: string; source: "own" | "shared"; claim: string; authors: string; year: number | null; title: string; url?: string | null; doi?: string | null };
export type OfferRow = { name: string; price: number; currency?: string | null; container: string; guarantee?: string | null; paymentPlan?: string | null; scarcity?: string | null; urgency?: string | null; ctaFooter?: string | null; forYouIf?: string | null; notForYouIf?: string | null; objectionAssetIds?: string[] };
export type ComponentRow = { name: string; type: string; description?: string | null; oneLiner?: string | null; perceivedValue: number; beliefBreak: string };
export type BeliefRow = { type: string; fromBelief: string | null; toBelief: string | null; proofId?: string | null; proof?: string | null; proofWho?: string | null; proofPermissionAt?: string | null; proofChangedAt?: string | null; storyAssetId?: string | null; evidenceId?: string | null; proofRepeat?: boolean | null };
export type SectionRow = { sectionKey: string; act: ActKey; order: number; name: string; status: string; buildStyle?: string | null; keyPoints: string | null; script: string | null; transitionIn: string | null; transitionOut: string | null; deliveryNote?: string | null; assetId: string | null; durationMin: number; origin?: string | null };

/** `texts` is every version of the proof's words the record holds (long, short, quote, result), so a line quoting any of them is known to be this proof. */
export type ResolvedProof = { id: string; who: string; quote: string; source: "bank" | "typed"; texts: string[] };
export type ResolvedStory = { id: string; name: string; body: string; moral: string | null; useWhen: string | null; source: "bank" | "essence" };
export type ResolvedEvidence = { id: string; claim: string; citation: string };
export type ResolvedObjection = { id: string; name: string; body: string; reframe: string | null; proof: string | null };
export type ResolvedOffer = { name: string; price: number; currency: string; container: string; guarantee: string | null; paymentPlan: string | null; scarcity: string | null; urgency: string | null; ctaFooter: string | null; forYouIf: string | null; notForYouIf: string | null; components: ComponentRow[]; objections: ResolvedObjection[] };

export type SectionContext = {
  sectionKey: string;
  order: number;
  name: string;
  act: ActKey;
  actLabel: string;
  durationMin: number;
  startMin: number;
  endMin: number;
  start: string;
  end: string;
  keyPoints: string[];
  script: string | null;
  transitionIn: string | null;
  transitionOut: string | null;
  deliveryNote: string | null;
  status: string;
  /** reveal: the key points build up one slide at a time. */
  buildStyle: "none" | "reveal";
  belief: { from: string; to: string } | null;
  proof: ResolvedProof | null;
  /** The coach ticked "show it again" for this act: a proof already shown elsewhere may appear here too. */
  proofRepeat: boolean;
  story: ResolvedStory | null;
  evidence: ResolvedEvidence | null;
  asset: { type: string; name: string; body: string } | null;
  /** The linked offer, on the closing frame's sections only. */
  offer: ResolvedOffer | null;
  /** The objections the offer answers, on the Q&A section, where the presenter needs them to hand. */
  objections: ResolvedObjection[];
  placeholders: string[];
  /** The script is a model's draft nobody has read: the run sheet marks it, since that sheet is read aloud to a live room. */
  unreviewed: boolean;
  pace: ReturnType<typeof sectionPace>;
};
export type ActContext = { key: ActKey; label: string; startMin: number; endMin: number; durationMin: number; sections: SectionContext[] };
export type WebinarContext = {
  title: string;
  presenter: string;
  /** The one line for staying to the end, or null. */
  stayLine: string | null;
  /** The origin story's filled beats, in order. */
  originStory: { key: string; label: string; text: string }[];
  /** Who the offer is for and not for, read off the Offer record. */
  fit: { forYouIf: string | null; notForYouIf: string | null };
  /** The opening contract, each the coach's own words: a null one is omitted from the deck and listed on the Deck step. */
  opening: { promiseLine: string | null; chatPrompt: string | null; groundRule: string | null; outcomes: string[]; sessionGoal: string | null; permissionLine: string | null; reflectionPrompt: string | null };
  /** Per-webinar chrome: the logo footer bar and the CTA bar, both off unless the coach turned them on. */
  footerBar: boolean;
  ctaBar: boolean;
  acts: ActContext[];
  sections: SectionContext[];
  totalMin: number;
  scriptedMin: number;
  placeholders: { section: string; tokens: string[] }[];
};

export const QA_SECTION_KEY = "q_a_close";
/** A bracketed slot someone meant to fill: "[X]%", "[SALES PAGE URL]", "[PROOF PLACEHOLDER]". Reported, never filled. */
export const PLACEHOLDER = /\[[^\]\n]{1,80}\]%?/g;
export const placeholdersIn = (text: string | null | undefined): string[] => [...new Set((text ?? "").match(PLACEHOLDER) ?? [])];

const actLabel = (key: ActKey): string => `${ACT_NUMBER[key] ? `${ACT_NUMBER[key]} · ` : ""}${(ACTS.find((a) => a.key === key)?.name ?? key).replace(/^[^\w]+/, "").replace(/^Act \d+ — /, "")}`;

export function resolveProof(b: BeliefRow | undefined, proofs: ProofRow[]): ResolvedProof | null {
  if (!b) return null;
  const row = b.proofId ? proofs.find((p) => p.id === b.proofId && p.status === "approved") : undefined;
  if (row) return { id: row.id, who: row.who ?? row.name, quote: row.longVersion ?? row.shortVersion ?? row.quote ?? row.resultAfter ?? "", source: "bank", texts: [row.longVersion, row.shortVersion, row.quote, row.resultAfter].filter((t): t is string => Boolean(t && t.trim())) };
  if (freeTextProofUsable({ proof: b.proof ?? null, proofPermissionAt: b.proofPermissionAt ?? null, proofChangedAt: b.proofChangedAt ?? null })) return { id: "typed", who: b.proofWho ?? "", quote: (b.proof ?? "").trim(), source: "typed", texts: [(b.proof ?? "").trim()] };
  return null;
}

export function resolveStory(b: BeliefRow | undefined, assets: AssetRow[], essenceStories: EssenceStory[]): ResolvedStory | null {
  const id = b?.storyAssetId;
  if (!id) return null;
  if (id.startsWith("essence:")) {
    const st = essenceStories[Number(id.slice(8))];
    return st ? { id, name: st.name, body: st.summary, moral: null, useWhen: st.when_to_use ?? null, source: "essence" } : null;
  }
  const a = assets.find((x) => x.id === id && x.type === "story");
  return a ? { id: a.id, name: a.name, body: a.body, moral: a.extra?.moral ?? null, useWhen: a.useWhen ?? null, source: "bank" } : null;
}

export function resolveEvidence(b: BeliefRow | undefined, citable: CitableRow[]): ResolvedEvidence | null {
  const id = b?.evidenceId;
  if (!id) return null;
  const e = citable.find((x) => (x.source === "shared" ? `shared:${x.id}` : x.id) === id);
  if (!e) return null;
  const link = e.url ?? (e.doi ? `https://doi.org/${e.doi}` : "");
  return { id, claim: e.claim, citation: `${e.authors || "Unknown"}${e.year ? ` (${e.year})` : ""}. ${e.title}.${link ? ` ${link}` : ""}` };
}

const objection = (a: AssetRow): ResolvedObjection => ({ id: a.id, name: a.name, body: a.body, reframe: a.reframe ?? null, proof: a.proof ?? null });

export function resolveSections(input: { webinar: { title: string; stayLine?: string | null; originStory?: Record<string, string> | null; promiseLine?: string | null; chatPrompt?: string | null; groundRule?: string | null; outcomes?: string[] | null; sessionGoal?: string | null; permissionLine?: string | null; reflectionPrompt?: string | null; footerBar?: boolean; ctaBar?: boolean }; presenter: string; sections: SectionRow[]; beliefs: BeliefRow[]; proofs: ProofRow[]; assets: AssetRow[]; essenceStories: EssenceStory[]; citable: CitableRow[]; offer: { offer: OfferRow; components: ComponentRow[] } | null }): WebinarContext {
  // Left out on purpose means left out: no clock, no slide, no row on the run sheet.
  const ordered = input.sections.filter((s) => s.status !== "omitted").slice().sort((a, b) => a.order - b.order);
  const offer: ResolvedOffer | null = input.offer
    ? {
        name: input.offer.offer.name,
        price: input.offer.offer.price,
        currency: input.offer.offer.currency ?? "USD",
        container: input.offer.offer.container,
        guarantee: input.offer.offer.guarantee ?? null,
        paymentPlan: input.offer.offer.paymentPlan ?? null,
        scarcity: input.offer.offer.scarcity?.trim() || null,
        urgency: input.offer.offer.urgency?.trim() || null,
        ctaFooter: input.offer.offer.ctaFooter?.trim() || null,
        forYouIf: input.offer.offer.forYouIf?.trim() || null,
        notForYouIf: input.offer.offer.notForYouIf?.trim() || null,
        components: input.offer.components,
        objections: (input.offer.offer.objectionAssetIds ?? []).map((id) => input.assets.find((a) => a.id === id && a.type === "objection")).filter((a): a is AssetRow => Boolean(a)).map(objection),
      }
    : null;
  let cursor = 0;
  const sections: SectionContext[] = ordered.map((s) => {
    const b = input.beliefs.find((x) => x.type === s.act);
    const asset = s.assetId ? input.assets.find((a) => a.id === s.assetId) : undefined;
    const startMin = cursor;
    cursor += s.durationMin;
    const keyPoints = (s.keyPoints ?? "").split(/\n/).map((p) => p.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean);
    return {
      sectionKey: s.sectionKey,
      order: s.order,
      name: s.name,
      act: s.act,
      actLabel: actLabel(s.act),
      durationMin: s.durationMin,
      startMin,
      endMin: cursor,
      start: clock(startMin),
      end: clock(cursor),
      keyPoints,
      script: s.script?.trim() || null,
      transitionIn: s.transitionIn?.trim() || null,
      transitionOut: s.transitionOut?.trim() || null,
      deliveryNote: s.deliveryNote?.trim() || null,
      status: s.status,
      buildStyle: s.buildStyle === "reveal" ? "reveal" : "none",
      belief: b && b.fromBelief && b.toBelief ? { from: b.fromBelief, to: b.toBelief } : null,
      proof: resolveProof(b, input.proofs),
      proofRepeat: Boolean(b?.proofRepeat),
      story: resolveStory(b, input.assets, input.essenceStories),
      evidence: resolveEvidence(b, input.citable),
      asset: asset ? { type: asset.type, name: asset.name, body: asset.body } : null,
      offer: s.act === "closing" ? offer : null,
      objections: s.sectionKey === QA_SECTION_KEY && offer ? offer.objections : [],
      placeholders: [...new Set([...placeholdersIn(s.keyPoints), ...placeholdersIn(s.script)])],
      unreviewed: isUnreviewed(s.origin),
      pace: sectionPace(s),
    };
  });
  const acts: ActContext[] = (["opening", "vehicle", "internal", "external", "closing"] as ActKey[])
    .map((key) => {
      const own = sections.filter((s) => s.act === key);
      return { key, label: actLabel(key), startMin: own[0]?.startMin ?? 0, endMin: own[own.length - 1]?.endMin ?? 0, durationMin: own.reduce((a, s) => a + s.durationMin, 0), sections: own };
    })
    .filter((a) => a.sections.length);
  return {
    title: input.webinar.title,
    presenter: input.presenter,
    stayLine: input.webinar.stayLine?.trim() || null,
    originStory: ORIGIN_BEATS.map((b) => ({ key: b.key, label: b.label, text: (input.webinar.originStory?.[b.key] ?? "").trim() })).filter((b) => b.text),
    fit: { forYouIf: offer?.forYouIf ?? null, notForYouIf: offer?.notForYouIf ?? null },
    opening: {
      promiseLine: input.webinar.promiseLine?.trim() || null,
      chatPrompt: input.webinar.chatPrompt?.trim() || null,
      groundRule: input.webinar.groundRule?.trim() || null,
      outcomes: (input.webinar.outcomes ?? []).map((o) => o.trim()).filter(Boolean),
      sessionGoal: input.webinar.sessionGoal?.trim() || null,
      permissionLine: input.webinar.permissionLine?.trim() || null,
      reflectionPrompt: input.webinar.reflectionPrompt?.trim() || null,
    },
    footerBar: Boolean(input.webinar.footerBar),
    ctaBar: Boolean(input.webinar.ctaBar),
    acts,
    sections,
    totalMin: cursor,
    scriptedMin: Math.round(sections.reduce((a, s) => a + (s.script ? s.pace.estimatedMin : 0), 0)),
    placeholders: sections.filter((s) => s.placeholders.length).map((s) => ({ section: s.name, tokens: s.placeholders })),
  };
}

/** The run sheet as plain text, for copying into wherever the presenter reads from. */
/** The sections whose script is a model's draft nobody has read, by name, in running order: the run sheet's count. */
export const unreviewedSections = (c: WebinarContext): string[] => c.acts.flatMap((a) => a.sections.filter((s) => s.unreviewed).map((s) => s.name));

export function runSheetText(c: WebinarContext): string {
  const out: string[] = [`${c.title}`, `Presented by ${c.presenter} · ${c.totalMin} min · scripted ≈ ${c.scriptedMin} min`];
  const unreviewed = unreviewedSections(c);
  if (unreviewed.length) out.push(unreviewedCountLine(unreviewed));
  out.push("");
  for (const a of c.acts) {
    out.push(`${a.label.toUpperCase()}  ${a.durationMin} min · ${clock(a.startMin)} → ${clock(a.endMin)}`, "");
    for (const s of a.sections) {
      out.push(`  ${s.order} · ${s.name.toUpperCase()}  ${s.durationMin} min · ${s.start}`);
      if (s.transitionIn) out.push(`  ── in: ${s.transitionIn}`);
      if (s.keyPoints.length) out.push(`  KEY POINTS`, ...s.keyPoints.map((p) => `    · ${p}`));
      if (s.unreviewed) out.push(`  [AI draft, not reviewed]`);
      if (s.script) out.push(`  SCRIPT`, ...s.script.split("\n").map((l) => `    ${l}`));
      if (s.deliveryNote) out.push(`  DELIVERY  ${s.deliveryNote}`);
      if (s.proof) out.push(`  PROOF     ${s.proof.who}: "${s.proof.quote}"${s.proof.source === "bank" ? " [approved]" : " [typed, permission ticked]"}`);
      if (s.evidence) out.push(`  EVIDENCE  ${s.evidence.claim} (${s.evidence.citation})`);
      if (s.story) out.push(`  STORY     ${s.story.name}`);
      if (s.asset) out.push(`  ${s.asset.type.toUpperCase().padEnd(9)} ${s.asset.name}`);
      if (s.offer && s.sectionKey !== QA_SECTION_KEY) out.push(`  OFFER     ${s.offer.name} · ${formatPrice(s.offer.price, s.offer.currency)}${s.offer.components.length ? ` · ${s.offer.components.map((x) => x.name).join(", ")}` : ""}`);
      if (s.objections.length) out.push(`  OBJECTIONS`, ...s.objections.map((o) => `    · ${o.name}${o.reframe ? ` — ${o.reframe.split("\n")[0]}` : ""}`));
      if (s.placeholders.length) out.push(`  UNFILLED  ${s.placeholders.join(" ")}`);
      if (s.transitionOut) out.push(`  ── out: ${s.transitionOut}`);
      out.push("");
    }
  }
  return out.join("\n").trim();
}
