/**
 * The Open Office Hours request (handoff rev 124), from the Airtable "OOH Form": a member asks ahead of a Friday session so the
 * coach can prepare. Pure: dates are the member's own "YYYY-MM-DD".
 */
import { addDays, weekday } from "@/lib/dates";

/** The categories a new workspace starts with; the coach edits the list. */
export const OOH_CATEGORIES_DEFAULT = ["Chatbot", "Airtable", "Funnels", "FB Group Management", "Offer Creation", "Other"];
/** Who can be responsible for a request; the coach edits the list. */
export const OOH_HOSTS_DEFAULT = ["Danno Hanfling", "Shonna Roadruck"];
export const OOH_OUTCOMES = ["covered", "no_show"] as const;
export type OohOutcome = (typeof OOH_OUTCOMES)[number];
export const OOH_OUTCOME_LABEL: Record<OohOutcome, string> = { covered: "Covered", no_show: "No-show" };

/** How many Fridays a member can pick from. */
export const OOH_FRIDAYS = 4;
/** The Fridays a member can ask for: the next four, a Friday today included, across month ends (rev 129: no dead days). */
export function upcomingFridays(today: string, n: number = OOH_FRIDAYS): string[] {
  const first = addDays(today, (5 - weekday(today) + 7) % 7);
  return Array.from({ length: n }, (_, i) => addDays(first, i * 7));
}

/** A member can change their request up to and including its Friday. */
export const oohEditable = (today: string, friday: string): boolean => today <= friday;

export type OohInput = { friday: string; description: string; triedSelf: string; tools: string; goal: string; category: string };
export const GO_BACK = "back";
/**
 * The request as saved, or why not. The two gates come first, as on the old form: a member who picks "I need to go back and try
 * to work through this myself" is sent off kindly with nothing saved, and "I promise to attend" must be ticked.
 */
export function readOohRequest(
  raw: { friday: string; description: string; triedSelf: string; tools: string; goal: string; category: string; triedGate: string; promise: boolean },
  today: string,
  categories: string[],
): { value: OohInput } | { error: string; field?: string } | { goBack: string } {
  if (raw.triedGate === GO_BACK) return { goBack: "That's a good call. Work through it on your own first, and if you're still stuck, ask here before the next Friday. Nothing was sent." };
  if (raw.triedGate !== "yes") return { error: "Tell us whether you've tried to overcome this yourself.", field: "triedGate" };
  if (!raw.promise) return { error: "Promise to attend the call, so your spot isn't wasted.", field: "promise" };
  const v = { friday: raw.friday.trim(), description: raw.description.trim(), triedSelf: raw.triedSelf.trim(), tools: raw.tools.trim(), goal: raw.goal.trim(), category: raw.category.trim() };
  if (!upcomingFridays(today).includes(v.friday)) return { error: "Pick one of the next four Fridays.", field: "friday" };
  if (!v.description) return { error: "Describe the issue.", field: "description" };
  if (!v.triedSelf) return { error: "Say how you tried to solve it yourself.", field: "triedSelf" };
  if (!v.goal) return { error: "Say what solution we're trying to reach on the call.", field: "goal" };
  if (!categories.includes(v.category)) return { error: "Pick a category.", field: "category" };
  return { value: v };
}

/** A coach-edited list, one per line: trimmed, blank lines and repeats dropped. */
export const readList = (text: string): string[] => [...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean))];

/** A stored instant read as UTC: SQLite's own "YYYY-MM-DD HH:MM:SS" carries no zone and is UTC; an ISO string is kept. */
export function storedUtc(stored: string | null | undefined): Date | null {
  const s = (stored ?? "").trim();
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(" ", "T")}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
const part = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(d);
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const zoneOf = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortGeneric" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "";

/**
 * When a member sent (or last changed) an Office Hours request, in the viewer's own zone with the zone said (rev 625):
 * "Submitted Fri, Oct 9 · 10:42 AM PT", "Submitted today, 10:42 AM PT", "Edited Oct 9 · 11:05 AM PT". The title is the
 * full date and time with seconds, for a hover or a long press. A row with no time says so rather than guess.
 */
export function stampLine(word: "Submitted" | "Edited", stored: string | null | undefined, tz: string, today: string): { label: string; title: string } {
  const d = storedUtc(stored);
  if (!d) return { label: `${word}: date unknown`, title: "" };
  const time = `${part(d, tz, { hour: "numeric", minute: "2-digit" })} ${zoneOf(d, tz)}`.trim();
  const day = dayIn(d, tz);
  const yesterday = dayIn(new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400000), "UTC");
  const when = day === today ? `today, ${time}` : day === yesterday ? `yesterday, ${time}` : `${part(d, tz, word === "Submitted" ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" })} · ${time}`;
  const title = new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "long" }).format(d);
  return { label: `${word} ${when}`, title };
}
/** The coach's list order inside each Friday: newest first unless asked for oldest. */
export const byStamp = (order: "newest" | "oldest") => (a: { createdAt: string }, b: { createdAt: string }) => ((storedUtc(a.createdAt)?.getTime() ?? 0) - (storedUtc(b.createdAt)?.getTime() ?? 0)) * (order === "oldest" ? 1 : -1);
