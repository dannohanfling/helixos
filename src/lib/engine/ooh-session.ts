/**
 * Office Hours in each member's own time zone (H-457, plan H-469). The session is a weekday and a start time in the host's
 * zone (the workspace's), so a weekly 5 PM Pacific call stays at 5 PM Pacific for the host across a clock change, and each
 * occurrence is converted for whoever reads it: a Sydney member sees Thursday 5 PM PT as Friday morning, with Friday's date.
 * A request still keys on the host's session date (the `friday` column, named before the day could move).
 */
import { addDays, todayInTz, wallTimeToUtc, weekday, zoneName } from "@/lib/dates";

export const OOH_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const OOH_MINUTES_CHOICES = [30, 45, 60, 75, 90, 120] as const;

/** The session as the workspace sets it. `start` is the host's wall time ("17:00"), null until known. */
export type OohSchedule = { weekday: number; start: string | null; minutes: number; hostTz: string };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validStart = (s: string | null | undefined): s is string => typeof s === "string" && TIME.test(s);

/**
 * The day and time out of the coach's old free text ("Fridays at 12:00 pm", "Thursday 5pm", "17:30"), so a workspace that
 * set only the note still gets converted times. Anything unreadable gives nothing.
 */
export function parseOohTime(text: string | null | undefined): { weekday?: number; start?: string } {
  const s = (text ?? "").toLowerCase();
  const out: { weekday?: number; start?: string } = {};
  const day = OOH_DAY_NAMES.findIndex((d) => new RegExp(`\\b${d.toLowerCase()}s?\\b|\\b${d.slice(0, 3).toLowerCase()}\\b`).test(s));
  if (day >= 0) out.weekday = day;
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d:])/g);
  for (const hit of m ?? []) {
    const p = hit.match(/(\d{1,2})(?::(\d{2}))?\s*(a|p)?/);
    if (!p) continue;
    let h = Number(p[1]);
    const min = Number(p[2] ?? 0);
    const ap = p[3];
    if (!p[2] && !ap) continue; // a bare number ("the 17th", "60 minutes") is not a time
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    if (h > 23 || min > 59) continue;
    out.start = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    break;
  }
  return out;
}

/** The schedule from the workspace's columns; an unset start falls back to the old note, the weekday too while the start is unset. */
export function oohSchedule(ws: { oohWeekday: number; oohStart: string | null; oohMinutes: number; oohTime: string | null; timezone: string }): OohSchedule {
  if (validStart(ws.oohStart)) return { weekday: ws.oohWeekday, start: ws.oohStart, minutes: ws.oohMinutes, hostTz: ws.timezone };
  const read = parseOohTime(ws.oohTime);
  return { weekday: read.weekday ?? ws.oohWeekday, start: read.start ?? null, minutes: ws.oohMinutes, hostTz: ws.timezone };
}

/** "Friday" and "Fridays". */
export const dayName = (s: Pick<OohSchedule, "weekday">) => OOH_DAY_NAMES[s.weekday] ?? "Friday";
export const dayNames = (s: Pick<OohSchedule, "weekday">) => `${dayName(s)}s`;

/** The next `n` session dates in the host's zone, today's included while it is the day: the dates a request can key on. */
export function sessionDays(hostToday: string, wd: number, n = 4): string[] {
  const first = addDays(hostToday, (wd - weekday(hostToday) + 7) % 7);
  return Array.from({ length: n }, (_, i) => addDays(first, i * 7));
}

/** The session's start as an instant: the host's date and wall time read in the host's zone (DST-safe both sides). */
export function sessionStart(day: string, s: OohSchedule): Date | null {
  if (!validStart(s.start)) return null;
  const iso = wallTimeToUtc(`${day}T${s.start}`, s.hostTz);
  return iso ? new Date(iso) : null;
}

const fmt = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(d);
const dayDate = (d: Date, tz: string) => `${fmt(d, tz, { weekday: "short" })} ${fmt(d, tz, { day: "numeric" })} ${fmt(d, tz, { month: "short" })}`;
const clock = (d: Date, tz: string) => fmt(d, tz, { hour: "numeric", minute: "2-digit" });

/**
 * One session as the reader sees it: "Fri 23 Oct, 11:00 AM AEDT" in their zone, the zone's name only when asked (the first
 * time on a page). With no start time set, the host's date alone ("Fri 23 Oct"), since a day without a time can't be moved.
 */
export function sessionWhen(day: string, s: OohSchedule, viewerTz: string, opts: { zone?: boolean } = {}): string {
  const at = sessionStart(day, s);
  if (!at) return dayDate(new Date(`${day}T12:00:00Z`), "UTC");
  return `${dayDate(at, viewerTz)}, ${clock(at, viewerTz)}${opts.zone ? ` ${zoneName(viewerTz, at)}` : ""}`;
}

/** The longer heading form: "Friday, October 23, 11:00 AM AEDT" in the reader's zone, or the host's date alone. */
export function sessionHeading(day: string, s: OohSchedule, viewerTz: string): string {
  const at = sessionStart(day, s);
  if (!at) return fmt(new Date(`${day}T12:00:00Z`), "UTC", { weekday: "long", month: "long", day: "numeric" });
  return `${fmt(at, viewerTz, { weekday: "long", month: "long", day: "numeric" })}, ${clock(at, viewerTz)} ${zoneName(viewerTz, at)}`;
}

/**
 * For the coach: the member's time and the host's side by side, "Fri 11:00 AM AEDT · Thu 5:00 PM PT". One time when the two
 * read the same; null with no start time.
 */
export function sessionBoth(day: string, s: OohSchedule, memberTz: string): string | null {
  const at = sessionStart(day, s);
  if (!at) return null;
  const one = (tz: string) => `${fmt(at, tz, { weekday: "short" })} ${clock(at, tz)} ${zoneName(tz, at)}`;
  const member = one(memberTz);
  const host = one(s.hostTz);
  return member === host ? host : `${member} · ${host}`;
}

/** The host's calendar day now: the day session dates are counted from, whoever is reading. */
export const hostToday = (s: Pick<OohSchedule, "hostTz">, now: Date = new Date()): string => todayInTz(s.hostTz, now);

/** The coach's three fields as saved, or why not: a weekday 0 to 6, a start "HH:MM" or blank, a length from the list. */
export function readOohSession(raw: { weekday: string; start: string; minutes: string }): { value: { oohWeekday: number; oohStart: string | null; oohMinutes: number } } | { error: string } {
  const wd = raw.weekday.trim() === "" ? NaN : Number(raw.weekday);
  if (!Number.isInteger(wd) || wd < 0 || wd > 6) return { error: "Pick the day of the call." };
  const start = raw.start.trim();
  if (start && !validStart(start)) return { error: "Give the start as a time, like 17:00." };
  const minutes = Number(raw.minutes);
  if (!(OOH_MINUTES_CHOICES as readonly number[]).includes(minutes)) return { error: "Pick how long the call runs." };
  return { value: { oohWeekday: wd, oohStart: start || null, oohMinutes: minutes } };
}

/** The session's date in the reader's own calendar ("2026-10-30" in Sydney for a Thursday 29 Oct PT call); the host's date without a time. */
export function sessionLocalDate(day: string, s: OohSchedule, viewerTz: string): string {
  const at = sessionStart(day, s);
  return at ? new Intl.DateTimeFormat("en-CA", { timeZone: viewerTz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at) : day;
}

/** The session's weekday name in the reader's calendar ("Friday" in Sydney for a Thursday PT call). */
export function sessionLocalDay(day: string, s: OohSchedule, viewerTz: string): string {
  const at = sessionStart(day, s);
  return at ? fmt(at, viewerTz, { weekday: "long" }) : dayName(s);
}

/** Spoken and listed words for one session: the reader's own day and time when known, else "Friday the 23rd". */
export function sessionSpoken(day: string, s: OohSchedule, viewerTz: string): string {
  if (!sessionStart(day, s)) {
    const n = Number(day.slice(8, 10));
    const th = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
    return `${dayName(s)} the ${n}${th}`;
  }
  return sessionWhen(day, s, viewerTz, { zone: true });
}
