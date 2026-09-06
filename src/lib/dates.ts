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
