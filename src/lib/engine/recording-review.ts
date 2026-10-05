/**
 * Reviewing the drafts (rev 488; the coach's rules, rev 491): which group a call belongs to, who it suggests publishing to, and
 * who was on it, said without anyone's email. Pure: the page and the bulk actions read the same answers.
 */
import type { RecordingAudience, RecordingInvitee } from "@/db/schema";
import type { Member } from "./recordings";
import { normTitle, slotLabel, type RecordingRules, type RuleMatch } from "./recording-rules";

/** A group on the To review list: one of the coach's series or slots, the one-to-ones, the rest, or the calls with only the coach on them. */
export type Group = { key: string; label: string; order: number };
const slug = (s: string) => normTitle(s).replace(/ /g, "-");
export const JUST_YOU: Group = { key: "just_you", label: "Just you", order: 10000 };
const ONE_TO_ONE: Group = { key: "one_to_one", label: "One-to-ones", order: 9000 };
const OTHER: Group = { key: "other", label: "Other", order: 9001 };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const emailOf = (i: RecordingInvitee) => (i.email ?? "").trim().toLowerCase();

/** Who was on the call besides the coach (or coaches): those are the people that count. */
export function othersOnCall(invitees: RecordingInvitee[], coachEmails: string[]): RecordingInvitee[] {
  const coaches = new Set(coachEmails.map((e) => e.trim().toLowerCase()));
  return invitees.filter((i) => !coaches.has(emailOf(i)));
}

/**
 * The call's group (rev 491): "Just you" when nobody but the coach was on it; else the series its title names or the slot it
 * started in, by the coach's rules; else a one-to-one by its title ("Randy and Danno"); else Other.
 */
export function groupOf(title: string, invitees: RecordingInvitee[], coachEmails: string[], match: RuleMatch | null, rules: RecordingRules): Group {
  if (!othersOnCall(invitees, coachEmails).length) return JUST_YOU;
  if (match?.by === "series") return { key: `series-${slug(match.rule.name)}`, label: match.rule.name, order: Math.max(0, rules.series.findIndex((s) => normTitle(s.name) === normTitle(match.rule.name))) };
  if (match?.by === "slot") return { key: `slot-${slug(match.rule.name)}`, label: match.rule.name, order: 1000 + Math.max(0, rules.slots.findIndex((s) => s.name === match.rule.name)) };
  const t = norm(title);
  if (/\S \band\b \S/.test(t) || /one[- ]to[- ]one|1:1/.test(t)) return ONE_TO_ONE;
  return OTHER;
}

/** What a group is remembered by: the group itself for a series or slot, the title (dates and numbers aside) for the rest. */
export function groupKey(group: Group, title: string): string {
  return group.key === ONE_TO_ONE.key || group.key === OTHER.key ? `${group.key}:${norm(title).replace(/[\d–—\-:#.,]+/g, " ").replace(/\s+/g, " ").trim()}` : group.key;
}

export type Suggestion = { audience: RecordingAudience; userIds: string[]; why: "series" | "slot" | "title" | "last" | "one_member" | "one_to_one"; detail?: string };
export type PublishedBefore = { key: string; audience: RecordingAudience; audienceUserIds: string[]; publishedAt: string };

/**
 * Who to publish to: the coach's own rules first (the series the title names, or the slot it started in); else where the coach
 * published this group last time; else the one member on the call, or the members on a one-to-one. Null when there is nothing
 * to go on, and always for a call with only the coach on it: the coach chooses.
 */
export function suggestAudience(group: Group, key: string, match: RuleMatch | null, onCall: string[], before: PublishedBefore[]): Suggestion | null {
  if (group.key === JUST_YOU.key) return null;
  if (match?.by === "series") return { audience: match.audience, userIds: [], why: "series", detail: match.rule.name };
  if (match?.by === "slot") return { audience: match.audience, userIds: [], why: "slot", detail: `${slotLabel(match.rule)}, your ${match.rule.name} time` };
  const last = before.filter((b) => b.key === key).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  if (last) {
    if (last.audience !== "members") return { audience: last.audience, userIds: [], why: "last" };
    const ids = onCall.length ? onCall : last.audienceUserIds;
    if (ids.length) return { audience: "members", userIds: ids, why: "last" };
  }
  if (onCall.length === 1) return { audience: "members", userIds: onCall, why: "one_member" };
  if (group.key === ONE_TO_ONE.key && onCall.length) return { audience: "members", userIds: onCall, why: "one_to_one" };
  return null;
}

/** Why, in one sentence, on Review. */
export function whyLine(s: Suggestion): string {
  switch (s.why) {
    case "series":
      return `Its title names your series "${s.detail}".`;
    case "slot":
      return `It started at ${s.detail}.`;
    case "title":
      return "Its title named the program when it arrived.";
    case "last":
      return "You published the last call like this there.";
    case "one_member":
      return "One member was on the call, so it's just for them.";
    case "one_to_one":
      return "It's a one-to-one, so it's just for the members on it.";
  }
}

/** "14 people: 9 members, 4 guests, and you": names for members only, never a guest's email. */
export function attendeeSummary(invitees: RecordingInvitee[], members: Member[], coachEmails: string[]): { people: number; memberNames: string[]; guests: number; coachOn: boolean; line: string } {
  const others = othersOnCall(invitees, coachEmails);
  const coachOn = others.length < invitees.length;
  const byEmail = new Map(members.map((m) => [m.email.trim().toLowerCase(), m.name]));
  const memberNames = others.map((i) => byEmail.get(emailOf(i))).filter((n): n is string => Boolean(n));
  const guests = others.length - memberNames.length;
  const parts = [`${memberNames.length} member${memberNames.length === 1 ? "" : "s"}`, `${guests} guest${guests === 1 ? "" : "s"}`];
  const line = `${invitees.length} ${invitees.length === 1 ? "person" : "people"}: ${parts.join(", ")}${coachOn ? ", and you" : ""}`;
  return { people: invitees.length, memberNames, guests, coachOn, line };
}

/** Up to three names, then "+N". */
export const fewNames = (names: string[], max = 3): string => (names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} +${names.length - max}`);

/** The call's length in minutes, or null. */
export function minutesOf(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const m = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000);
  return Number.isFinite(m) && m > 0 ? m : null;
}
