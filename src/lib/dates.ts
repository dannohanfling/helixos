/** All app dates are ISO `YYYY-MM-DD` strings in the workspace timezone. */

export function todayInTz(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function hourInTz(tz: string, now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now);
  return Number(h) % 24;
}

export function toDate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function fromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const date = toDate(d);
  date.setUTCDate(date.getUTCDate() + n);
  return fromDate(date);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(d: string): number {
  return toDate(d).getUTCDay();
}

export function isWeekday(d: string): boolean {
  const w = weekday(d);
  return w >= 1 && w <= 5;
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: string): string {
  const w = weekday(d);
  const back = w === 0 ? 6 : w - 1;
  return addDays(d, -back);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

export function rangeDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function formatDate(d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(toDate(d));
}

export function formatDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export function relativeDay(d: string, today: string): string {
  const diff = daysBetween(today, d);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${-diff}d overdue`;
  if (diff < 7) return formatDate(d, { weekday: "short" });
  return formatDate(d);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Now as a naive wall time (`YYYY-MM-DDTHH:MM:SS`) in the member's zone: the shape every stored postAt has. */
export function nowWallInTz(tz: string, now: Date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}:${p.second}`;
}

/**
 * A wall-clock time in a member's own zone (`YYYY-MM-DDTHH:MM` or with `:SS`, no offset) as the UTC instant it names, ISO
 * with milliseconds and a Z: what the Social Planner wants. A zoneless string handed to `new Date()` is read as the SERVER's
 * local time, which on Vercel is UTC, so 9:30am in Los Angeles would be sent as 09:30Z; this reads it in the member's zone.
 * A string that already carries an offset or a Z is honoured as is.
 */
export function wallTimeToUtc(wall: string, tz: string): string | null {
  try {
    if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(wall)) {
      const t = new Date(wall).getTime();
      return Number.isNaN(t) ? null : new Date(t).toISOString();
    }
    const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
    const asked = Date.UTC(y, mo - 1, d, h, mi, s);
    // Guess the instant as if UTC, read that instant back in the zone, and correct by the difference; twice, for DST edges.
    let guess = asked;
    for (let i = 0; i < 2; i++) {
      const seen = partsInTz(new Date(guess), tz);
      guess += asked - Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi, seen.s);
    }
    // A wall time that does not exist (the hour a clock springs forward) moves forward by the length of the gap, as a clock would, never earlier.
    const seen = partsInTz(new Date(guess), tz);
    const drift = asked - Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi, seen.s);
    if (drift > 0) guess += drift;
    return new Date(guess).toISOString();
  } catch {
    return null;
  }
}

function partsInTz(at: Date, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}
