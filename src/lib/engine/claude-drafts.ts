/**
 * Claude's drafts everywhere (H-184, plan H-220 PR D2), the pure parts: the fields each area takes (offers first), reading a
 * connector's fields (an unlisted field is refused by name, never ignored), cleaning the words the same way the webinar drafts
 * do, the red lines that keep Approve off, the panel's rows, and the history's plain lines. No database, no request. (Not to be
 * confused with engine/drafts.ts, the form drafts that follow a member between devices.)
 */
import { CONTENT_TYPES, MAGNET_TYPES, OFFER_CONTAINERS, PLATFORMS, type DraftArea, type MagnetContent } from "@/db/schema";
import { CURRENCIES } from "@/lib/engine/offer-score";
import { sectionByKey, type Story } from "@/lib/engine/essence";
import { contentToText, parseContent } from "@/lib/engine/lead-magnet";
import { cleanText, figuresIn } from "@/lib/engine/webinar-drafts";

export { CONNECTOR_LABEL, UNDO_DAYS, undoOpen } from "@/lib/engine/webinar-drafts";

/** The area as the member knows it: its name, and the menu item that carries the amber dot. */
export const AREA_WORDS: Record<DraftArea, { one: string; menu: string }> = {
  offer: { one: "Offer", menu: "/offers" },
  essence: { one: "Essence", menu: "/essence" },
  magnet: { one: "Lead magnet", menu: "/magnets" },
  content: { one: "Post", menu: "/content" },
  pathway: { one: "Pathway", menu: "/pathway" },
  course: { one: "Course", menu: "/courses" },
  bot_profile: { one: "Your bot", menu: "/settings" },
};

export type FieldSpec = { key: string; label: string; kind: "text" | "list" | "choice" | "price" | "stories" | "magnetContent" | "date"; max?: number; maxItems?: number; choices?: readonly string[] };

/**
 * What an offer draft may set, named as the offer's own fields. Not here, so refused by name: its status, the bot's fields, links
 * (sales page, payment), scarcity and urgency, the CTA footer and the notes.
 */
export const OFFER_FIELDS: FieldSpec[] = [
  { key: "name", label: "Offer name", kind: "text", max: 200 },
  { key: "avatar", label: "The one person this is for", kind: "text", max: 2000 },
  { key: "coreProblem", label: "Their core problem", kind: "text", max: 2000 },
  { key: "promise", label: "The Big Promise", kind: "text", max: 2000 },
  { key: "oneBelief", label: "The ONE belief", kind: "text", max: 1000 },
  { key: "difference", label: "How it's different", kind: "text", max: 2000 },
  { key: "mechanismName", label: "Named mechanism", kind: "text", max: 300 },
  { key: "pathSteps", label: "The path", kind: "list", max: 300 },
  { key: "container", label: "Container", kind: "choice", choices: OFFER_CONTAINERS },
  { key: "length", label: "Length", kind: "text", max: 200 },
  { key: "price", label: "Price", kind: "price" },
  { key: "currency", label: "Currency", kind: "choice", choices: CURRENCIES },
  { key: "paymentPlan", label: "Payment plan", kind: "text", max: 1000 },
  { key: "guarantee", label: "Guarantee", kind: "text", max: 2000 },
  { key: "howItWorks", label: "How it works", kind: "text", max: 3000 },
  { key: "forYouIf", label: "It's for you if", kind: "text", max: 2000 },
  { key: "notForYouIf", label: "It's not for you if", kind: "text", max: 2000 },
  { key: "whyNow", label: "Why now", kind: "text", max: 2000 },
  { key: "whyTrust", label: "Why trust you", kind: "text", max: 2000 },
  { key: "objTime", label: "Objection: no time", kind: "text", max: 2000 },
  { key: "objMoney", label: "Objection: money", kind: "text", max: 2000 },
  { key: "objPartner", label: "Objection: ask my partner", kind: "text", max: 2000 },
  { key: "objTriedBefore", label: "Objection: tried before", kind: "text", max: 2000 },
  { key: "objDiy", label: "Objection: do it myself", kind: "text", max: 2000 },
];

/** A lead magnet draft (H-184): its words only. Never its keyword, address, files, hand-overs or publishing. */
export const MAGNET_FIELDS: FieldSpec[] = [
  { key: "title", label: "Title", kind: "text", max: 200 },
  { key: "promise", label: "Promise", kind: "text", max: 1000 },
  { key: "audience", label: "Who it's for", kind: "text", max: 1000 },
  { key: "type", label: "Type", kind: "choice", choices: MAGNET_TYPES },
  { key: "content", label: "Outline and content, with the call to action at the end", kind: "magnetContent" },
];

/**
 * A post draft (H-184): the words, its type and platform, its pillar and a suggested date. On Approve it lands on the calendar as
 * In progress on that date, never scheduled or posted: scheduling stays its own step.
 */
export const CONTENT_FIELDS: FieldSpec[] = [
  { key: "title", label: "Title / working idea", kind: "text", max: 200 },
  { key: "hook", label: "Hook", kind: "text", max: 600 },
  { key: "body", label: "Body", kind: "text", max: 6000 },
  { key: "cta", label: "Call to action", kind: "text", max: 600 },
  { key: "contentType", label: "Type", kind: "choice", choices: CONTENT_TYPES },
  { key: "platform", label: "Platform", kind: "choice", choices: PLATFORMS },
  { key: "pillar", label: "Pillar", kind: "text", max: 100 },
  { key: "suggestedDate", label: "Suggested date", kind: "date" },
];

/**
 * What your bot says about your business (H-184): the words only. Never the booking link, the guarantee's terms or anything sent
 * to Community Loyalty: the bot keeps its current answers until the member approves, and what it is sent stays on Your bot.
 */
export const BOT_FIELDS: FieldSpec[] = [
  { key: "whatIDo", label: "What I do", kind: "text", max: 3000 },
  { key: "botQuestion1", label: "Question 1 your bot asks before booking", kind: "text", max: 300 },
  { key: "botQuestion2", label: "Question 2 your bot asks before booking", kind: "text", max: 300 },
  { key: "botQuestion3", label: "Question 3 your bot asks before booking", kind: "text", max: 300 },
  { key: "bookingExpect", label: "What to expect when you book", kind: "text", max: 500 },
];

/** An Essence section's own fields, by its key (H-184): a draft is of one section at a time. */
function essenceFields(section: string | null): FieldSpec[] {
  const s = section ? sectionByKey(section) : undefined;
  if (!s) return [];
  return s.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind === "stories" ? "stories" : f.kind === "list" ? "list" : "text", max: f.kind === "list" ? 500 : 3000, maxItems: f.kind === "list" ? 30 : undefined }));
}

/** The fields a draft of this area (and, for Essence, this section) may set. */
export function specsFor(area: DraftArea, targetId: string | null = null): FieldSpec[] {
  if (area === "offer") return OFFER_FIELDS;
  if (area === "magnet") return MAGNET_FIELDS;
  if (area === "content") return CONTENT_FIELDS;
  if (area === "essence") return essenceFields(targetId);
  if (area === "bot_profile") return BOT_FIELDS;
  return [];
}
export const PATH_MAX = 5;
const STORIES_MAX = 12;

export type ReadFields = { fields: Record<string, unknown>; refused: string[]; problems: string[] };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A connector's fields for one area, as the draft will hold them. A name the area doesn't take is refused by name; a value of
 * the wrong kind is a problem; an empty value is dropped (a draft never blanks a field). A price is a plain amount, never words.
 */
export function readFields(area: DraftArea, raw: unknown, targetId: string | null = null): ReadFields {
  const specs = specsFor(area, targetId);
  const refused: string[] = [];
  const problems: string[] = [];
  const fields: Record<string, unknown> = {};
  if (!isObj(raw)) return { fields, refused, problems: ["fields must be an object of the area's own field names"] };
  for (const [k, v] of Object.entries(raw)) {
    const spec = specs.find((s) => s.key === k);
    if (!spec) {
      refused.push(k);
      continue;
    }
    if (spec.kind === "text") {
      if (typeof v !== "string") problems.push(`${k} must be text`);
      else if (v.trim()) fields[k] = v.trim().slice(0, spec.max ?? 2000);
    } else if (spec.kind === "list") {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) problems.push(`${k} must be a list of short lines`);
      else {
        const most = spec.maxItems ?? PATH_MAX;
        const list = (v as string[]).map((x) => x.trim().slice(0, spec.max ?? 300)).filter(Boolean);
        if (list.length > most) problems.push(`${k} takes at most ${most} lines`);
        else if (list.length) fields[k] = list;
      }
    } else if (spec.kind === "stories") {
      if (!Array.isArray(v) || v.some((x) => !isObj(x))) problems.push(`${k} must be a list of stories, each {name, summary, when_to_use}`);
      else {
        const list = (v as Record<string, unknown>[])
          .map((x) => ({ name: String(x.name ?? "").trim().slice(0, 200), summary: String(x.summary ?? "").trim().slice(0, 2000), when_to_use: String(x.when_to_use ?? "").trim().slice(0, 500) }))
          .filter((x) => x.name || x.summary);
        if (list.length > STORIES_MAX) problems.push(`${k} takes at most ${STORIES_MAX} stories`);
        else if (list.length) fields[k] = list;
      }
    } else if (spec.kind === "magnetContent") {
      if (typeof v !== "string") problems.push(`${k} must be text: the intro, then "## Heading" lines with "- item" lines under each, then "---" and the closing with the call to action`);
      else if (v.trim()) {
        const c = parseContent(v.slice(0, 20000));
        if (!c.intro && !c.sections.length && !c.closing) problems.push(`${k} has nothing in it`);
        else fields[k] = c;
      }
    } else if (spec.kind === "date") {
      const d = typeof v === "string" ? v.trim() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d) problems.push(`${k} must be a date, like 2026-11-03`);
      else fields[k] = d;
    } else if (spec.kind === "choice") {
      const want = typeof v === "string" ? spec.choices!.find((c) => c.toLowerCase() === v.trim().toLowerCase()) : undefined;
      if (!want) problems.push(`${k} must be one of: ${spec.choices!.join(", ")}`);
      else fields[k] = want;
    } else {
      const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d[\d,]*(\.\d{1,2})?\s*$/.test(v) ? Number(v.replace(/,/g, "")) : NaN;
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) problems.push(`${k} must be a plain amount, like 1997`);
      else fields[k] = Math.round(n * 100) / 100;
    }
  }
  return { fields, refused, problems };
}

/**
 * Every text in a draft, cleaned: a fabricated statistic, an income claim or guarantee, and any sentence naming a figure that
 * isn't in `known` (the member's own facts) comes out. A text left empty is dropped. What came out is returned.
 */
export function cleanFields(area: DraftArea, fields: Record<string, unknown>, known: string, targetId: string | null = null): { fields: Record<string, unknown>; removed: string[] } {
  const specs = specsFor(area, targetId);
  const removed: string[] = [];
  const one = (t: string) => {
    const c = cleanText(t, known);
    removed.push(...c.removed);
    return c.text;
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const kind = specs.find((s) => s.key === k)?.kind;
    if (kind === "text") {
      const t = one(String(v));
      if (t) out[k] = t;
    } else if (kind === "list") {
      const list = (v as string[]).map(one).filter(Boolean);
      if (list.length) out[k] = list;
    } else if (kind === "stories") {
      const list = (v as Story[]).map((st) => ({ name: one(st.name), summary: one(st.summary), when_to_use: one(st.when_to_use) })).filter((st) => st.name || st.summary);
      if (list.length) out[k] = list;
    } else if (kind === "magnetContent") {
      const c = v as MagnetContent;
      const sections = c.sections.map((sec) => ({ ...sec, heading: one(sec.heading), items: sec.items.map(one).filter(Boolean), ...(sec.why ? { why: one(sec.why) } : {}), ...(sec.how ? { how: one(sec.how) } : {}) })).filter((sec) => sec.heading || sec.items.length);
      const next = { intro: one(c.intro), sections, closing: one(c.closing) };
      if (next.intro || next.sections.length || next.closing) out[k] = next;
    } else out[k] = v;
  }
  return { fields: out, removed };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const amount = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * The red lines (H-184): reasons Approve stays off, each in plain words. A field that changed since the draft was written
 * (approving would overwrite what the member did since), and a price that isn't in their own facts. Edit still opens the form
 * with the draft in it, so the member can check it and save it themselves.
 */
export function redLines(area: DraftArea, d: { targetId?: string | null; fields: Record<string, unknown>; base: Record<string, unknown> }, now: Record<string, unknown> | null, known: string): string[] {
  const specs = specsFor(area, d.targetId ?? null);
  const label = (k: string) => specs.find((s) => s.key === k)?.label ?? k;
  const out: string[] = [];
  if (now) {
    const moved = Object.keys(d.fields).filter((k) => k in d.base && !same(d.base[k], now[k]));
    if (moved.length) out.push(`${moved.map(label).join(", ")} changed since Claude wrote this. Approving would overwrite that: use Edit to bring the two together, or Discard.`);
  }
  if (area === "offer" && typeof d.fields.price === "number") {
    const p = d.fields.price as number;
    const was = now && typeof now.price === "number" ? (now.price as number) : null;
    if (p !== was && !figuresIn(known).includes(amount(p))) out.push(`The price ${amount(p)} isn't in your own facts yet. Check it, then use Edit to save it yourself.`);
  }
  // A post already scheduled or posted is on its way out: a draft never changes it (H-184).
  if (area === "content" && now && (now.status === "scheduled" || now.status === "posted")) out.push(`This post is already ${now.status}. Claude's draft can't change it: use Edit to change it yourself, or Discard.`);
  return out;
}

/** What those fields say now: the draft's base, and Undo's before. */
export const pick = (row: Record<string, unknown> | null, keys: string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, row?.[k] ?? null]));

/** One row of the panel: the field, what it says now, and Claude's draft. */
export type DraftRow = { key: string; label: string; now: string; draft: string };
function show(v: unknown, kind?: FieldSpec["kind"]): string {
  if (v == null) return "";
  if (kind === "stories") return (v as Story[]).map((st, i) => `${i + 1}. ${[st.name, st.summary].filter(Boolean).join(": ")}${st.when_to_use ? ` (use when: ${st.when_to_use})` : ""}`).join("\n");
  if (kind === "magnetContent") return contentToText(v as MagnetContent);
  if (Array.isArray(v)) return v.filter(Boolean).map((x, i) => `${i + 1}. ${x}`).join("\n");
  return String(v);
}

/** The panel's rows: only the fields the draft sets, in the form's order. */
export function rowsFor(area: DraftArea, now: Record<string, unknown> | null, fields: Record<string, unknown>, targetId: string | null = null): DraftRow[] {
  return specsFor(area, targetId)
    .filter((s) => s.key in fields)
    .map((s) => ({ key: s.key, label: s.label, now: show(now?.[s.key], s.kind), draft: show(fields[s.key], s.kind) }));
}

/** The plain line a history row reads as. */
export function changeLine(h: { action: string; area: DraftArea; byLabel: string; changed: string[] }): string {
  const what = h.changed.length ? ` (${h.changed.length} field${h.changed.length === 1 ? "" : "s"})` : "";
  const area = AREA_WORDS[h.area].one;
  switch (h.action) {
    case "drafted":
      return `${area}: draft written${what} by ${h.byLabel}`;
    case "approved":
      return `${area}: draft approved${what} by ${h.byLabel}`;
    case "edited":
      return `${area}: draft edited and saved by ${h.byLabel}`;
    case "discarded":
      return `${area}: draft discarded by ${h.byLabel}`;
    default:
      return `${area}: undone by ${h.byLabel}`;
  }
}

/** The facts a draft's figures are checked against: every text and amount the member has on their offers. */
export function offerFacts(offers: Record<string, unknown>[]): string {
  const keys = [...OFFER_FIELDS.map((f) => f.key), "depositAmount", "botTerms", "botFor", "botEndResult", "notes", "scarcity", "urgency"];
  return offers
    .map((o) => keys.map((k) => (Array.isArray(o[k]) ? (o[k] as unknown[]).join(" ") : typeof o[k] === "number" ? amount(o[k] as number) : (o[k] ?? ""))).join("\n"))
    .join("\n");
}
