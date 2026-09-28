/**
 * The Essence System, pure: the fourteen sections of a client's brand voice (and the optional Brand), how they serialise into the block that leads
 * every AI system message, and the completion the wizard shows. Every word inside an Essence is the client's; this file
 * holds structure only. "Brand voice should be a config file, not a vibe."
 */
import helpJson from "@/data/essence-help.json";
import placeholdersJson from "@/data/essence-placeholders.json";

export type FieldKind = "text" | "list" | "stories";
export type EssenceField = { key: string; label: string; kind: FieldKind };
/** optional: not counted in completion until it holds something (Brand, 27 Sep), so adding it lowers no one's progress. */
export type EssenceSection = { key: string; title: string; fields: EssenceField[]; optional?: boolean };
export type Story = { name: string; summary: string; when_to_use: string };
export type EssenceData = Record<string, Record<string, string | string[] | Story[]>>;

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
  { key: "key_outcomes_for_users", title: "Key outcomes for users", fields: [t("clarity"), t("impact"), t("connection")] },
  { key: "ethical_standards", title: "Ethical standards", fields: [t("transparency"), t("inclusivity"), t("empowerment")] },
  { key: "representative_stories", title: "Representative stories", fields: [{ key: "stories", label: "Stories", kind: "stories" }] },
];
export const sectionByKey = (key: string) => ESSENCE_SECTIONS.find((s) => s.key === key);
const STORIES_SECTION = "representative_stories";
const STORIES_FIELD = "stories";

/** The platform limit the production Essence lives under; matching it keeps the app's Essence portable to the bot. */
export const ESSENCE_CAP = 20000;

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

const cleanList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" ? v.split("\n").map((x) => x.trim()).filter(Boolean) : []);
const cleanStories = (v: unknown): Story[] =>
  Array.isArray(v)
    ? v
        .map((x) => (x && typeof x === "object" ? { name: String((x as Story).name ?? "").trim(), summary: String((x as Story).summary ?? "").trim(), when_to_use: String((x as Story).when_to_use ?? "").trim() } : null))
        .filter((x): x is Story => Boolean(x && (x.name || x.summary || x.when_to_use)))
    : [];

/** Only known sections and fields survive, each in its declared shape; nothing is added, nothing is invented. */
export function normalizeEssence(input: unknown): EssenceData {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: EssenceData = {};
  for (const section of ESSENCE_SECTIONS) {
    const given = src[section.key];
    // The production schema carries representative_stories as a bare array; stored rows carry it under "stories". Both are read.
    const raw = (Array.isArray(given) && section.key === STORIES_SECTION ? { [STORIES_FIELD]: given } : given && typeof given === "object" ? given : {}) as Record<string, unknown>;
    const sec: Record<string, string | string[] | Story[]> = {};
    for (const f of section.fields) {
      const v = raw[f.key];
      if (f.kind === "text") {
        const s = typeof v === "string" ? v.trim() : "";
        if (s) sec[f.key] = s;
      } else if (f.kind === "list") {
        const arr = cleanList(v);
        if (arr.length) sec[f.key] = arr;
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

/**
 * The block that leads every system message: the client's Essence as compact JSON in the production shape
 * (representative_stories as a bare array), or null when nothing is filled in.
 */
export function serializeEssence(data: EssenceData): string | null {
  const clean = normalizeEssence(data);
  if (!Object.keys(clean).length) return null;
  const shaped: Record<string, unknown> = { ...clean };
  if (clean[STORIES_SECTION]) shaped[STORIES_SECTION] = clean[STORIES_SECTION][STORIES_FIELD] ?? [];
  return JSON.stringify(shaped);
}
export const essenceChars = (data: EssenceData) => serializeEssence(data)?.length ?? 0;

/**
 * Over the cap: an Essence can arrive over it whole (an Airtable import, 28 Sep: nothing of the client's is cut silently). It
 * is kept as it is, marked, and left out of every AI call until it is trimmed under; a save that doesn't grow it is always
 * allowed, so trimming works one section at a time.
 */
export const essenceOver = (data: EssenceData): number => Math.max(0, essenceChars(data) - ESSENCE_CAP);

/** Trim to fit: each filled section's share of the size, largest first. */
export function sectionSizes(data: EssenceData): { key: string; title: string; chars: number }[] {
  const clean = normalizeEssence(data);
  return ESSENCE_SECTIONS.filter((s) => clean[s.key])
    .map((s) => ({ key: s.key, title: s.title, chars: essenceChars({ [s.key]: clean[s.key] } as EssenceData) }))
    .sort((a, b) => b.chars - a.chars);
}

/** A rough token count for the cost display: about four characters a token. */
export const roughTokens = (chars: number) => Math.ceil(chars / 4);

export type SystemBlock = { text: string; cached: boolean };
/**
 * Voice first, task second: the one way a system message is built. The Essence block is marked for prompt caching (it is
 * the same prefix on every call); the task instruction follows uncached. With no Essence the task stands alone.
 */
export function assembleSystem(essence: string | null, task: string): { blocks: SystemBlock[]; text: string } {
  const blocks: SystemBlock[] = [];
  if (essence) {
    // `inspirations` is attribution material: it says who to credit when an idea is theirs, never who to sound like.
    const credit = /"inspirations"/.test(essence) ? " The inspirations listed name who to credit where an idea is theirs; they are never a voice to imitate." : "";
    blocks.push({ text: `This is the voice you write in. It is the client's own brand voice, as JSON; follow it in every line you produce.${credit}\n${essence}`, cached: true });
  }
  blocks.push({ text: task, cached: false });
  return { blocks, text: blocks.map((b) => b.text).join("\n\n") };
}
