/**
 * Make the graphic (rev 513, amended by revs 514, 515 and 524): the ladder's headline on the member's own photo, in the
 * template Danno approved. Pure: the template's numbers, the headline fit, the gold phrase, the photo match and the words.
 * The rendering itself is src/lib/graphic-render.tsx; nothing here reads a file or the database.
 */
import antonMetrics from "@/fonts/anton-advances.json";
import { headlineParts } from "./ladder";

/** The template at 1× (1080×1350) and the master at 2× (rev 514: the one file stored). */
export const GRAPHIC = {
  width: 1080,
  height: 1350,
  scale: 2,
  photoHeight: 1060,
  photoFocus: "50% 20%",
  fadeTop: 520,
  fadeHeight: 560,
  /** The headline's bottom edge, this far above the canvas bottom. */
  headlineBottom: 290,
  headlineMaxPx: 104,
  headlineMinPx: 48,
  headlineStepPx: 2,
  headlineMaxWidth: 1000,
  lineHeight: 1.04,
  readTop: 1088,
  readPx: 34,
  badgeTop: 1170,
  avatarPx: 72,
  namePx: 28,
  handlePx: 24,
} as const;
export const MASTER_WIDTH = GRAPHIC.width * GRAPHIC.scale;
export const MASTER_HEIGHT = GRAPHIC.height * GRAPHIC.scale;
/** Danno's Canva gold, left to right (rev 513); a member's kit may carry its own two stops. */
export const GOLD_STOPS = ["#dda338", "#d89c3c", "#e7be62", "#c5801f"] as const;
export const READ_COMMENTS = "(READ COMMENTS ";
/** The fade over the photo's lower half; "stronger" for bright or busy photos, where a banner's text showed through in a test. */
export const FADE = "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.92) 80%, #000 100%)";
export const FADE_STRONG = "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.75) 35%, rgba(0,0,0,0.97) 70%, #000 100%)";
export const FACEBOOK_NOTE = "Facebook compresses on upload; the 2× file stays sharper.";
export const ANTHROPIC_NO_IMAGES = "Your AI key is Anthropic's, which makes no images. Backgrounds come from your own photos, or add an OpenAI key in Settings → AI.";

/** The gold gradient as CSS, from the kit's two stops when it has them, else Danno's four. */
export function goldGradient(from?: string | null, to?: string | null): string {
  const a = hex(from);
  const b = hex(to);
  return a && b ? `linear-gradient(90deg, ${a}, ${b})` : `linear-gradient(90deg, ${GOLD_STOPS.join(", ")})`;
}
const hex = (v?: string | null): string | null => (v && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? `#${v.trim().replace("#", "")}` : null);

type Metrics = { unitsPerEm: number; advances: Record<string, number>; kerning: Record<string, number> };
const METRICS = antonMetrics as Metrics;
/** The width of a line set in Anton at one pixel size, from the font's own advances (kerning for capitals), 2% slack for the rest. */
export function antonWidth(text: string, px: number, m: Metrics = METRICS): number {
  let w = 0;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    w += m.advances[c] ?? m.advances[c.toUpperCase()] ?? m.advances["M"] ?? 0.6;
    const pair = m.kerning[`${c}${chars[i + 1] ?? ""}`];
    if (pair) w += pair;
  }
  return w * px * 1.02;
}
/** The one size both lines fit at: from the template's largest, down by its step, to its smallest. */
export function fitHeadline(lines: readonly string[], maxWidth = GRAPHIC.headlineMaxWidth, m: Metrics = METRICS): number {
  for (let px = GRAPHIC.headlineMaxPx; px > GRAPHIC.headlineMinPx; px -= GRAPHIC.headlineStepPx) if (lines.every((l) => antonWidth(l.toUpperCase(), px, m) <= maxWidth)) return px;
  return GRAPHIC.headlineMinPx;
}

export type Segment = { text: string; gold: boolean };
/** A line as the template paints it: the one gold phrase marked, the rest white, in capitals. */
export function paintLine(line: string, gold: string | undefined): Segment[] {
  const up = line.toUpperCase();
  const g = (gold ?? "").toUpperCase().trim();
  const at = g ? up.indexOf(g) : -1;
  if (at < 0) return [{ text: up, gold: false }];
  return [{ text: up.slice(0, at), gold: false }, { text: up.slice(at, at + g.length), gold: true }, { text: up.slice(at + g.length), gold: false }].filter((s) => s.text.length);
}
/** The headline's two lines, painted, and the size they fit at. A one-line headline is split at its middle word. */
export function layoutHeadline(headline: string): { lines: Segment[][]; px: number } {
  const h = headlineParts(headline);
  let lines = h.lines.slice(0, 2);
  if (lines.length === 1) {
    const words = lines[0].split(/\s+/).filter(Boolean);
    if (words.length >= 4) { const half = Math.ceil(words.length / 2); lines = [words.slice(0, half).join(" "), words.slice(half).join(" ")]; }
  }
  if (!lines.length) lines = [" "];
  return { lines: lines.map((l) => paintLine(l, h.gold[0])), px: fitHeadline(lines) };
}

/** The Images entry's caption: the headline's plain words (rev 514: caption = the headline). */
export const graphicCaption = (headline: string): string => headlineParts(headline).text.replace(/\s*\/\s*/g, " ").trim().slice(0, 200);

export type PhotoCandidate = { id: string; kind: string; caption: string | null; width: number; height: number; createdAt: string; source?: string };
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "i", "it", "is", "my", "your", "you", "if", "all", "at", "by", "with", "this", "that", "from", "one", "day"]);
const wordsOf = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
/**
 * The best photo for a headline (rev 513): a photo of the member's own whose caption shares the headline's words, photos before
 * other kinds, portrait before landscape (the frame is 1080 wide by 1060 tall), newest last of all. Proof and screenshot
 * images never: they carry someone's details. Null with nothing to choose from.
 */
export function pickPhoto(headline: string, images: readonly PhotoCandidate[]): PhotoCandidate | null {
  const words = new Set(wordsOf(headlineParts(headline).text));
  const usable = images.filter((i) => i.kind === "photo" || i.kind === "graphic" && i.source !== "render" || i.kind === "diagram");
  if (!usable.length) return null;
  const score = (i: PhotoCandidate): number => {
    const shared = wordsOf(i.caption ?? "").filter((w) => words.has(w)).length;
    const portrait = i.height >= i.width ? 1 : 0;
    const photo = i.kind === "photo" ? 2 : 0;
    const ai = i.source === "ai" ? -1 : 0;
    return shared * 10 + photo + portrait + ai;
  };
  return [...usable].sort((a, b) => score(b) - score(a) || b.createdAt.localeCompare(a.createdAt))[0];
}
/** A member's images that could sit under a headline, for the picker: the same set pickPhoto chooses from, the suggestion first. */
export function photoChoices(headline: string, images: readonly PhotoCandidate[]): PhotoCandidate[] {
  const best = pickPhoto(headline, images);
  const rest = images.filter((i) => (i.kind === "photo" || (i.kind === "graphic" && i.source !== "render") || i.kind === "diagram") && i.id !== best?.id);
  return best ? [best, ...rest] : rest;
}

/** The scene an AI background is asked for (rev 524): a place, no people, no text, no logos; from the headline's words. */
export function backgroundPrompt(headline: string, topic: string): string {
  const words = graphicCaption(headline) || topic;
  return `A cinematic background photograph for a social post about: ${words}. A real-looking place or scene (a stage, a gym, a desk at night, a city street, a kitchen, a field), moody light, dark lower half. No people, no faces, no hands, no text, no letters, no logos, no watermarks. Portrait, 4:5.`;
}
/** Whether a member's AI key can make a background: OpenAI's can; Anthropic's makes no images (rev 524, said plainly on the step). */
export const canGenerateBackground = (provider: string | null | undefined): boolean => provider === "openai";

/** The headline choices for a remake: the ladder's, then its alternates, each once. */
export function headlineChoices(headline: string, alternates: readonly string[]): string[] {
  const out: string[] = [];
  for (const h of [headline, ...alternates]) { const t = h.trim(); if (t && !out.includes(t)) out.push(t); }
  return out;
}
