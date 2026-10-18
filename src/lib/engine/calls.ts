/**
 * The weekly calls (H-820, plan H-828), the rules with no database in them. A call is a weekday and a start in its own zone
 * ("Monday 10:00 America/Los_Angeles"), so it stays at 10:00 Pacific for the host across a clock change and each member reads
 * it in theirs. Everything that shows a call works from `callOccurrences`: the /calls page, the Next call line on Today, the
 * Add to calendar file, and the H-771 reminders (morning of, 15 minutes before, "we're live"), which read the same
 * occurrences through `callsBetween` in src/lib/calls.ts and add only the sending. Covered by
 * src/lib/engine/__tests__/calls.test.ts.
 */
import type { CallAudience } from "@/db/schema";
import { addDays, todayInTz, wallTimeToUtc, weekday as weekdayOf } from "@/lib/dates";
import { icsFold, icsStamp, icsText } from "@/lib/hermes/when";
import { programInAudience } from "./recordings";
import { validTimezone } from "./recording-rules";
import { clockIn, joinState } from "./call-join";

export { JOIN_EARLY_MINUTES, canJoin, clockIn, joinOpensAt, joinState, type JoinState } from "./call-join";

export const CALL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const CALL_MINUTES_MIN = 5;
export const CALL_MINUTES_MAX = 480;
export const CALL_TZ_DEFAULT = "America/Los_Angeles";
/** The workspace's shared link and passcode a coach starts with (H-828 defaults, coach-editable). */
export const DEFAULT_CALLS_LINK = "https://evolvecalls.com";
export const DEFAULT_CALLS_PASSCODE = "evolve";
/** What a member is told about who a call is for; the coach sees it beside each call. */
export const CALL_AUDIENCE_LABEL: Record<CallAudience, string> = { accelerator_academy: "Accelerator and up", academy: "Academy and up" };

export type CallDefault = { name: string; weekday: number; start: string; minutes: number; timezone: string; audience: CallAudience; sort: number };
/**
 * The program's usual week (H-828 defaults, all Pacific, an hour each): the Academy call Monday to Thursday at 10:00 and
 * Friday at 13:00, the Accelerator Orientation Monday at 9:00 and the Accelerator call Wednesday at 10:00. Migration 0206 writes
 * the same rows for every workspace with a coach; src/db/__tests__/migration-0206.test.ts holds the two together.
 */
export const DEFAULT_CALLS: CallDefault[] = [
  { name: "Academy call", weekday: 1, start: "10:00", minutes: 60, timezone: CALL_TZ_DEFAULT, audience: "academy", sort: 0 },
  { name: "Academy call", weekday: 2, start: "10:00", minutes: 60, timezone: CALL_TZ_DEFAULT, audience: "academy", sort: 1 },
  { name: "Academy call", weekday: 3, start: "10:00", minutes: 60, timezone: CALL_TZ_DEFAULT, audience: "academy", sort: 2 },
  { name: "Academy call", weekday: 4, start: "10:00", minutes: 60, timezone: CALL_TZ_DEFAULT, audience: "academy", sort: 3 },
  { name: "Academy call", weekday: 5, start: "13:00", minutes: 60, timezone: CALL_TZ_DEFAULT, audience: "academy", sort: 4 },
  { name: "Accelerator Orientation", weekday: 1, start: "09:00", minutes: 60, timezone: CALL_TZ_DEFAULT, audience: "accelerator_academy", sort: 5 },
  { name: "Accelerator call", weekday: 3, start: "10:00", minutes: 60, timezone: CALL_TZ_DEFAULT, audience: "accelerator_academy", sort: 6 },
];

/** A call as the engine reads it: the program_calls row, or anything with its fields. */
export type CallLike = { id: string; name: string; weekday: number; start: string; minutes: number; timezone: string; audience: CallAudience; link: string | null; active: boolean };
export type SkipLike = { callId: string; date: string };
/** The workspace's shared link and passcode, for a call without its own link. */
export type Shared = { link: string | null; passcode: string | null };

/**
 * One occurrence of a call: the instants it starts and ends, the call's own local date (what a skip keys on), who it is for,
 * and how to join (the call's link, else the shared one, and the shared passcode).
 */
export type CallOccurrence<C extends CallLike = CallLike> = { call: C; startIso: string; endIso: string; localDate: string; audience: CallAudience; link: string | null; passcode?: string | null };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validCallStart = (s: string): boolean => TIME.test(s);
const toMs = (x: Date | string): number => (x instanceof Date ? x.getTime() : new Date(x).getTime());

/** The call's start on one of its local dates, as an instant (DST-safe: the wall time read in the call's zone that day). */
export function callStartOn(call: Pick<CallLike, "start" | "timezone">, localDate: string): Date | null {
  if (!validCallStart(call.start)) return null;
  const iso = wallTimeToUtc(`${localDate}T${call.start}`, call.timezone);
  return iso ? new Date(iso) : null;
}

/**
 * Every occurrence of the active calls that overlaps [from, to), skipped dates left out, sorted by start (then by name). A
 * call already running at `from` is included, so "from now" finds a live call too. The source for the H-771 reminders.
 */
export function callOccurrences<C extends CallLike>(calls: C[], skips: SkipLike[], from: Date | string, to: Date | string, shared: Shared = { link: null, passcode: null }): CallOccurrence<C>[] {
  const a = toMs(from);
  const b = toMs(to);
  if (!(b > a)) return [];
  const skipped = new Set(skips.map((s) => `${s.callId}|${s.date}`));
  const out: CallOccurrence<C>[] = [];
  for (const call of calls) {
    if (!call.active || !validTimezone(call.timezone) || !validCallStart(call.start)) continue;
    // The call's local dates that can touch the window, one day of slack each side (a call can run past midnight).
    const first = addDays(todayInTz(call.timezone, new Date(a)), -1);
    const last = addDays(todayInTz(call.timezone, new Date(b)), 1);
    for (let d = addDays(first, (call.weekday - weekdayOf(first) + 7) % 7); d <= last; d = addDays(d, 7)) {
      if (skipped.has(`${call.id}|${d}`)) continue;
      const start = callStartOn(call, d);
      if (!start) continue;
      const end = start.getTime() + call.minutes * 60_000;
      if (end <= a || start.getTime() >= b) continue;
      out.push({ call, startIso: start.toISOString(), endIso: new Date(end).toISOString(), localDate: d, audience: call.audience, link: call.link || shared.link || null, passcode: shared.passcode ?? null });
    }
  }
  return out.sort((x, y) => x.startIso.localeCompare(y.startIso) || x.call.name.localeCompare(y.call.name));
}

/** Who is reading: the coach sees every call; a member (and their team, on the owner's level) the calls their program is in. */
export type CallSeer = { role: "coach" | "client"; programTier: string };
export function visibleTo(occ: { audience: CallAudience }, seer: CallSeer): boolean {
  return seer.role === "coach" || programInAudience(occ.audience, seer.programTier);
}

/* ─────────── The coach's form, read ─────────── */

export type CallFields = { name: string; weekday: number; start: string; minutes: number; timezone: string; audience: CallAudience; link: string | null };
export const validHttpLink = (s: string): boolean => {
  if (!/^https?:\/\/\S+$/i.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
  } catch {
    return false;
  }
};

/** One call as the coach typed it, or why not (with the field it names, so the form marks that box). */
export function readCall(raw: { name: string; weekday: string; start: string; minutes: string; timezone: string; audience: string; link: string }): { value: CallFields } | { error: string; field: string } {
  const name = raw.name.trim().slice(0, 80);
  if (!name) return { error: "Give the call a name.", field: "name" };
  const wd = raw.weekday.trim() === "" ? NaN : Number(raw.weekday);
  if (!Number.isInteger(wd) || wd < 0 || wd > 6) return { error: "Pick the day of the call.", field: "weekday" };
  const start = raw.start.trim();
  if (!validCallStart(start)) return { error: "Give the start as a 24-hour time, like 10:00.", field: "start" };
  const minutes = Number(raw.minutes);
  if (!Number.isInteger(minutes) || minutes < CALL_MINUTES_MIN || minutes > CALL_MINUTES_MAX) return { error: `Give the length in minutes, ${CALL_MINUTES_MIN} to ${CALL_MINUTES_MAX}.`, field: "minutes" };
  const timezone = raw.timezone.trim() || CALL_TZ_DEFAULT;
  if (!validTimezone(timezone)) return { error: `"${timezone}" isn't a timezone HelixOS knows. Use a name like America/Los_Angeles.`, field: "timezone" };
  if (raw.audience !== "academy" && raw.audience !== "accelerator_academy") return { error: "Pick who the call is for.", field: "audience" };
  const link = raw.link.trim();
  if (link && !validHttpLink(link)) return { error: "The call's link starts with https:// (or leave it blank for the shared link).", field: "link" };
  return { value: { name, weekday: wd, start, minutes, timezone, audience: raw.audience, link: link || null } };
}

/** The shared link and passcode, or why not. Both may be blank. */
export function readShared(raw: { link: string; passcode: string }): { value: { callsLink: string | null; callsPasscode: string | null } } | { error: string; field: string } {
  const link = raw.link.trim();
  if (link && !validHttpLink(link)) return { error: "The shared link starts with https://.", field: "link" };
  const passcode = raw.passcode.trim().slice(0, 60);
  return { value: { callsLink: link || null, callsPasscode: passcode || null } };
}

/** A date to skip: a real "YYYY-MM-DD" on the call's weekday. */
export function readSkipDate(raw: string, call: Pick<CallLike, "weekday">): { value: string } | { error: string } {
  const d = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || addDays(d, 0) !== d) return { error: "Pick the date with no call." };
  if (weekdayOf(d) !== call.weekday) return { error: `That date isn't a ${CALL_DAY_NAMES[call.weekday]}.` };
  return { value: d };
}

/** The next `n` local dates of a call from its own today: the dates the coach can skip. */
export function nextCallDates(call: Pick<CallLike, "weekday" | "timezone">, now: Date = new Date(), n = 8): string[] {
  const today = todayInTz(validTimezone(call.timezone) ? call.timezone : CALL_TZ_DEFAULT, now);
  const first = addDays(today, (call.weekday - weekdayOf(today) + 7) % 7);
  return Array.from({ length: n }, (_, i) => addDays(first, i * 7));
}

/* ─────────── Words ─────────── */

const fmt = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(d);
/** "Thu 27 Nov": a call's own date, as the coach's skip list says it. */
export const skipDay = (localDate: string): string => {
  const d = new Date(`${localDate}T12:00:00Z`);
  return `${fmt(d, "UTC", { weekday: "short" })} ${fmt(d, "UTC", { day: "numeric" })} ${fmt(d, "UTC", { month: "short" })}`;
};
/** "60 min", "1 h 30 min". */
export const lengthWords = (minutes: number): string => (minutes < 60 || minutes % 60 === 0 ? (minutes < 60 ? `${minutes} min` : `${minutes / 60} h`) : `${Math.floor(minutes / 60)} h ${minutes % 60} min`);
/** "in 2 h", "in 25 min", "in 1 h 5 min"; "now" at or past the start. */
export function untilWords(startIso: string, now: Date | number): string {
  const t = typeof now === "number" ? now : now.getTime();
  const mins = Math.ceil((new Date(startIso).getTime() - t) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}
/** The reader's day heading: "Today", "Tomorrow", else "Wednesday 21 Oct". `today` is the reader's own date. */
export function dayHeading(localDate: string, today: string): string {
  if (localDate === today) return "Today";
  if (localDate === addDays(today, 1)) return "Tomorrow";
  const d = new Date(`${localDate}T12:00:00Z`);
  return `${fmt(d, "UTC", { weekday: "long" })} ${fmt(d, "UTC", { day: "numeric" })} ${fmt(d, "UTC", { month: "short" })}`;
}
/** The Today line: "Next call: Academy call, Mon 10:00 AM (in 2 h)", or "… (live now)". */
export function nextCallLine(occ: CallOccurrence, tz: string, now: Date | number): string {
  const at = new Date(occ.startIso);
  const when = `${fmt(at, tz, { weekday: "short" })} ${clockIn(at, tz)}`;
  const state = joinState(occ, now);
  return `Next call: ${occ.call.name}, ${when} (${state === "live" ? "live now" : untilWords(occ.startIso, now)})`;
}
/** The first occurrence that is live or starts within `hours`: what Today shows, or nothing. */
export function nextCallWithin<C extends CallLike>(occs: CallOccurrence<C>[], now: Date | number, hours = 24): CallOccurrence<C> | null {
  const t = typeof now === "number" ? now : now.getTime();
  const live = occs.find((o) => joinState(o, t) === "live");
  if (live) return live;
  return occs.find((o) => joinState(o, t) !== "over" && new Date(o.startIso).getTime() - t <= hours * 3_600_000) ?? null;
}

/* ─────────── Add to calendar ─────────── */

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const wallStamp = (date: string, hhmm: string) => `${date.replace(/-/g, "")}T${hhmm.replace(":", "")}00`;
/** The wall time `minutes` after a date and start, as a local stamp (a call can run past midnight). */
function wallPlus(date: string, hhmm: string, minutes: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi) + minutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}00`;
}

const offsetFmt = new Map<string, Intl.DateTimeFormat>();
/** The zone's offset from UTC at an instant, in minutes (Los Angeles in summer: -420). */
export function offsetMinutes(tz: string, at: number): number {
  let f = offsetFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" });
    offsetFmt.set(tz, f);
  }
  const name = f.formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
const offsetText = (mins: number) => `${mins < 0 ? "-" : "+"}${String(Math.floor(Math.abs(mins) / 60)).padStart(2, "0")}${String(Math.abs(mins) % 60).padStart(2, "0")}`;

/**
 * The zone's VTIMEZONE (RFC 5545 asks for one per TZID; Outlook won't place the event without it): every clock change from
 * the start of `fromYear` for `years` years, found by asking Intl for the offset, as STANDARD and DAYLIGHT observances with
 * their dates. A zone without changes gets one STANDARD observance.
 */
export function vtimezone(tz: string, fromYear: number, years = 10): string[] {
  const changes: { at: number; from: number; to: number }[] = [];
  const DAY = 86_400_000;
  const end = Date.UTC(fromYear + years, 0, 1);
  let t = Date.UTC(fromYear, 0, 1);
  let off = offsetMinutes(tz, t);
  for (; t < end; t += DAY) {
    const next = offsetMinutes(tz, t + DAY);
    if (next === off) continue;
    // The change is in (t, t + DAY]: narrow it to the minute.
    let lo = t;
    let hi = t + DAY;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (offsetMinutes(tz, mid) === off) lo = mid;
      else hi = mid;
    }
    changes.push({ at: hi, from: off, to: next });
    off = next;
  }
  const local = (at: number, mins: number) => new Date(at + mins * 60_000).toISOString().replace(/[-:]/g, "").slice(0, 15);
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`];
  if (!changes.length) {
    const o = offsetMinutes(tz, Date.UTC(fromYear, 0, 1));
    lines.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${offsetText(o)}`, `TZOFFSETTO:${offsetText(o)}`, "END:STANDARD");
  } else {
    // One observance per (kind, from, to); a zone that changed its rules gets one per rule.
    const groups = new Map<string, { kind: "STANDARD" | "DAYLIGHT"; from: number; to: number; dates: string[] }>();
    for (const c of changes) {
      const kind = c.to > c.from ? "DAYLIGHT" : "STANDARD";
      const key = `${kind}|${c.from}|${c.to}`;
      const g = groups.get(key) ?? { kind, from: c.from, to: c.to, dates: [] };
      g.dates.push(local(c.at, c.from));
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      lines.push(`BEGIN:${g.kind}`, `DTSTART:${g.dates[0]}`, ...(g.dates.length > 1 ? [`RDATE:${g.dates.slice(1).join(",")}`] : []), `TZOFFSETFROM:${offsetText(g.from)}`, `TZOFFSETTO:${offsetText(g.to)}`, `END:${g.kind}`);
    }
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

/**
 * Add to calendar for one call (H-828): a weekly event (RRULE:FREQ=WEEKLY in the call's own zone, so it stays at the host's
 * time across a clock change), every skipped date from the first one on as an EXDATE, the link and passcode in the
 * description, and a 15-minute alarm. Starts on the call's next date that isn't skipped. Nothing about the member goes in it.
 */
export function callIcs(call: CallLike, skips: SkipLike[], shared: Shared, now: Date = new Date()): string {
  const tz = call.timezone;
  const mine = new Set(skips.filter((s) => s.callId === call.id).map((s) => s.date));
  let first = nextCallDates(call, now, 1)[0];
  for (let i = 0; i < 104 && mine.has(first); i++) first = addDays(first, 7);
  const link = call.link || shared.link || null;
  const details = [`${call.name}, every ${CALL_DAY_NAMES[call.weekday]} at ${call.start} (${tz}).`, link ? `Join: ${link}` : null, shared.passcode ? `Passcode: ${shared.passcode}` : null].filter(Boolean).join("\n");
  const exdates = [...mine].filter((d) => d > first).sort();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Evolve Omega//HelixOS calls//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-TIMEZONE:${tz}`,
    ...vtimezone(tz, Number(first.slice(0, 4)) - 1, 11),
    "BEGIN:VEVENT",
    `UID:call-${call.id}@helixos`,
    `DTSTAMP:${icsStamp(now.toISOString())}`,
    `DTSTART;TZID=${tz}:${wallStamp(first, call.start)}`,
    `DTEND;TZID=${tz}:${wallPlus(first, call.start, call.minutes)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${DAY_CODES[call.weekday]}`,
    ...(exdates.length ? [`EXDATE;TZID=${tz}:${exdates.map((d) => wallStamp(d, call.start)).join(",")}`] : []),
    `SUMMARY:${icsText(call.name)}`,
    `DESCRIPTION:${icsText(details)}`,
    ...(link ? [`LOCATION:${icsText(link)}`, `URL:${link}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(call.name)}`,
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
