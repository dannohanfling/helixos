/**
 * Claude's webinar drafts (H-181, plan H-684), the pure parts: which fields each step takes, named exactly as the wizard names
 * them; reading a connector's fields (an unlisted field is refused, never ignored); taking out an income claim or a figure that
 * isn't in the offer or the member's own words; and the panel's "now beside the draft" rows. No database, no request.
 */
import { stripFabricated } from "@/lib/engine/blacklist";
import { ORIGIN_BEATS } from "@/lib/engine/webinar";

/** Who wrote a draft, as the history and the panel say it. */
export const CONNECTOR_LABEL = "Claude (connector)";
/** Undo stays open this long after the change. */
export const UNDO_DAYS = 7;

export const WEBINAR_CATEGORIES = ["Live", "Evergreen", "JV / partner", "Challenge"] as const;
export const CTA_TYPES = ["Book a call", "Buy now", "Apply", "Join the community", "Start the trial"] as const;
export const BELIEF_TYPES = ["vehicle", "internal", "external"] as const;
export type BeliefType = (typeof BELIEF_TYPES)[number];

/** The steps PR 1 drafts. Script and deck come in PR 2. */
export const DRAFTABLE_STEPS = ["foundation", "beliefs", "offer"] as const;
export type DraftableStep = (typeof DRAFTABLE_STEPS)[number];

/** Foundation's plain text fields, in the form's order, with the label the panel shows. */
export const FOUNDATION_TEXT: { key: FoundationTextKey; label: string; max: number }[] = [
  { key: "title", label: "Title", max: 200 },
  { key: "audience", label: "Audience", max: 2000 },
  { key: "coreProblem", label: "Core problem", max: 2000 },
  { key: "desiredResult", label: "Desired result", max: 2000 },
  { key: "promise", label: "Promise", max: 2000 },
  { key: "mechanismName", label: "Mechanism", max: 300 },
  { key: "mechanismWaivedReason", label: "Why no mechanism", max: 1000 },
  { key: "presenter", label: "Presenter", max: 200 },
  { key: "stayLine", label: "Stay to the end", max: 500 },
  { key: "promiseLine", label: "Promise line", max: 500 },
  { key: "chatPrompt", label: "Chat prompt", max: 500 },
  { key: "groundRule", label: "Ground rule", max: 500 },
  { key: "sessionGoal", label: "Session goal", max: 1000 },
  { key: "permissionLine", label: "Permission line", max: 500 },
  { key: "reflectionPrompt", label: "Reflection prompt", max: 500 },
  { key: "footerBrand", label: "Footer brand", max: 120 },
];
const FOUNDATION_CHOICE: Record<string, readonly string[]> = { category: WEBINAR_CATEGORIES, ctaType: CTA_TYPES };
export const FOUNDATION_FIELDS = [...FOUNDATION_TEXT.map((f) => f.key), "category", "ctaType", "outcomes", "originStory"] as const;
export const BELIEF_FIELDS = ["from", "to", "proofId", "storyId", "evidenceId"] as const;
export type BeliefField = (typeof BELIEF_FIELDS)[number];
export const OFFER_FIELDS = ["offerId", "ctaType"] as const;

/** The webinar's column each belief field writes. */
export const BELIEF_COLUMN: Record<BeliefField, "fromBelief" | "toBelief" | "proofId" | "storyAssetId" | "evidenceId"> = { from: "fromBelief", to: "toBelief", proofId: "proofId", storyId: "storyAssetId", evidenceId: "evidenceId" };
export const BELIEF_LABEL: Record<BeliefField, string> = { from: "They believe now", to: "They must believe by the end", proofId: "Proof", storyId: "Story", evidenceId: "Evidence" };
export const TYPE_LABEL: Record<BeliefType, string> = { vehicle: "Vehicle", internal: "Internal", external: "External" };

type FoundationTextKey = "title" | "audience" | "coreProblem" | "desiredResult" | "promise" | "mechanismName" | "mechanismWaivedReason" | "presenter" | "stayLine" | "promiseLine" | "chatPrompt" | "groundRule" | "sessionGoal" | "permissionLine" | "reflectionPrompt" | "footerBrand";
export type FoundationDraft = Partial<Record<FoundationTextKey | "category" | "ctaType", string>> & { outcomes?: string[]; originStory?: Record<string, string> };
export type BeliefDraft = Partial<Record<BeliefType, Partial<Record<BeliefField, string>>>>;
export type OfferDraft = { offerId?: string; ctaType?: string };
export type DraftFields = FoundationDraft | BeliefDraft | OfferDraft;

export type ReadFields = { fields: Record<string, unknown>; refused: string[]; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clip = (s: string, max: number) => s.trim().slice(0, max);

/**
 * A connector's fields for one step, as the draft will hold them. A name the step doesn't take is refused by name (so no tool
 * can set a date, a status, a link, a number or the registration page); a value of the wrong kind is a problem; empty strings
 * are dropped (a draft never blanks a field).
 */
export function readDraftFields(step: DraftableStep, raw: unknown): ReadFields {
  const refused: string[] = [];
  const problems: string[] = [];
  const fields: Record<string, unknown> = {};
  if (!isObj(raw)) return { fields, refused, problems: ["fields must be an object of the step's own field names"] };
  if (step === "foundation") {
    for (const [k, v] of Object.entries(raw)) {
      const text = FOUNDATION_TEXT.find((f) => f.key === k);
      if (text) {
        if (typeof v !== "string") problems.push(`${k} must be text`);
        else if (v.trim()) fields[k] = clip(v, text.max);
      } else if (k in FOUNDATION_CHOICE) {
        const ok = FOUNDATION_CHOICE[k]!;
        if (typeof v !== "string" || !ok.includes(v)) problems.push(`${k} must be one of: ${ok.join(", ")}`);
        else fields[k] = v;
      } else if (k === "outcomes") {
        if (!Array.isArray(v) || v.some((o) => typeof o !== "string")) problems.push("outcomes must be a list of up to 3 lines");
        else {
          const list = (v as string[]).map((o) => clip(o, 300)).filter(Boolean);
          if (list.length > 3) problems.push("outcomes takes at most 3 lines");
          else if (list.length) fields.outcomes = list;
        }
      } else if (k === "originStory") {
        if (!isObj(v)) problems.push(`originStory must map beats (${ORIGIN_BEATS.map((b) => b.key).join(", ")}) to text`);
        else {
          const beats: Record<string, string> = {};
          for (const [beat, t] of Object.entries(v)) {
            if (!ORIGIN_BEATS.some((b) => b.key === beat)) refused.push(`originStory.${beat}`);
            else if (typeof t !== "string") problems.push(`originStory.${beat} must be text`);
            else if (t.trim()) beats[beat] = clip(t, 1500);
          }
          if (Object.keys(beats).length) fields.originStory = beats;
        }
      } else refused.push(k);
    }
  } else if (step === "beliefs") {
    for (const [type, v] of Object.entries(raw)) {
      if (!(BELIEF_TYPES as readonly string[]).includes(type)) {
        refused.push(type);
        continue;
      }
      if (!isObj(v)) {
        problems.push(`${type} must be an object with ${BELIEF_FIELDS.join(", ")}`);
        continue;
      }
      const one: Record<string, string> = {};
      for (const [f, t] of Object.entries(v)) {
        if (!(BELIEF_FIELDS as readonly string[]).includes(f)) refused.push(`${type}.${f}`);
        else if (typeof t !== "string") problems.push(`${type}.${f} must be text`);
        else if (t.trim()) one[f] = clip(t, f === "from" || f === "to" ? 1000 : 80);
      }
      if (Object.keys(one).length) fields[type] = one;
    }
  } else {
    for (const [k, v] of Object.entries(raw)) {
      if (k === "offerId") {
        if (typeof v !== "string" || !v.trim()) problems.push("offerId must be one of the member's offer ids");
        else fields.offerId = v.trim();
      } else if (k === "ctaType") {
        if (typeof v !== "string" || !(CTA_TYPES as readonly string[]).includes(v)) problems.push(`ctaType must be one of: ${CTA_TYPES.join(", ")}`);
        else fields.ctaType = v;
      } else refused.push(k);
    }
  }
  return { fields, refused, problems };
}

/** Every figure a text names, digits only: "$1,997" is "1997", "47%" is "47". The same reading the slide check uses. */
export const figuresIn = (s: string): string[] => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((f) => f.replace(/,/g, ""));
const sentences = (s: string): string[] => s.split(/(?<=[.!?])\s+/);
/**
 * An income claim or a guarantee: what a member will earn, in figures or in words ("six figures"), or a promise it can't fail.
 * The ladder writer's guarantee words, plus the earnings phrasing a webinar is most tempted by.
 */
export const INCOME_CLAIM = /\b(guarantee[ds]?|sure[- ]fire|sure thing|can'?t fail|cannot fail|risk[- ]free income|passive income|(?:six|seven|eight|multi)[- ]figures?|(?:make|earn|making|earning|generate|bank)\s+(?:you\s+)?(?:\$|£|€|\d)|quit your (?:job|9[- ]to[- ]5)|replace your (?:income|salary))\b/i;

/**
 * One text field made safe for a draft: a fabricated statistic comes out (the blacklist the script drafter uses), and so does
 * an income claim or guarantee, and any sentence naming a figure that isn't in `known` (the offer and the member's own words).
 * What came out is returned.
 */
export function cleanText(text: string, known: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const fab = stripFabricated(text);
  for (const r of fab.removed) removed.push(r.sentence);
  const have = new Set(figuresIn(known));
  const lines = fab.text.split("\n").map((line) =>
    sentences(line)
      .filter((s) => {
        const bad = INCOME_CLAIM.test(s) || figuresIn(s).some((f) => !have.has(f));
        if (bad && s.trim()) removed.push(s.trim());
        return !bad;
      })
      .join(" "),
  );
  return { text: lines.join("\n").replace(/[ \t]+\n/g, "\n").trim(), removed };
}

/** Every text in a step's fields, cleaned. A text left empty by the cleaning is dropped from the draft. */
export function cleanFields(step: DraftableStep, fields: Record<string, unknown>, known: string): { fields: Record<string, unknown>; removed: string[] } {
  const removed: string[] = [];
  const one = (t: string) => {
    const c = cleanText(t, known);
    removed.push(...c.removed);
    return c.text;
  };
  const out: Record<string, unknown> = {};
  if (step === "offer") return { fields: { ...fields }, removed };
  if (step === "beliefs") {
    for (const [type, v] of Object.entries(fields)) {
      const b = { ...(v as Record<string, string>) };
      for (const f of ["from", "to"] as const) {
        if (b[f]) {
          const t = one(b[f]!);
          if (t) b[f] = t;
          else delete b[f];
        }
      }
      if (Object.keys(b).length) out[type] = b;
    }
    return { fields: out, removed };
  }
  for (const [k, v] of Object.entries(fields)) {
    if (k === "category" || k === "ctaType") out[k] = v;
    else if (k === "outcomes") {
      const list = (v as string[]).map(one).filter(Boolean);
      if (list.length) out.outcomes = list;
    } else if (k === "originStory") {
      const beats = Object.fromEntries(Object.entries(v as Record<string, string>).map(([b, t]) => [b, one(t)]).filter(([, t]) => t));
      if (Object.keys(beats).length) out.originStory = beats;
    } else {
      const t = one(String(v));
      if (t) out[k] = t;
    }
  }
  return { fields: out, removed };
}

/** One row of the panel: the field, what the webinar says now, and Claude's draft. */
export type DraftRow = { key: string; label: string; now: string; draft: string };
const show = (v: unknown): string => (Array.isArray(v) ? v.filter(Boolean).map((x, i) => `${i + 1}. ${x}`).join("\n") : v == null ? "" : String(v));

/** The panel's rows for a foundation draft: only the fields the draft sets, in the form's order. */
export function foundationRows(now: Record<string, unknown>, draft: FoundationDraft): DraftRow[] {
  const rows: DraftRow[] = [];
  const order = [...FOUNDATION_TEXT.slice(0, 1), { key: "category", label: "Type" }, ...FOUNDATION_TEXT.slice(1), { key: "outcomes", label: "Three outcomes" }, { key: "ctaType", label: "Call to action" }];
  for (const f of order) if (f.key in draft) rows.push({ key: f.key, label: f.label, now: show(now[f.key]), draft: show((draft as Record<string, unknown>)[f.key]) });
  for (const b of ORIGIN_BEATS) {
    const d = draft.originStory?.[b.key];
    if (d) rows.push({ key: `originStory.${b.key}`, label: `Origin story: ${b.label}`, now: ((now.originStory as Record<string, string> | undefined) ?? {})[b.key] ?? "", draft: d });
  }
  return rows;
}

/** The panel's rows for a beliefs draft; `name` turns a cited id into what the member knows it by. */
export function beliefRows(now: Partial<Record<BeliefType, Partial<Record<BeliefField, string | null>>>>, draft: BeliefDraft, name: (field: BeliefField, id: string) => string): DraftRow[] {
  const rows: DraftRow[] = [];
  for (const type of BELIEF_TYPES) {
    const d = draft[type];
    if (!d) continue;
    for (const f of BELIEF_FIELDS) {
      if (!d[f]) continue;
      const was = now[type]?.[f] ?? "";
      const cited = f !== "from" && f !== "to";
      rows.push({ key: `${type}.${f}`, label: `${TYPE_LABEL[type]}: ${BELIEF_LABEL[f]}`, now: cited && was ? name(f, was) : was, draft: cited ? name(f, d[f]!) : d[f]! });
    }
  }
  return rows;
}

/** Whether a change can still be undone. */
export const undoOpen = (at: string, nowMs: number): boolean => nowMs - Date.parse(at.includes("T") ? at : `${at.replace(" ", "T")}Z`) < UNDO_DAYS * 24 * 60 * 60 * 1000;

/** The plain line a history row reads as. */
export function historyLine(h: { action: string; step: string | null; byLabel: string; byConnector: boolean; changed: string[] }): string {
  const step = h.step ? `${h.step[0]!.toUpperCase()}${h.step.slice(1)}` : "Webinar";
  const what = h.changed.length ? ` (${h.changed.length} field${h.changed.length === 1 ? "" : "s"})` : "";
  const by = h.byConnector ? `by ${CONNECTOR_LABEL}` : `by ${h.byLabel}`;
  switch (h.action) {
    case "created":
      return `Webinar started ${by}`;
    case "drafted":
      return `${step}: draft written${what} ${by}`;
    case "approved":
      return `${step}: draft approved${what} ${by}`;
    case "edited":
      return `${step}: draft edited and saved ${by}`;
    case "discarded":
      return `${step}: draft discarded ${by}`;
    default:
      return `${step}: undone ${by}`;
  }
}
