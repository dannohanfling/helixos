/**
 * The kit as the file's theme (deck visuals brief §6.6). pptxgenjs writes every colour and face as a literal on each run and
 * shape and has no theme colour API, so after the file is written the zip is rewritten: the theme's colour scheme takes the
 * kit's colours (ink as dk1, ground as lt1, muted as dk2, surface as lt2, accent as accent1, the inverse pair as accent2 and
 * accent3, the placeholder fill as accent4), the theme's fonts take the kit's display and body faces, and in every slide,
 * layout and master the kit's literal colours become scheme colours and the kit's faces become the theme faces. A reader who
 * changes the accent in the theme then sees every rule follow, with no per-slide edit. The fixed placeholder red (§2) stays
 * literal: it is never the brand's. A hex two roles share maps to the first role's slot, in the order above.
 */
import JSZip from "jszip";
import { PLACEHOLDER_RED } from "@/lib/engine/deck";
import { normaliseHex } from "@/lib/engine/subject";

export type ThemeKit = { ground: string; ink: string; accent: string; muted: string; surface: string; inverseGround?: string | null; inverseInk?: string | null; placeholder?: string | null; displayFont: string; bodyFont: string };
export type SchemeSlot = "dk1" | "lt1" | "dk2" | "lt2" | "accent1" | "accent2" | "accent3" | "accent4";

/** Which scheme slot each of the kit's colours takes, and the colour the slot is set to. Pure, so a test can read it. */
export function schemeMap(kit: ThemeKit): { slots: Record<SchemeSlot, string>; byHex: Map<string, SchemeSlot> } {
  const roles: [SchemeSlot, string | null | undefined][] = [
    ["dk1", kit.ink],
    ["lt1", kit.ground],
    ["accent1", kit.accent],
    ["dk2", kit.muted],
    ["lt2", kit.surface],
    ["accent2", kit.inverseGround],
    ["accent3", kit.inverseInk],
    ["accent4", kit.placeholder],
  ];
  const slots = { dk1: "", lt1: "", dk2: "", lt2: "", accent1: "", accent2: "", accent3: "", accent4: "" } as Record<SchemeSlot, string>;
  const byHex = new Map<string, SchemeSlot>();
  for (const [slot, raw] of roles) {
    const hex = normaliseHex(raw);
    if (!/^[0-9A-F]{6}$/.test(hex) || hex === PLACEHOLDER_RED) continue;
    slots[slot] = hex;
    if (!byHex.has(hex)) byHex.set(hex, slot);
  }
  // A slot with no colour of its own keeps a sensible one, so the scheme is whole: the inverse pair falls to accent and ink, the placeholder fill to surface.
  slots.accent2 ||= slots.accent1;
  slots.accent3 ||= slots.dk1;
  slots.accent4 ||= slots.lt2;
  return { slots, byHex };
}

/** The colour scheme and font scheme XML the theme takes. */
export function themeXmlFor(theme: string, kit: ThemeKit): string {
  const { slots } = schemeMap(kit);
  const clr = (slot: SchemeSlot) => `<a:${slot}><a:srgbClr val="${slots[slot]}"/></a:${slot}>`;
  let out = theme;
  for (const slot of ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4"] as const) {
    if (!slots[slot]) continue;
    out = out.replace(new RegExp(`<a:${slot}>[\\s\\S]*?</a:${slot}>`), clr(slot));
  }
  const face = (f: string) => f.replace(/[<>&"]/g, "");
  out = out.replace(/(<a:majorFont>\s*<a:latin typeface=")[^"]*(")/, `$1${face(kit.displayFont)}$2`).replace(/(<a:minorFont>\s*<a:latin typeface=")[^"]*(")/, `$1${face(kit.bodyFont)}$2`);
  return out;
}

/** One slide's, layout's or master's XML with the kit's literal colours and faces turned into the theme's. */
export function slideXmlThemed(xml: string, kit: ThemeKit): string {
  const { byHex } = schemeMap(kit);
  let out = xml;
  for (const [hex, slot] of byHex) out = out.split(`<a:srgbClr val="${hex}"/>`).join(`<a:schemeClr val="${slot}"/>`);
  // A colour with children (an alpha, a shade) keeps its wrapper and swaps the element: the children stay.
  for (const [hex, slot] of byHex) out = out.split(`<a:srgbClr val="${hex}">`).join(`<a:schemeClr val="${slot}">`);
  const faces: [string, string][] = [
    [kit.displayFont, "+mj-lt"],
    [kit.bodyFont, "+mn-lt"],
  ];
  for (const [f, theme] of faces) {
    if (!f.trim() || f === kit.displayFont && theme === "+mn-lt") continue;
    out = out.split(`<a:latin typeface="${f}"`).join(`<a:latin typeface="${theme}"`);
  }
  return out;
}

/** The whole file, themed. Slides, layouts and masters are rewritten; everything else is left as written. */
export async function applyKitTheme(pptx: Buffer, kit: ThemeKit): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptx);
  const theme = zip.file("ppt/theme/theme1.xml");
  if (theme) zip.file("ppt/theme/theme1.xml", themeXmlFor(await theme.async("string"), kit));
  const parts = Object.keys(zip.files).filter((f) => /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(f));
  for (const name of parts) zip.file(name, slideXmlThemed(await zip.file(name)!.async("string"), kit));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
