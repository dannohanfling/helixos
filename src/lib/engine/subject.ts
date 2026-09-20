/**
 * The subject: whose material generated content is built from. Today the only reachable subject is the workspace owner; the
 * later toggle swaps it to a client record. Everything that resolves for a subject (what still exists, what the brand is,
 * who presents) goes through here, so a new kind of reference is one line and cannot be forgotten. Pure.
 */
import type { KnownRefs } from "./webinar";

export type SubjectKind = "workspace" | "client_record";

/** Every id a webinar may point at and still count. One builder for every check that reads an id. */
export function knownReferences(input: { proofs: { id: string; status: string }[]; stories: { id: string }[]; essenceStories: { name?: string; summary?: string }[]; citable: { id: string; source: "own" | "shared" }[]; offers: { id: string }[] }): KnownRefs {
  return {
    proofIds: input.proofs.filter((p) => p.status === "approved").map((p) => p.id),
    storyIds: [...input.stories.map((s) => s.id), ...input.essenceStories.filter((st) => st.name || st.summary).map((_, i) => `essence:${i}`)],
    evidenceIds: input.citable.map((e) => (e.source === "shared" ? `shared:${e.id}` : e.id)),
    offerIds: input.offers.map((o) => o.id),
  };
}

/** The name a script introduces, when it is not the presenter's: "I'm Danno Hanfling" in Lindsey's webinar. */
export function nameMismatch(script: string | null | undefined, presenter: string, aliases: string[] = []): { found: string; presenter: string } | null {
  const text = script ?? "";
  const first = presenter.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!first) return null;
  // A permitted name ("Turas here") opens a script without a warning; it is never reported as the presenter.
  const allowed = new Set(aliases.map((a) => a.trim().split(/\s+/)[0]?.toLowerCase()).filter(Boolean));
  // "I'm Danno", "I'm Danno Hanfling", "My name is Kate Amos", and "Danno here," at the start of a sentence.
  const re = /(?:\b(?:I'm|I’m|I am|My name is|My name's)\s+|(?:^|[.!?]\s+))([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)?)(?=\s+here\b|[\s.,;:!?]|$)/gu;
  const skip = new Set(["not", "going", "here", "sure", "just", "also", "still", "very", "the", "so", "only", "now", "really", "about", "always", "never", "sorry", "glad", "happy", "done", "back", "right", "over", "look", "come", "stay", "start", "from", "this", "that", "what", "when", "where", "which", "there", "then", "and", "but", "yes", "okay", "well", "welcome", "hello", "thanks", "thank", "let's", "lets", "today", "tonight", "first", "second", "next", "one", "two", "three"]);
  for (const m of text.matchAll(re)) {
    const introduced = m[0].startsWith("I") || m[0].startsWith("My");
    // A bare capitalised word at a sentence start counts only as "<Name> here"
    if (!introduced && !/\s+here\b/.test(text.slice(m.index! + m[0].length, m.index! + m[0].length + 8))) continue;
    const found = m[1].replace(/[.,;:!?]$/, "");
    const word = found.split(/\s+/)[0].toLowerCase();
    if (skip.has(word) || allowed.has(word)) continue;
    if (word !== first) return { found, presenter: presenter.trim() };
  }
  return null;
}

/** Numbers the record knows, put into coaching copy where the copy carries a slot for them: {runtime}, {openingMinutes}. */
export function fillRuntime(text: string, n: { runtime: number; openingMinutes: number }): string {
  return text.replace(/\{runtime\}/g, String(n.runtime)).replace(/\{openingMinutes\}/g, String(n.openingMinutes));
}

/* ───────────── Brand kit ───────────── */

export type BrandKitInput = { name: string; ground: string; ink: string; accent: string; muted: string; surface: string; inverseGround?: string | null; inverseInk?: string | null; displayFont: string; bodyFont: string; quoteFont?: string | null; fontFallback: string; bannedColors: string[]; placeholder?: string | null };
export const BRAND_COLOR_ROLES = ["ground", "ink", "accent", "muted", "surface"] as const;
/** The contrast a headline needs against its ground before the kit is accepted. */
export const MIN_CONTRAST = 4.5;

export const normaliseHex = (v: string | null | undefined): string => (v ?? "").trim().replace(/^#/, "").toUpperCase();
export const isHex = (v: string): boolean => /^[0-9A-F]{6}$/.test(v);

function luminance(hex: string): number {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** WCAG contrast ratio between two six-digit hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(normaliseHex(a));
  const lb = luminance(normaliseHex(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Why a kit cannot be saved as given: each a sentence naming the field. Empty means it can. */
export function brandKitProblems(kit: BrandKitInput): string[] {
  const out: string[] = [];
  if (!kit.name.trim()) out.push("Give the kit a name.");
  for (const role of BRAND_COLOR_ROLES) if (!isHex(normaliseHex(kit[role]))) out.push(`${role} needs a six-digit hex colour, like 6E6256.`);
  for (const role of ["inverseGround", "inverseInk"] as const) {
    const v = normaliseHex(kit[role]);
    if (v && !isHex(v)) out.push(`${role} needs a six-digit hex colour, or leave it empty.`);
  }
  if (!kit.displayFont.trim() || !kit.bodyFont.trim()) out.push("Name the display face and the body face.");
  if (!kit.fontFallback.trim()) out.push("Name the fallback face: it is what the file names when a brand face is missing on the reader's machine.");
  const banned = kit.bannedColors.map(normaliseHex).filter(isHex);
  if (out.length) return out;
  // The rule: accent draws rules and fills, never letters; anything with letters in it is ink or muted, and both are refused
  // under 4.5:1. So the text pairs are refused here (ink and muted on ground, inverseInk on inverseGround) and the accent pairs
  // only warn (brandKitWarnings). The deck's render plan keeps the same line: no text box is ever coloured accent.
  const ratio = contrastRatio(kit.ground, kit.ink);
  if (ratio < MIN_CONTRAST) out.push(`ink on ground is ${ratio}:1; it needs ${MIN_CONTRAST}:1 to read on a slide.`);
  const mutedRatio = contrastRatio(kit.ground, kit.muted);
  if (mutedRatio < MIN_CONTRAST) out.push(`muted on ground is ${mutedRatio}:1; it needs ${MIN_CONTRAST}:1 to read on a slide.`);
  const inverse = normaliseHex(kit.inverseGround) && normaliseHex(kit.inverseInk) ? contrastRatio(kit.inverseGround!, kit.inverseInk!) : null;
  if (inverse !== null && inverse < MIN_CONTRAST) out.push(`inverseInk on inverseGround is ${inverse}:1; it needs ${MIN_CONTRAST}:1.`);
  for (const role of [...BRAND_COLOR_ROLES, "inverseGround", "inverseInk", "placeholder"] as const) {
    const v = normaliseHex(kit[role]);
    if (v && banned.includes(v)) out.push(`${role} is ${v}, which this brand bans.`);
  }
  // The placeholder colour is a fill under ink, so it is a text pair like the others.
  const placeholder = normaliseHex(kit.placeholder);
  if (placeholder && !isHex(placeholder)) out.push("placeholder needs a six-digit hex colour, or leave it empty.");
  else if (placeholder && contrastRatio(placeholder, kit.ink) < MIN_CONTRAST) out.push(`ink on placeholder is ${contrastRatio(placeholder, kit.ink)}:1; it needs ${MIN_CONTRAST}:1, or the unfilled slot cannot be read.`);
  return out;
}

/**
 * The accent pairs, said beside a saved kit rather than refused: an accent is a word or a rule more often than a paragraph,
 * and a brand may accept a lower ratio for it on purpose. Under 4.5:1 is named so nobody discovers it on screen.
 */
export function brandKitWarnings(kit: Pick<BrandKitInput, "ground" | "accent" | "inverseGround">): string[] {
  const out: string[] = [];
  const onGround = contrastRatio(kit.ground, kit.accent);
  if (onGround < MIN_CONTRAST) out.push(`accent on ground is ${onGround}:1: fine for a rule or a large word, under ${MIN_CONTRAST}:1 for text.`);
  if (normaliseHex(kit.inverseGround)) {
    const onInverse = contrastRatio(kit.inverseGround!, kit.accent);
    if (onInverse < MIN_CONTRAST) out.push(`accent on inverseGround is ${onInverse}:1: not for text on a full-bleed slide.`);
  }
  return out;
}
