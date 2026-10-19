/**
 * The Join window for a weekly call (H-828), on its own so the Join button in the browser can read it without the rest of
 * src/lib/engine/calls.ts (which reaches the calendar and audience code). calls.ts re-exports both.
 */

/** Join opens this many minutes before the start. */
export const JOIN_EARLY_MINUTES = 10;
/**
 * Calls often run past the hour (Danno, H-836), so Join and "Live now" stay up until this long after the start, or until the
 * next call the reader can see starts, whichever is first. The stored length is only for the calendar file's end.
 */
export const LIVE_HOURS = 2;

export type JoinState = "later" | "soon" | "live" | "over";
/**
 * Where an occurrence stands at `now`: Join opens 10 minutes before the start ("soon"), "live" from the start until its live
 * end (two hours after the start, or the next visible call's start, whichever is first; see `callOccurrences`), then "over".
 */
export function joinState(occ: { startIso: string; liveEndIso: string }, now: Date | number = Date.now()): JoinState {
  const t = typeof now === "number" ? now : now.getTime();
  const start = new Date(occ.startIso).getTime();
  if (t >= new Date(occ.liveEndIso).getTime()) return "over";
  if (t >= start) return "live";
  if (t >= start - JOIN_EARLY_MINUTES * 60_000) return "soon";
  return "later";
}
export const canJoin = (s: JoinState): boolean => s === "soon" || s === "live";

/** "9:50 AM" in the reader's zone. */
export const clockIn = (at: Date | string, tz: string): string => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(typeof at === "string" ? new Date(at) : at);
/** When Join opens, in the reader's zone: "9:50 AM". */
export const joinOpensAt = (occ: { startIso: string }, tz: string): string => clockIn(new Date(new Date(occ.startIso).getTime() - JOIN_EARLY_MINUTES * 60_000), tz);
