/**
 * The Essence System, pure: the fourteen sections of a client's brand voice (and the optional Brand), how they serialise into the block that leads
 * every AI system message, and the completion the wizard shows. Every word inside an Essence is the client's; this file
 * holds structure only. "Brand voice should be a config file, not a vibe."
 */
import helpJson from "@/data/essence-help.json";
import placeholdersJson from "@/data/essence-placeholders.json";
import { spellingLine, type Spelling } from "@/lib/engine/spelling";

export type FieldKind = "text" | "list" | "stories" | "outcomes";
export type EssenceField = { key: string; label: string; kind: FieldKind };
/** optional: not counted in completion until it holds something (Brand, 27 Sep), so adding it lowers no one's progress. */
export type EssenceSection = { key: string; title: string; fields: EssenceField[]; optional?: boolean };
export type Story = { name: string; summary: string; when_to_use: string };
/** One key outcome (H-811 A2): the member's own name for it, its line, and optionally who it's for ("clients", "practitioners"). */
export type Outcome = { name: string; line: string; audience: string };
export type EssenceData = Record<string, Record<string, string | string[] | Story[] | Outcome[]>>;

const label = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const t = (key: string): EssenceField => ({ key, label: label(key), kind: "text" });
const l = (key: string): EssenceField => ({ key, label: label(key), kind: "list" });

/** Danno's production schema, thirteen sections, plus representative_stories, in his order. */
export const ESSENCE_SECTIONS: EssenceSection[] = [
  { key: "guidelines_to_respond", title: "Guidelines to respond", fields: [t("response_length"), t("tone"), l("style"), t("user_reference"), l("prohibited_actions"), t("role_and_focus"), { key: "house_rules", label: "Your bot's house rules, in order", kind: "list" }] },
  { key: "identity", title: "Identity", fields: [t("name"), t("role"), l("core_traits"), l("tone_of_voice"), { key: "bot_persona", label: "Who your bot speaks as", kind: "text" }] },
  { key: "mission_and_vision", title: "Mission and vision", fields: [t("mission_statement"), t("vision_statement")] },
  { key: "goals_and_objectives", title: "Goals and objectives", fields: [l("primary_goals"), l("secondary_goals")] },
  { key: "behavior_and_interaction_style", title: "Behavior and interaction style", fields: [l("default_behavior"), l("response_style"), t("learning_adaptability")] },
  { key: "knowledge_and_expertise", title: "Knowledge and expertise", fields: [l("core_expertise"), l("secondary_expertise")] },
  { key: "cultural_and_philosophical_alignment", title: "Cultural and philosophical alignment", fields: [l("inspirations"), t("philosophy")] },
  { key: "communication_guidelines", title: "Communication guidelines", fields: [l("language"), l("formatting"), t("inclusivity")] },
  { key: "emotional_intelligence", title: "Emotional intelligence", fields: [t("empathy"), t("encouragement"), t("conflict_resolution")] },
  { key: "systems_and_methodology", title: "Systems and methodology", fields: [l("frameworks"), l("tools")] },
  { key: "brand_and_differentiation", title: "Brand and differentiation", fields: [t("unique_value_proposition"), t("signature_style")] },
  // The master brand, layered (27 Sep, Phase 1 of a client's Airtable import): what a coach's Vision holds beyond the UVP.
  {
    key: "brand",
    title: "Brand",
    optional: true,
    fields: [t("purpose"), t("tagline"), t("slogan"), t("master_positioning"), t("competitive_advantage"), t("brand_promise"), t("three_year_snapshot"), t("culture"), t("standards"), t("operating_spine"), l("values"), l("principles"), l("content_pillars"), l("strategic_partners"), t("tone_and_values"), t("revenue_targets"), t("notes")],
  },
  // Named rows (H-811 A2): as many as the member has, in their order, each optionally for one audience. An Essence saved with
  // the three fixed boxes (clarity, impact, connection) is read into rows of those names, so nothing is lost.
  { key: "key_outcomes_for_users", title: "Key outcomes for users", fields: [{ key: "outcomes", label: "Outcomes", kind: "outcomes" }] },
  { key: "ethical_standards", title: "Ethical standards", fields: [t("transparency"), t("inclusivity"), t("empowerment")] },
  { key: "representative_stories", title: "Representative stories", fields: [{ key: "stories", label: "Stories", kind: "stories" }] },
];
export const sectionByKey = (key: string) => ESSENCE_SECTIONS.find((s) => s.key === key);
const STORIES_SECTION = "representative_stories";
const STORIES_FIELD = "stories";
export const OUTCOMES_SECTION = "key_outcomes_for_users";
/** The three boxes the section had before (H-811 A2), in their order, read into rows of these names. */
export const LEGACY_OUTCOMES = [
  ["clarity", "Clarity"],
  ["impact", "Impact"],
  ["connection", "Connection"],
] as const;
export const MAX_OUTCOMES = 12;

/**
 * The platform limit the production Essence lives under; matching it keeps the app's Essence portable to the bot. It counts
 * the core: every section but Brand (H-811, 18 Oct), which has a budget of its own, so a long Brand never pushes the core out.
 */
export const ESSENCE_CAP = 20000;
/** Brand's own budget (H-811): over it, only Brand is left out of the AI's calls; the core still leads every one. */
export const BRAND_CAP = 20000;
export const BRAND_SECTION = "brand";

/** One-line prompts under the fields, keyed "section.field". Danno's words for the hard ones, plain restatements for the rest. */
export const ESSENCE_HELP: Record<string, string> = helpJson as Record<string, string>;
/**
 * Faint example text inside each input, keyed "section.field": five different invented coaches, deliberately unalike, so
 * nobody mistakes them for a template. A placeholder is only ever a placeholder: never a value, never saved, never sent.
 * A list placeholder carries its items separated by " / ".
 */
export const ESSENCE_PLACEHOLDERS: Record<string, string> = placeholdersJson as Record<string, string>;
export const placeholderFor = (section: string, field: string, kind: FieldKind = "text"): string => {
  const p = ESSENCE_PLACEHOLDERS[`${section}.${field}`] ?? "";
  return kind === "list" ? p.split(" / ").join("\n") : p;
};

/**
 * A typed value as stored: a browser sends a text box's line breaks as "\r\n", stored text has "\n". Without this, saving a long
 * multi-line field unchanged grew it by a character a line, so a trim that should fit was refused as growing (Lindsey, 20 Oct).
 */
const cleanText = (v: unknown): string => String(v ?? "").replace(/\r\n?/g, "\n").trim();

const cleanList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" ? v.split("\n").map((x) => x.trim()).filter(Boolean) : []);
const cleanStories = (v: unknown): Story[] =>
  Array.isArray(v)
    ? v
        .map((x) => (x && typeof x === "object" ? { name: cleanText((x as Story).name), summary: cleanText((x as Story).summary), when_to_use: cleanText((x as Story).when_to_use) } : null))
        .filter((x): x is Story => Boolean(x && (x.name || x.summary || x.when_to_use)))
    : [];

const cleanOutcomes = (v: unknown): Outcome[] =>
  Array.isArray(v)
    ? v
        .map((x) => (x && typeof x === "object" ? { name: cleanText((x as Outcome).name).slice(0, 80), line: cleanText((x as Outcome).line).slice(0, 1000), audience: cleanText((x as Outcome).audience).slice(0, 80) } : null))
        .filter((x): x is Outcome => Boolean(x && (x.name || x.line)))
        .slice(0, MAX_OUTCOMES)
    : [];
/** The section's rows: the saved rows, or the three old boxes carried over as rows of their own names. */
export function outcomeRows(raw: Record<string, unknown>): Outcome[] {
  if (Array.isArray(raw.outcomes)) return cleanOutcomes(raw.outcomes);
  return LEGACY_OUTCOMES.map(([key, name]) => ({ name, line: typeof raw[key] === "string" ? (raw[key] as string).trim() : "", audience: "" })).filter((o) => o.line);
}

/** Only known sections and fields survive, each in its declared shape; nothing is added, nothing is invented. */
export function normalizeEssence(input: unknown): EssenceData {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: EssenceData = {};
  for (const section of ESSENCE_SECTIONS) {
    const given = src[section.key];
    // The production schema carries representative_stories as a bare array; stored rows carry it under "stories". Both are read.
    const raw = (Array.isArray(given) && section.key === STORIES_SECTION ? { [STORIES_FIELD]: given } : given && typeof given === "object" ? given : {}) as Record<string, unknown>;
    const sec: Record<string, string | string[] | Story[] | Outcome[]> = {};
    for (const f of section.fields) {
      const v = raw[f.key];
      if (f.kind === "text") {
        const s = typeof v === "string" ? cleanText(v) : "";
        if (s) sec[f.key] = s;
      } else if (f.kind === "list") {
        const arr = cleanList(v);
        if (arr.length) sec[f.key] = arr;
      } else if (f.kind === "outcomes") {
        const rows = outcomeRows(raw);
        if (rows.length) sec[f.key] = rows;
      } else {
        const st = cleanStories(v);
        if (st.length) sec[f.key] = st;
      }
    }
    if (Object.keys(sec).length) out[section.key] = sec;
  }
  return out;
}

export const sectionFilled = (data: EssenceData, key: string) => Boolean(data[key] && Object.keys(data[key]).length);
export function completion(data: EssenceData): { filled: number; total: number; empty: boolean } {
  const counted = ESSENCE_SECTIONS.filter((s) => !s.optional || sectionFilled(data, s.key));
  const filled = counted.filter((s) => sectionFilled(data, s.key)).length;
  return { filled, total: counted.length, empty: filled === 0 };
}

/** The Essence as one compact JSON block in the production shape, Brand and all: what the sizes measure. */
function serializeWhole(data: EssenceData): string | null {
  const clean = normalizeEssence(data);
  if (!Object.keys(clean).length) return null;
  const shaped: Record<string, unknown> = { ...clean };
  if (clean[STORIES_SECTION]) shaped[STORIES_SECTION] = clean[STORIES_SECTION][STORIES_FIELD] ?? [];
  return JSON.stringify(shaped);
}
/** Everything but Brand: the part the 20,000 cap counts. */
export const essenceCore = (data: EssenceData): EssenceData => Object.fromEntries(Object.entries(data).filter(([k]) => k !== BRAND_SECTION));
/** Brand alone, or nothing. */
export const essenceBrand = (data: EssenceData): EssenceData => (data[BRAND_SECTION] ? { [BRAND_SECTION]: data[BRAND_SECTION] } : {});

/** The whole Essence's size, Brand included, as one block. */
export const essenceChars = (data: EssenceData) => serializeWhole(data)?.length ?? 0;
/** The core's size, measured against ESSENCE_CAP. */
export const coreChars = (data: EssenceData) => essenceChars(essenceCore(data));
/** Brand's size on its own, measured against BRAND_CAP. */
export const brandChars = (data: EssenceData) => essenceChars(essenceBrand(data));

/**
 * Over the cap: an Essence can arrive over it whole (an Airtable import, 28 Sep: nothing of the client's is cut silently). It
 * is kept as it is, marked, and left out of every AI call until it is trimmed under; a save that doesn't grow it is always
 * allowed, so trimming works one section at a time. The core only: Brand is measured on its own (brandOver).
 */
export const essenceOver = (data: EssenceData): number => Math.max(0, coreChars(data) - ESSENCE_CAP);
/** Brand over its own budget: kept whole and marked like the core, but only Brand is left out of the AI's calls. */
export const brandOver = (data: EssenceData): number => Math.max(0, brandChars(data) - BRAND_CAP);

/**
 * Where a save refused over a cap lands (H-802, H-811): an error answer (?error=over, or brandover for Brand), so the Save button puts back
 * what was typed and the draft is kept, and the page says how big it would have been from `chars`.
 */
export const essenceOverAddress = (step: string, chars: number, error: "over" | "brandover" = "over"): string => `/essence?step=${encodeURIComponent(step)}&error=${error}&chars=${chars}`;

/**
 * The block that leads every system message: the client's Essence as compact JSON in the production shape
 * (representative_stories as a bare array), or null when nothing is filled in. With Brand over its own budget, the core
 * alone (H-811). The core over its cap is the caller's to leave out (essenceBlockFor), with the warning shown.
 */
export function serializeEssence(data: EssenceData): string | null {
  return serializeWhole(brandOver(data) ? essenceCore(normalizeEssence(data)) : data);
}
/** What every AI call carries: nothing with the core over its cap, else the block serializeEssence makes. */
export const essenceForAi = (data: EssenceData): string | null => (essenceOver(data) ? null : serializeEssence(data));

/**
 * Whether a save is refused, and on which budget (H-811): the core grown past ESSENCE_CAP ("over"), else Brand grown past
 * BRAND_CAP ("brandover"), with the size it would have been. A save that grows neither part past its cap is never refused.
 */
export function essenceSaveRefusal(current: EssenceData, next: EssenceData): { error: "over" | "brandover"; chars: number } | null {
  const core = coreChars(next);
  if (core > ESSENCE_CAP && core > coreChars(current)) return { error: "over", chars: core };
  const brand = brandChars(next);
  if (brand > BRAND_CAP && brand > brandChars(current)) return { error: "brandover", chars: brand };
  return null;
}

/** Trim to fit: each filled core section's share of the size, largest first. Brand has its own list (brandFieldSizes). */
export function sectionSizes(data: EssenceData): { key: string; title: string; chars: number }[] {
  const clean = normalizeEssence(data);
  return ESSENCE_SECTIONS.filter((s) => clean[s.key] && s.key !== BRAND_SECTION)
    .map((s) => ({ key: s.key, title: s.title, chars: essenceChars({ [s.key]: clean[s.key] } as EssenceData) }))
    .sort((a, b) => b.chars - a.chars);
}

/** Brand's trim to fit (H-811): each filled Brand field's share of Brand's size, largest first. */
export function brandFieldSizes(data: EssenceData): { key: string; label: string; chars: number }[] {
  const brand = normalizeEssence(data)[BRAND_SECTION] ?? {};
  const fields = sectionByKey(BRAND_SECTION)?.fields ?? [];
  return fields
    .filter((f) => brand[f.key] !== undefined)
    .map((f) => ({ key: f.key, label: f.label, chars: JSON.stringify({ [f.key]: brand[f.key] }).length }))
    .sort((a, b) => b.chars - a.chars);
}

/** A rough token count for the cost display: about four characters a token. */
export const roughTokens = (chars: number) => Math.ceil(chars / 4);

export type SystemBlock = { text: string; cached: boolean };
/**
 * Voice first, task second: the one way a system message is built. The Essence block is marked for prompt caching (it is
 * the same prefix on every call); the task instruction follows uncached. With no Essence the task stands alone. The member's
 * spelling (H-811) closes the task block as one line when it isn't American, with or without an Essence, so the cached
 * prefix stays the same.
 */
export function assembleSystem(essence: string | null, task: string, opts: { spelling?: Spelling | null } = {}): { blocks: SystemBlock[]; text: string } {
  const blocks: SystemBlock[] = [];
  if (essence) {
    // `inspirations` is attribution material: it says who to credit when an idea is theirs, never who to sound like.
    const credit = /"inspirations"/.test(essence) ? " The inspirations listed name who to credit where an idea is theirs; they are never a voice to imitate." : "";
    blocks.push({ text: `This is the voice you write in. It is the client's own brand voice, as JSON; follow it in every line you produce.${credit}\n${essence}`, cached: true });
  }
  const spelling = spellingLine(opts.spelling);
  blocks.push({ text: spelling ? `${task}\n\n${spelling}` : task, cached: false });
  return { blocks, text: blocks.map((b) => b.text).join("\n\n") };
}
