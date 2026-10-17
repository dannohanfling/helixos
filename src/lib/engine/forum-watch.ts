/**
 * The stall watch (H-495): which agents have stopped checking in. No heartbeat of its own: it reads the times HelixOS already
 * keeps (the last report, the last call through the agent's own connection, the last scheduled check-in). Pure, so the cron,
 * the Forum page and the tests all ask the same question.
 *
 * - Check-ins on: stalled after 3 of its intervals and at least 15 minutes of silence, counting only time inside its own
 *   active hours and days.
 * - Check-ins off, or outside its active hours: stalled only while it says it is working and nothing has come for 60 minutes.
 * - Never watched: a built-in, an agent with no token of its own, an agent the owner muted, an agent never heard from.
 */
export const STALL_INTERVALS = 3;
export const STALL_MIN_MINUTES = 15;
export const STALL_WORKING_MINUTES = 60;
/** How far back the active-minute count looks: a longer silence is a stall already, or a holiday the owner can mute. */
const SCAN_LIMIT_MINUTES = 14 * 24 * 60;
const MINUTE = 60_000;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type ActiveHours = { from: string; to: string; days: number[]; tz: string };
export type WatchAgent = {
  builtIn: boolean;
  hasToken: boolean;
  muted: boolean;
  /** The status the Forum shows now (an automatic light already settled). */
  status: string;
  /** The last sign of life, as an ISO instant; null when it has never reported, called or checked in. */
  heardAt: string | null;
  /** Its scheduled check-ins, or null when it has none set up. */
  checkins: (ActiveHours & { on: boolean; everyMinutes: number }) | null;
  /** The owner's Pause all: every check-in answers quiet, so none are missed. */
  paused: boolean;
};
export type StallRule = "checkins" | "working";

export const watched = (a: Pick<WatchAgent, "builtIn" | "hasToken" | "muted">): boolean => !a.builtIn && a.hasToken && !a.muted;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat | null {
  if (formatters.has(tz)) return formatters.get(tz)!;
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(tz, f);
    return f;
  } catch {
    return null;
  }
}

/** Whether an instant falls inside the hours: its days of the week and its from-to window, in its own zone. */
export function isActiveAt(ms: number, h: ActiveHours): boolean {
  const f = formatterFor(h.tz);
  if (!f) return false;
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = DAY_NAMES.indexOf(get("weekday") as (typeof DAY_NAMES)[number]);
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const at = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return h.days.includes(day) && minutes >= at(h.from) && minutes < at(h.to);
}

/** Whole minutes inside the active hours between two instants, counted up to `cap` (enough to answer "at least cap?"). */
export function activeMinutesBetween(fromMs: number, toMs: number, h: ActiveHours, cap: number): number {
  let count = 0;
  const start = Math.max(fromMs, toMs - SCAN_LIMIT_MINUTES * MINUTE);
  for (let t = start; t + MINUTE <= toMs && count < cap; t += MINUTE) if (isActiveAt(t, h)) count++;
  return count;
}

/** The silence an agent with check-ins on may keep before it counts as stalled, in active minutes. */
export const allowedSilence = (everyMinutes: number): number => Math.max(STALL_INTERVALS * Math.max(1, everyMinutes), STALL_MIN_MINUTES);

/** Whether this agent has stopped checking in, and by which rule; null when it hasn't. */
export function stallFor(a: WatchAgent, now: Date): StallRule | null {
  if (!watched(a) || !a.heardAt) return null;
  const heard = Date.parse(a.heardAt);
  if (!Number.isFinite(heard)) return null;
  const silentMinutes = (now.getTime() - heard) / MINUTE;
  if (silentMinutes < STALL_MIN_MINUTES) return null;
  const scheduled = a.checkins?.on && !a.paused ? a.checkins : null;
  if (scheduled) {
    const allowed = allowedSilence(scheduled.everyMinutes);
    if (activeMinutesBetween(heard, now.getTime(), scheduled, allowed) >= allowed) return "checkins";
    // Inside its hours its own schedule decides; outside them, an agent left working is still caught.
    if (isActiveAt(now.getTime(), scheduled)) return null;
  }
  return a.status === "working" && silentMinutes >= STALL_WORKING_MINUTES ? "working" : null;
}

/** The latest of the stamps (database or ISO), as an ISO instant, or null. */
export function latestStamp(stamps: (string | null | undefined)[]): string | null {
  let best: number | null = null;
  for (const s of stamps) {
    if (!s) continue;
    const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(" ", "T")}Z` : s);
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** The words (H-495): the card's line, the What needs you item, the log lines and the email, with the time in the owner's zone. */
export const stallWords = {
  card: (time: string) => `Stopped checking in at ${time}. Usually the usage limit, or the session closed.`,
  need: (name: string, time: string) => `${name} stopped at ${time}. Open its session, switch the model if it's at its limit, and ask it to continue.`,
  stopped: (time: string) => `stopped checking in at ${time}`,
  back: (time: string) => `back at ${time}`,
  emailSubject: (name: string) => `${name} stopped checking in`,
};
