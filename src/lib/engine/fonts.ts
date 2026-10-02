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

/** The one line shown under a licensed face: who will not see it, and what they see instead (§4.3, §6.1). */
export const otherFontLine = (fallback: string): string => `People without this font installed will see ${fallback.trim() || "Arial"}.`;
