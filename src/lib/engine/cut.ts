/**
 * Cutting text to a length without breaking it (H-593). JavaScript counts a string in UTF-16 units, and an emoji takes two,
 * so a plain slice can keep half of one. The database refuses half an emoji, so a post could be saved and still fail after.
 */

/** Removes any half of an emoji: a lone surrogate, wherever it is. */
export function wellFormed(s: string): string {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** At most `max` UTF-16 units, never ending on half an emoji. */
export function cutText(s: string, max: number): string {
  if (s.length <= max) return wellFormed(s);
  const end = /[\uD800-\uDBFF]/.test(s.charAt(max - 1)) ? max - 1 : max;
  return wellFormed(s.slice(0, Math.max(0, end)));
}
