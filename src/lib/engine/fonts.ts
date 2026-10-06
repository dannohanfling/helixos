/**
 * The faces a brand kit can pick from (deck visuals brief §6.1). Nothing here is bundled with the app: the deck file names a
 * face and the reader's machine supplies it, so the list is faces most machines carry (the safe set) and Google faces a coach
 * is likely to have installed from their brand work. A face outside the list is "Other (licensed font)", typed by name, and the
 * kit's fallback face is what a reader without it sees. Pure.
 */

/** Faces installed on most machines: the only sensible fallbacks, and fine as brand faces too. */
export const SAFE_FONTS = ["Arial", "Helvetica", "Calibri", "Georgia", "Times New Roman", "Verdana", "Trebuchet MS", "Tahoma"] as const;

/** Google faces, free to install, in the order a coach is likely to look for them. */
export const GOOGLE_FONTS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Raleway", "Nunito", "Work Sans", "DM Sans", "Source Sans 3",
  "Manrope", "Outfit", "Josefin Sans", "Red Hat Display", "Space Grotesk", "Oswald", "Bebas Neue",
  "Playfair Display", "Lora", "Merriweather", "Libre Baskerville", "Cormorant Garamond", "EB Garamond",
] as const;

/** The dropdown, in order: the safe faces, then the Google faces. */
export const DECK_FONTS: readonly string[] = [...SAFE_FONTS, ...GOOGLE_FONTS];

/** The value the dropdown posts for a face outside the list; the typed name travels in its own field. */
export const OTHER_FONT = "__other";

export const isListedFont = (face: string): boolean => DECK_FONTS.includes(face.trim());

/** Google faces that come in one weight only: asking for a bold one would make Google refuse the whole stylesheet. */
const ONE_WEIGHT = new Set(["Bebas Neue"]);
/**
 * The stylesheet that loads one listed Google face in the browser (first-deck §6: the Deck step's thumbnails drew Playfair
 * Display as a fallback sans, so the client saw a different deck from the one they download). One stylesheet per face, so a
 * face Google cannot serve costs only itself. Null for a safe face (already on the machine) or a licensed one, which the
 * preview keeps drawing in the fallback, as a reader without it sees.
 */
export function googleFontHref(face: string): string | null {
  const name = face.trim();
  if (!(GOOGLE_FONTS as readonly string[]).includes(name)) return null;
  return `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}${ONE_WEIGHT.has(name) ? "" : ":wght@400;700"}&display=swap`;
}

/** The one line shown under a licensed face: who will not see it, and what they see instead (§4.3, §6.1). */
export const otherFontLine = (fallback: string): string => `People without this font installed will see ${fallback.trim() || "Arial"}.`;
