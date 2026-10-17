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

/*
 * Team access on Office Hours (H-413): a team member books for the owner, says who's attending, and sees only the requests
 * they are part of. Pure; the server side is src/lib/office-hours-core.ts and the page.
 */
export type OohTeamRow = { userId: string; submittedByUserId: string | null; attendeeUserIds: string[] };
/** Who is looking: the owner's user id, the person acting (the owner, or the team member), and whether they are on the team. */
export type OohViewer = { ownerId: string; actorId: string; team: boolean };

/** The attendees as stored read as the owner alone when nobody was picked (older requests, and the voice tool's). */
export const oohAttendees = (r: Pick<OohTeamRow, "userId" | "attendeeUserIds">): string[] => (r.attendeeUserIds.length ? r.attendeeUserIds : [r.userId]);

/** The owner sees every request on the account; a team member only the ones they submitted or are listed as attending. */
export function oohVisibleTo(r: OohTeamRow, who: OohViewer): boolean {
  if (!who.team) return true;
  return r.submittedByUserId === who.actorId || oohAttendees(r).includes(who.actorId);
}

/** Who may change a request before its Friday: the owner, or the team member who submitted it. Attending alone does not. */
export function oohCanEdit(r: OohTeamRow, who: OohViewer, today: string, friday: string): boolean {
  if (!oohEditable(today, friday)) return false;
  return !who.team || r.submittedByUserId === who.actorId;
}

/** The attendees a form may name: the owner and the account's live team, nothing else; repeats dropped; nobody picked means the owner. */
export function readAttendees(picked: string[], allowed: string[], ownerId: string): string[] {
  const ok = new Set(allowed.concat(ownerId));
  const ids = [...new Set(picked.map((p) => p.trim()).filter((p) => p && ok.has(p)))];
  return ids.length ? ids : [ownerId];
}

/** The "Others" line holds names only: no email address, no phone number, at most 200 characters. */
export function readOthers(raw: string): { value: string | null } | { error: string; field: "attendeesOther" } {
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return { value: null };
  if (s.length > 200) return { error: "Keep the other names to 200 characters.", field: "attendeesOther" };
  if (/@/.test(s) || /(?:\d[\s().-]*){7,}/.test(s)) return { error: "Names only here, no email addresses or phone numbers.", field: "attendeesOther" };
  return { value: s };
}

/**
 * "Attending: Maya, Sam Vale; others: Lee". A person no longer on the team keeps their name with "(former team member)";
 * the owner is never former. `nameOf` resolves a user id; `onTeam` is the account's live team.
 */
export function attendeeWords(r: Pick<OohTeamRow, "userId" | "attendeeUserIds"> & { attendeesOther: string | null }, nameOf: (id: string) => string | undefined, onTeam: Set<string>): string {
  const names = oohAttendees(r).map((id) => {
    const name = nameOf(id) ?? "Someone";
    return id === r.userId || onTeam.has(id) ? name : `${name} (former team member)`;
  });
  return `Attending: ${names.join(", ")}${r.attendeesOther ? `; others: ${r.attendeesOther}` : ""}`;
}

/** "Submitted by Sam Vale", or "Submitted by Sam Vale (former team member)" once they have left; nothing for the owner's own. */
export function submittedByWords(r: Pick<OohTeamRow, "submittedByUserId">, nameOf: (id: string) => string | undefined, onTeam: Set<string>): string | null {
  if (!r.submittedByUserId) return null;
  const name = nameOf(r.submittedByUserId) ?? "A team member";
  return `Submitted by ${onTeam.has(r.submittedByUserId) ? name : `${name} (former team member)`}`;
}

/** The owner's notice line (H-413): "Sam Vale booked office hours for you, Friday, October 23", shown until they open Office Hours. */
export function oohNoticeWords(name: string, fridayLabel: string): string {
  return `${name} booked office hours for you, ${fridayLabel}`;
}

/*
 * Office Hours by program level (H-470): Academy, Elite and Luxe have it; Accelerator does not; the coach's own switch on a
 * client wins either way; a fulfilled 30-day access reward opens it for 30 days; the coach always has it. Pure.
 */
export const OOH_LEVELS_OPEN = ["Academy", "Elite", "Luxe"] as const;
/** The rewards that open Office Hours while they run (src/data/seed/rewards.json). */
export const OOH_ACCESS_REWARDS = ["30 Days Access to Evolve Omega Academy", "30 Days Access to Evolve Omega Elite"] as const;
export const OOH_EARNED_DAYS = 30;
/** The one line a client without access reads, on the page, from the action and from the connector. No prices, ever. */
export const OOH_LOCKED_LINE = "Office Hours is not available on your plan.";

export type OohOverride = "on" | "off" | null;
export type OohClaim = { rewardName: string; status: string; fulfilledAt: string | null };
export type OohAccess = { open: boolean; reason: "coach" | "set_on" | "set_off" | "earned" | "level" | "locked"; level: string; until: string | null };

/** The last day a fulfilled access reward still opens Office Hours, or null: 30 days from the coach's stamp (a claim with no stamp never counts). */
export function oohEarnedUntil(claims: OohClaim[], today: string): string | null {
  let best: string | null = null;
  for (const c of claims) {
    if (c.status !== "fulfilled" || !c.fulfilledAt || !(OOH_ACCESS_REWARDS as readonly string[]).includes(c.rewardName)) continue;
    const d = storedUtc(c.fulfilledAt);
    if (!d) continue;
    const until = addDays(d.toISOString().slice(0, 10), OOH_EARNED_DAYS - 1);
    if (until >= today && (!best || until > best)) best = until;
  }
  return best;
}

/** Whether this membership has Office Hours today, and why. The coach always; a team member gets the owner's answer by passing the owner's membership. */
export function oohAccess(m: { role: string; programTier: string; officeHoursOverride: OohOverride }, claims: OohClaim[], today: string): OohAccess {
  const level = m.programTier;
  if (m.role === "coach") return { open: true, reason: "coach", level, until: null };
  if (m.officeHoursOverride === "on") return { open: true, reason: "set_on", level, until: null };
  if (m.officeHoursOverride === "off") return { open: false, reason: "set_off", level, until: null };
  const until = oohEarnedUntil(claims, today);
  if (until) return { open: true, reason: "earned", level, until };
  if ((OOH_LEVELS_OPEN as readonly string[]).includes(level)) return { open: true, reason: "level", level, until: null };
  return { open: false, reason: "locked", level, until: null };
}

/** Beside the coach's switch: "Following level (Academy)" or "Set by you". */
export const oohSwitchWords = (override: OohOverride, level: string): string => (override ? "Set by you" : `Following level (${level})`);
/** What the switch's state means for the client, in one line for the coach. */
export function oohAccessWords(a: OohAccess): string {
  switch (a.reason) {
    case "coach":
      return "On: the coach always has Office Hours.";
    case "set_on":
      return "On: set by you.";
    case "set_off":
      return "Off: set by you.";
    case "earned":
      return `On: earned access until ${a.until}, then it follows the level (${a.level}).`;
    case "level":
      return `On: ${a.level} and up have Office Hours.`;
    default:
      return `Off: ${a.level} does not have Office Hours. Flip the switch to give it to this client.`;
  }
}
