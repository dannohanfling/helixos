/**
 * The call's date and time, as every Hermes page and file says it. The moment comes from the webinar entry (the engine's
 * factsFor turns its wall time in the member's zone into an instant); nothing here works out a day on its own. Pages always name
 * the date ("Friday, October 23 at 10:00 AM PT"), never "this Friday": prospects are invited the week before.
 */
export const EASTERN = "America/New_York";
export const CALL_MINUTES = 60;

const part = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(d);
const zoneShort = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortGeneric" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? tz;
const zoneLong = (d: Date, tz: string) =>
  (new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? tz).replace(/ Time$/, "");

export type CallWhen = {
  startsAt: string;
  endsAt: string;
  /** "Friday, October 23" */
  day: string;
  /** "October 23" */
  date: string;
  /** "10:00 AM PT" in the member's zone */
  time: string;
  /** "1:00 PM ET", or null when the member is on Eastern time already */
  timeEt: string | null;
  /** "Friday, October 23 at 10:00 AM PT" */
  line: string;
  /** "Friday, October 23 · 10:00 AM Pacific · 1:00 PM Eastern" */
  full: string;
  /** "FRIDAY, OCT 23 · 10AM PT" for the small line under each button */
  banner: string;
  /** "9:45 AM PT", fifteen minutes before */
  alarm: string;
  /** "2026-10-23", the day in the member's zone, for the ic-<date> tag */
  isoDay: string;
};

export function callWhen(startsAt: string, tz: string, minutes = CALL_MINUTES): CallWhen {
  const d = new Date(startsAt);
  const end = new Date(d.getTime() + minutes * 60_000);
  const clock = (x: Date, z: string) => part(x, z, { hour: "numeric", minute: "2-digit" });
  const shortClock = (x: Date, z: string) => clock(x, z).replace(":00", "").replace(" ", "");
  const day = part(d, tz, { weekday: "long", month: "long", day: "numeric" });
  const date = part(d, tz, { month: "long", day: "numeric" });
  const time = `${clock(d, tz)} ${zoneShort(d, tz)}`;
  const sameAsEastern = clock(d, tz) === clock(d, EASTERN) && zoneShort(d, tz) === zoneShort(d, EASTERN);
  const timeEt = sameAsEastern ? null : `${clock(d, EASTERN)} ${zoneShort(d, EASTERN)}`;
  const full = [day, `${clock(d, tz)} ${zoneLong(d, tz)}`, ...(sameAsEastern ? [] : [`${clock(d, EASTERN)} ${zoneLong(d, EASTERN)}`])].join(" · ");
  const banner = `${part(d, tz, { weekday: "long" })}, ${part(d, tz, { month: "short", day: "numeric" })} · ${shortClock(d, tz)} ${zoneShort(d, tz)}`.toUpperCase();
  const alarmAt = new Date(d.getTime() - 15 * 60_000);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return { startsAt: d.toISOString(), endsAt: end.toISOString(), day, date, time, timeEt, line: `${day} at ${time}`, full, banner, alarm: `${clock(alarmAt, tz)} ${zoneShort(alarmAt, tz)}`, isoDay: ymd };
}

/** The ic-<YYYY-MM-DD> tag for that call's day. */
export const dayTag = (w: CallWhen) => `ic-${w.isoDay}`;

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Add to Google Calendar: Google's own event template link. Nothing about the person goes in it. */
export function googleCalendarUrl(o: { title: string; details: string; when: CallWhen; location: string | null }): string {
  const q = new URLSearchParams({ action: "TEMPLATE", text: o.title, dates: `${stamp(o.when.startsAt)}/${stamp(o.when.endsAt)}`, details: o.details });
  if (o.location) q.set("location", o.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** RFC 5545 text: escape \ ; , and newlines, then fold lines at 75 octets. */
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** The Apple / Outlook file: one event, a 15-minute alarm, UTC times. `uid` is stable per call and person, never their details. */
export function icsFile(o: { uid: string; title: string; details: string; when: CallWhen; location: string | null; now?: Date; zone?: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Evolve Omega//HelixOS pages//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    // The host's zone as a hint (H-457); the times stay UTC instants, which every calendar shows in its owner's own time.
    ...(o.zone ? [`X-WR-TIMEZONE:${o.zone}`] : []),
    "BEGIN:VEVENT",
    `UID:${o.uid}`,
    `DTSTAMP:${stamp((o.now ?? new Date()).toISOString())}`,
    `DTSTART:${stamp(o.when.startsAt)}`,
    `DTEND:${stamp(o.when.endsAt)}`,
    `SUMMARY:${icsText(o.title)}`,
    `DESCRIPTION:${icsText(o.details)}`,
    ...(o.location ? [`LOCATION:${icsText(o.location)}`, `URL:${o.location}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(o.title)}`,
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The countdown's parts at `now`; all zero once the call has started. */
export function countdown(startsAt: string, now: number): { d: string; h: string; m: string; s: string } {
  let s = Math.max(0, Math.floor((new Date(startsAt).getTime() - now) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return { d: String(d), h: p(h), m: p(m), s: p(s) };
}
