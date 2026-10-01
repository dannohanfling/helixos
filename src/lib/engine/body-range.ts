/**
 * Longer views (Danno, 1 Oct; rev 237 phase 10b): one range picker shared by the Body pages. Week (as the week page), Month (a
 * calendar month), 90 days and a Year (the days ending on `from`'s day, today by default), with `?range=month&from=2026-09-01`
 * so a view can be bookmarked and the Claude tools ask for the same. The arithmetic here is pure: bounds, the weeks inside a
 * range, per-week folds, and the calendar strip's weeks.
 */
export type RangeKey = "week" | "month" | "90d" | "year";
export const RANGE_KEYS: RangeKey[] = ["week", "month", "90d", "year"];
export const RANGE_LABEL: Record<RangeKey, string> = { week: "Week", month: "Month", "90d": "90 days", year: "Year" };
export const isRangeKey = (k: unknown): k is RangeKey => typeof k === "string" && (RANGE_KEYS as string[]).includes(k);

export type Dates = { addDays: (d: string, n: number) => string; startOfWeek: (d: string) => string };
export type Bounds = { key: RangeKey; from: string; to: string; label: string; prevFrom: string; prevTo: string; anchor: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
function monthEnd(d: string, addDays: Dates["addDays"]): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The range's bounds. `from` is the day asked for (a week's Monday, a month's first, or the last day of a 90-day or year span);
 * nothing after today is shown. The previous span of the same length sits beside it for comparison.
 */
export function rangeBounds(key: RangeKey, from: string | null | undefined, today: string, dates: Dates): Bounds {
  const asked = from && DATE.test(from) && from <= today ? from : today;
  if (key === "week") {
    const monday = dates.startOfWeek(asked);
    const sunday = dates.addDays(monday, 6);
    return { key, from: monday, to: sunday < today ? sunday : today, label: `Week of ${monday}`, prevFrom: dates.addDays(monday, -7), prevTo: dates.addDays(monday, -1), anchor: monday };
  }
  if (key === "month") {
    const first = monthStart(asked);
    const last = monthEnd(asked, dates.addDays);
    const prevLast = dates.addDays(first, -1);
    return { key, from: first, to: last < today ? last : today, label: `${MONTHS[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`, prevFrom: monthStart(prevLast), prevTo: prevLast, anchor: first };
  }
  const days = key === "90d" ? 90 : 365;
  const to = asked;
  const start = dates.addDays(to, -(days - 1));
  return { key, from: start, to, label: key === "90d" ? `90 days to ${to}` : `Year to ${to}`, prevFrom: dates.addDays(start, -days), prevTo: dates.addDays(start, -1), anchor: to };
}

/** The range one step back or forward (a week, a month, 90 days, a year), as the anchor to ask for; forward never past today. */
export function stepRange(b: Bounds, dir: -1 | 1, today: string, dates: Dates): string | null {
  if (b.key === "week") {
    const next = dates.addDays(b.anchor, 7 * dir);
    return dir > 0 && next > today ? null : next;
  }
  if (b.key === "month") {
    const next = dir < 0 ? monthStart(dates.addDays(b.anchor, -1)) : dates.addDays(monthEnd(b.anchor, dates.addDays), 1);
    return next > today ? null : next;
  }
  const days = b.key === "90d" ? 90 : 365;
  const next = dates.addDays(b.anchor, days * dir);
  return dir > 0 && next > today ? (b.anchor < today ? today : null) : next;
}

/** The Mondays of the weeks that touch the range, oldest first. */
export function mondaysIn(from: string, to: string, dates: Dates): string[] {
  const out: string[] = [];
  for (let m = dates.startOfWeek(from); m <= to; m = dates.addDays(m, 7)) out.push(m);
  return out;
}

/** Day values folded by week: a sum or a mean per Monday, zero for a week with nothing when summing, null when averaging. */
export function perWeek(points: { date: string; value: number }[], from: string, to: string, fold: "sum" | "mean", dates: Dates): { monday: string; value: number | null; n: number }[] {
  const byWeek = new Map<string, number[]>();
  for (const p of points) {
    if (p.date < from || p.date > to) continue;
    const w = dates.startOfWeek(p.date);
    byWeek.set(w, [...(byWeek.get(w) ?? []), p.value]);
  }
  return mondaysIn(from, to, dates).map((monday) => {
    const vs = byWeek.get(monday) ?? [];
    const sum = vs.reduce((a, v) => a + v, 0);
    return { monday, n: vs.length, value: fold === "sum" ? sum : vs.length ? Math.round((sum / vs.length) * 10) / 10 : null };
  });
}

/** The calendar strip's weeks for a range: every week touching it, each day with the level and title the caller gives. */
export function calendarWeeks(from: string, to: string, today: string, dates: Dates, levelFor: (date: string) => 0 | 1 | 2 | 3, titleFor: (date: string) => string): { monday: string; days: { date: string; level: 0 | 1 | 2 | 3; title: string }[] }[] {
  return mondaysIn(from, to, dates).map((monday) => ({
    monday,
    days: Array.from({ length: 7 }, (_, i) => dates.addDays(monday, i)).map((date) => ({ date, level: date < from || date > to || date > today ? 0 : levelFor(date), title: date < from || date > to ? "" : titleFor(date) })),
  }));
}

/** "Sep 2026" for a strip's first week of a month, else "" (one label per month). */
export const monthLabelFor = (mondays: string[], formatMonth: (d: string) => string) => (monday: string): string => {
  const i = mondays.indexOf(monday);
  if (i < 0) return "";
  if (i === 0) return formatMonth(monday);
  return mondays[i - 1].slice(0, 7) !== monday.slice(0, 7) ? formatMonth(monday) : "";
};

/** "12 of 15 (80%)" for kept-of-due figures; "—" with nothing due. */
export const rateText = (kept: number, due: number): string => (due ? `${kept} of ${due} (${Math.round((kept / due) * 100)}%)` : "—");
