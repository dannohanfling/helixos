/**
 * Lifting the Ask Danno bubble clear of the phone's bottom bar (rev 468). The bubble is Community Loyalty's floating launcher,
 * drawn by its own script; HelixOS can't style it by name (its markup isn't ours to rely on), so it is found by where it sits:
 * a small fixed box at the bottom of a phone screen. Pure: the browser side measures, this decides.
 */
export const PHONE_MAX_WIDTH = 767;
export const LIFT_GAP = 12;

export type Box = { top: number; bottom: number; width: number; height: number };

/** A launcher: fixed, small (a bubble, maybe with its greeting), and sitting in the bottom band of the screen. The opened chat is never one. */
export function isLauncher(box: Box, viewport: { width: number; height: number }, fixed: boolean): boolean {
  if (!fixed || box.height <= 0 || box.width <= 0) return false;
  return box.height <= 240 && box.width <= Math.min(viewport.width - 24, 420) && box.bottom >= viewport.height - 120;
}

/** Still small enough to keep lifted: the launcher once lifted sits higher, so only its size decides; grown into the chat, it goes back. */
export const staysLifted = (box: Box): boolean => box.height > 0 && box.height <= 240;

/**
 * How far above the screen's bottom edge the launcher's bottom goes: clear of the highest of HelixOS's own bottom bars (the
 * tab bar, a sticky row of buttons) that sit in the lower half of the screen, plus a small gap. Null when there is nothing to clear.
 */
export function liftPx(viewportHeight: number, barTops: number[], gap = LIFT_GAP): number | null {
  const tops = barTops.filter((t) => t > viewportHeight / 2 && t < viewportHeight);
  if (!tops.length) return null;
  return Math.round(viewportHeight - Math.min(...tops) + gap);
}
