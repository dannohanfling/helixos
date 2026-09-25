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

/** The Fridays a member can ask for: from today (a Friday counts) to the end of this month. */
export function upcomingFridays(today: string): string[] {
  const out: string[] = [];
  let d = addDays(today, (5 - weekday(today) + 7) % 7);
  while (d.slice(0, 7) === today.slice(0, 7)) {
    out.push(d);
    d = addDays(d, 7);
  }
  return out;
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
): { value: OohInput } | { error: string } | { goBack: string } {
  if (raw.triedGate === GO_BACK) return { goBack: "That's a good call. Work through it on your own first, and if you're still stuck, ask here before the next Friday. Nothing was sent." };
  if (raw.triedGate !== "yes") return { error: "Tell us whether you've tried to overcome this yourself." };
  if (!raw.promise) return { error: "Promise to attend the call, so your spot isn't wasted." };
  const v = { friday: raw.friday.trim(), description: raw.description.trim(), triedSelf: raw.triedSelf.trim(), tools: raw.tools.trim(), goal: raw.goal.trim(), category: raw.category.trim() };
  if (!upcomingFridays(today).includes(v.friday)) return { error: "Pick one of this month's upcoming Fridays." };
  if (!v.description) return { error: "Describe the issue." };
  if (!v.triedSelf) return { error: "Say how you tried to solve it yourself." };
  if (!v.goal) return { error: "Say what solution we're trying to reach on the call." };
  if (!categories.includes(v.category)) return { error: "Pick a category." };
  return { value: v };
}

/** A coach-edited list, one per line: trimmed, blank lines and repeats dropped. */
export const readList = (text: string): string[] => [...new Set(text.split("\n").map((l) => l.trim()).filter(Boolean))];
