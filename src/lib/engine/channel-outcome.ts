/**
 * One row per channel: what happened to a post on each channel it was sent to, as a state with a word, a light, a time and,
 * on a failure, a reason. Pure. Three surfaces (the content card, the composer after scheduling, the Distribute page) render
 * this and nothing else, so they cannot disagree.
 *
 * Green is never shown on hope: "Published" means GoHighLevel's readback said published (or the client marked a pasted
 * channel posted themselves). A 2xx on the create call is "Sending" for an immediate post and "Scheduled" for a future one.
 * A row that is still sending twenty minutes past the time it should have gone is "Lost track", never a spinner and never
 * green. A channel we cannot publish to is "Copy and paste", which is not a failure and must not look like one. Every failure
 * carries a sentence, and the sentence is the one stored on the row (already a client sentence, see ghl-errors.ts); when the
 * row has none, the fallback says plainly that we do not know.
 */
import { PUBLISHABLE, platformName } from "./ghl-map";
import { CHANNEL_SPECS, type Channel } from "./repurpose";
import { formatDateTime, nowWallInTz, relativeDay } from "@/lib/dates";
import { HANDED_NOTE, HANDOFF_WORDS, HANDOFF_FALLBACK } from "./rung-drip";

export type OutcomeState = "published" | "scheduled" | "sending" | "failed" | "manual" | "unknown" | "handed" | "unhanded";
export const OUTCOME_WORD: Record<OutcomeState, string> = { published: "Published", scheduled: "Scheduled", sending: "Sending", failed: "Didn't send", manual: "Copy and paste", unknown: "Lost track", handed: HANDOFF_WORDS.handed, unhanded: HANDOFF_WORDS.unhanded };
/** A 2xx that carried no id: accepted, and the id is found from the planner's own list on the next check. */
export const ACCEPTED_WORD = "Accepted, id pending";
/** Sending past this many minutes after the time it should have gone becomes "Lost track". */
export const SENDING_CUTOFF_MINUTES = 20;
/** The reason on a failure whose stored note is empty: honest that we do not know, never the vendor's words. */
export const UNMAPPED_FAILURE = "This didn't send. We've logged why and it isn't something you did.";
const lostTrack = (platform: string) => `We lost track of this one. Check ${platform} before re-posting.`;

const labelOf = (channel: string) => CHANNEL_SPECS.find((c) => c.key === channel)?.label ?? channel;

export type OutcomeRow = {
  id: string;
  channel: string;
  groupId: string;
  status: string;
  postAt: string | null;
  postedAt: string | null;
  externalId: string | null;
  externalStatus: string | null;
  externalError: string | null;
  externalSyncedAt: string | null;
  createdAt: string;
};
export type Now = { wall: string; iso: string; today: string; tz: string };
/** Now, in the shape the rule reads: the member's wall time, the instant, their day and zone. */
export const nowFor = (v: { tz: string; today: string }, at: Date = new Date()): Now => ({ wall: nowWallInTz(v.tz, at), iso: at.toISOString(), today: v.today, tz: v.tz });
export type ChannelOutcome = { id: string; channel: string; label: string; state: OutcomeState; word: string; when: string | null; reason: string | null; canCheck: boolean };

const wallMs = (wall: string) => {
  const p = wall.match(/\d+/g)?.map(Number) ?? [];
  return p.length >= 5 ? Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5] ?? 0) : NaN;
};
const isoMs = (iso: string) => new Date(iso).getTime();
/** A wall time as the client reads it: "Tomorrow 8:00 AM", "Dec 15 10:30 AM". No zone conversion: it is already their wall time. */
export function whenText(wall: string, today: string): string {
  const p = wall.match(/\d+/g)?.map(Number) ?? [];
  if (p.length < 5) return wall;
  const h = p[3] % 12 || 12;
  return `${relativeDay(wall.slice(0, 10), today)} ${h}:${String(p[4]).padStart(2, "0")} ${p[3] < 12 ? "AM" : "PM"}`;
}

const isManual = (row: OutcomeRow) => row.groupId !== "" || !PUBLISHABLE[row.channel as Channel]?.via;
/** A HelixOS-side refusal the client can fix was once stored as "manual"; it is a failure with a reason, not a pasted channel. */
const fixableSkip = (note: string | null) => Boolean(note && /chosen for this channel|Connect your GoHighLevel|GHL user ID|schedule time couldn't be read|need a photo or video/i.test(note));

export function outcomeOf(row: OutcomeRow, now: Now, cutoffMinutes = SENDING_CUTOFF_MINUTES): ChannelOutcome {
  const label = labelOf(row.channel);
  const base = { id: row.id, channel: row.channel, label, canCheck: Boolean(row.externalId) || row.externalStatus === "accepted" };
  const platform = platformName(row.channel);
  const ext = row.externalStatus;
  if (isManual(row) || (ext === "manual" && !fixableSkip(row.externalError))) {
    if (row.status === "posted") return { ...base, state: "published", word: "Posted by you", when: row.postedAt ? formatDateTime(row.postedAt, now.tz) : null, reason: null };
    return { ...base, state: "manual", word: OUTCOME_WORD.manual, when: null, reason: row.groupId ? "Groups are posted by hand." : (PUBLISHABLE[row.channel as Channel]?.note ?? "Not something we can publish for you.") };
  }
  if (ext === "published") return { ...base, state: "published", word: OUTCOME_WORD.published, when: row.postedAt ? formatDateTime(row.postedAt, now.tz) : row.externalSyncedAt ? formatDateTime(row.externalSyncedAt, now.tz) : null, reason: null };
  if (ext === "deleted") return { ...base, state: "failed", word: "Deleted", when: null, reason: row.externalError?.trim() || DELETED_IN_PLANNER };
  if (ext === "failed" || (ext === "manual" && fixableSkip(row.externalError))) return { ...base, state: "failed", word: OUTCOME_WORD.failed, when: null, reason: row.externalError?.trim() || UNMAPPED_FAILURE };
  // Accepted or still on its way: scheduled while its time is ahead; sending until the cutoff after it; then lost track.
  const accepted = ext === "scheduled" || ext === "in_progress" || ext === "pending" || ext === "in_review" || ext === "notification_sent" || ext === "accepted";
  if (row.postAt && ext === "scheduled" && wallMs(row.postAt) > wallMs(now.wall)) return { ...base, state: "scheduled", word: OUTCOME_WORD.scheduled, when: whenText(row.postAt, now.today), reason: null };
  const sinceMs = row.postAt && accepted ? wallMs(now.wall) - wallMs(row.postAt) : isoMs(now.iso) - isoMs(row.externalSyncedAt ?? row.createdAt);
  if (Number.isFinite(sinceMs) && sinceMs > cutoffMinutes * 60_000) return { ...base, state: "unknown", word: OUTCOME_WORD.unknown, when: null, reason: lostTrack(platform) };
  return { ...base, state: "sending", word: ext === "accepted" ? ACCEPTED_WORD : OUTCOME_WORD.sending, when: row.postAt && !accepted ? whenText(row.postAt, now.today) : null, reason: null };
}

/** What the readback says about a post the planner no longer holds. */
export const DELETED_IN_PLANNER = "This post was deleted in the Social Planner.";

/**
 * The comment ladder's row: handed to Community Loyalty at a time, or not handed off with the reasons. Never a publish word,
 * because HelixOS is not told when a rung lands. Null when the handoff is not set up for this member at all.
 */
export function handoffOutcome(handoff: { handedAt: string } | null, reasons: string[] | null, now: Now, fallback = false): ChannelOutcome | null {
  if (handoff) return { id: "comments", channel: "comments", label: "Comments", state: "handed", word: HANDOFF_WORDS.handed, when: formatDateTime(handoff.handedAt, now.tz), reason: HANDED_NOTE, canCheck: false };
  if (reasons === null) return null;
  // A refusal once the post is public names what to do instead, in the same breath: the rungs are ready to post by hand.
  return { id: "comments", channel: "comments", label: "Comments", state: "unhanded", word: HANDOFF_WORDS.unhanded, when: null, reason: [...reasons, ...(fallback ? [HANDOFF_FALLBACK] : [])].join(" "), canCheck: false };
}

/** The rows a post has outcomes for: drafts and skipped versions are not outcomes. */
export function outcomesFor(rows: OutcomeRow[], now: Now, extra: (ChannelOutcome | null)[] = []): ChannelOutcome[] {
  return [...rows.filter((r) => r.status !== "draft" && r.status !== "skipped").map((r) => outcomeOf(r, now)), ...extra.filter((x): x is ChannelOutcome => Boolean(x))];
}

const SEVERITY: OutcomeState[] = ["failed", "unknown", "sending", "scheduled", "published", "unhanded", "handed", "manual"];

export type OutcomeSummary = { headline: string; worst: OutcomeState | null; counts: Record<OutcomeState, number>; total: number };

/** The card's one line: the worst outcome wins and the count says how many. Never "Posted" when anything did not send. */
export function summarize(outcomes: ChannelOutcome[]): OutcomeSummary {
  const counts: Record<OutcomeState, number> = { published: 0, scheduled: 0, sending: 0, failed: 0, manual: 0, unknown: 0, handed: 0, unhanded: 0 };
  for (const o of outcomes) counts[o.state]++;
  const total = outcomes.length - counts.manual - counts.handed - counts.unhanded;
  const worst = SEVERITY.find((s) => counts[s] > 0) ?? null;
  const parts: string[] = [];
  if (total > 0) {
    if (counts.failed || counts.unknown || counts.sending || counts.published) parts.push(`${counts.published} of ${total} published`);
    if (counts.failed) parts.push(`${counts.failed} didn't send`);
    if (counts.unknown) parts.push(`${counts.unknown} lost track`);
    if (counts.sending) parts.push(`${counts.sending} sending`);
    if (counts.scheduled) parts.push(`${counts.scheduled} scheduled`);
  }
  if (counts.manual) parts.push(`${counts.manual} to paste`);
  if (counts.handed) parts.push("comments handed to Community Loyalty");
  if (counts.unhanded) parts.push("comments not handed off");
  return { headline: parts.join(" · ") || "No versions yet", worst, counts, total };
}
