/**
 * Recordings from Fathom (handoff revs 254 to 265), the rules with no database in them: what an arriving call becomes (by Danno's
 * series and time slots, rev 491, in recording-rules.ts),
 * who may see a published recording, which members were on a call, which action items land on whose plate, and whether a webhook
 * call is Fathom's. Everything here is covered by src/lib/engine/__tests__/recordings.test.ts.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RecordingActionItem, RecordingAudience, RecordingInvitee } from "@/db/schema";
import { ruleMatch, type RecordingRules } from "./recording-rules";

/** Programs, lowest first. Elite and Luxe are Academy and above (rev 265, default taken): they see what Academy sees. */
export const PROGRAM_ORDER = ["Accelerator", "Academy", "Elite", "Luxe"] as const;
const rank = (tier: string): number => {
  const i = PROGRAM_ORDER.indexOf(tier as (typeof PROGRAM_ORDER)[number]);
  // An unknown program is treated as Academy: the house default for a membership.
  return i < 0 ? 1 : i;
};

/** Whether a member of this program is in a program audience. "members" is decided by the named list, not here. */
export function programInAudience(audience: RecordingAudience, programTier: string): boolean {
  if (audience === "accelerator_academy") return true;
  if (audience === "academy") return rank(programTier) >= 1;
  return false;
}

export type Seer = { userId: string; programTier: string; role: "coach" | "client" };
export type Visible = { status: string; audience: RecordingAudience | null; audienceUserIds: string[] };

/** A published recording is visible to the members its audience names; a draft to nobody but the coach's own view. */
export function canSee(r: Visible, m: Seer): boolean {
  if (r.status !== "published" || !r.audience) return false;
  if (r.audience === "members") return r.audienceUserIds.includes(m.userId);
  return programInAudience(r.audience, m.programTier);
}

export const AUDIENCE_LABEL: Record<RecordingAudience, string> = { accelerator_academy: "Accelerator and Academy", academy: "Academy", members: "Named members" };
/** The program line a member sees on a recording. */
export function programLine(audience: RecordingAudience | null): string {
  if (audience === "accelerator_academy") return "Accelerator";
  if (audience === "academy") return "Academy";
  return "One-to-one";
}

export type Member = { userId: string; email: string; name: string };
/** The members whose email is on the call's invitee list: pre-ticked when the coach publishes a one-to-one. */
export function inviteeMembers(invitees: RecordingInvitee[], members: Member[]): string[] {
  const emails = new Set(invitees.map((i) => (i.email ?? "").trim().toLowerCase()).filter(Boolean));
  return members.filter((m) => emails.has(m.email.trim().toLowerCase())).map((m) => m.userId);
}

/**
 * Which action items land as suggested steps, and on whom: the assignee's email matches a member of the audience, or, with no
 * email, the assignee's name matches one member exactly (two members of the same name match nobody: never a guess).
 */
export function assignSteps(items: RecordingActionItem[], audience: Member[]): { itemIndex: number; userId: string; text: string; assigneeEmail: string | null }[] {
  const out: { itemIndex: number; userId: string; text: string; assigneeEmail: string | null }[] = [];
  items.forEach((it, itemIndex) => {
    if (!it.description.trim()) return;
    const email = (it.assigneeEmail ?? "").trim().toLowerCase();
    let hit: Member | undefined;
    if (email) hit = audience.find((m) => m.email.trim().toLowerCase() === email);
    else if (it.assigneeName) {
      const name = it.assigneeName.trim().toLowerCase();
      const byName = audience.filter((m) => m.name.trim().toLowerCase() === name);
      hit = byName.length === 1 ? byName[0] : undefined;
    }
    if (hit) out.push({ itemIndex, userId: hit.userId, text: it.description.trim(), assigneeEmail: email || null });
  });
  return out;
}

/** Fathom's meeting as its API and webhooks deliver it: the fields read here, nothing else. */
export type RawMeeting = {
  recording_id?: number | string;
  title?: string;
  meeting_title?: string;
  url?: string;
  share_url?: string;
  created_at?: string;
  recording_start_time?: string;
  recording_end_time?: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  calendar_invitees?: { name?: string; email?: string }[];
  default_summary?: { template_name?: string; markdown_formatted?: string } | null;
  action_items?: { description?: string; completed?: boolean; recording_timestamp?: string | number; recording_playback_url?: string; assignee?: { name?: string | null; email?: string | null } | null }[] | null;
};
export type MeetingFields = { fathomRecordingId: string; title: string; url: string; shareUrl: string | null; startedAt: string | null; endedAt: string | null; createdAt: string | null; summary: string | null; actionItems: RecordingActionItem[]; invitees: RecordingInvitee[] };

/** The row-shaped meeting, or null when there is no recording id to key it on. */
export function meetingFields(m: RawMeeting): MeetingFields | null {
  const fathomRecordingId = String(m.recording_id ?? "").trim();
  if (!fathomRecordingId) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    fathomRecordingId,
    title: str(m.title) ?? str(m.meeting_title) ?? "Untitled recording",
    url: str(m.url) ?? str(m.share_url) ?? "",
    shareUrl: str(m.share_url),
    startedAt: str(m.recording_start_time) ?? str(m.scheduled_start_time) ?? str(m.created_at),
    endedAt: str(m.recording_end_time) ?? str(m.scheduled_end_time),
    createdAt: str(m.created_at) ?? str(m.recording_start_time),
    summary: str(m.default_summary?.markdown_formatted),
    actionItems: (m.action_items ?? []).map((a) => ({ description: str(a.description) ?? "", completed: Boolean(a.completed), timestamp: a.recording_timestamp === undefined || a.recording_timestamp === null ? null : String(a.recording_timestamp), playbackUrl: str(a.recording_playback_url), assigneeName: str(a.assignee?.name), assigneeEmail: str(a.assignee?.email)?.toLowerCase() ?? null })).filter((a) => a.description),
    invitees: (m.calendar_invitees ?? []).map((i) => ({ name: str(i.name), email: str(i.email)?.toLowerCase() ?? null })).filter((i) => i.name || i.email),
  };
}

/**
 * What happens to a meeting that arrives (rev 491): a call whose title names one of the coach's series, or that started in one of
 * their time slots, publishes itself to that audience when it was recorded after the rules took effect; a slot match also gets
 * HelixOS's clear title. A call with nobody but the coach on it ("Just you") stays a draft, even inside a slot. Anything recorded
 * earlier is a draft, and Review suggests the same audience and title for the coach to publish.
 */
export function intake(fields: { title: string; startedAt: string | null; createdAt: string | null; invitees: RecordingInvitee[] }, from: string, rules: RecordingRules, coachEmails: string[]): { status: "draft" | "published"; audience: RecordingAudience | null; titleMatch: "exact" | "slot" | "none"; note: string | null; clearTitle: string | null } {
  const coaches = new Set(coachEmails.map((e) => e.trim().toLowerCase()));
  const justYou = !fields.invitees.some((i) => !coaches.has((i.email ?? "").trim().toLowerCase()));
  const m = ruleMatch(fields.title, fields.startedAt, rules);
  const titleMatch = m ? (m.by === "series" ? "exact" : "slot") : "none";
  const made = fields.startedAt ?? fields.createdAt;
  if (m && !justYou && made && made >= from) return { status: "published", audience: m.audience, titleMatch, note: null, clearTitle: m.clearTitle };
  return { status: "draft", audience: null, titleMatch, note: null, clearTitle: null };
}

/**
 * Standard Webhooks, as Fathom signs its deliveries: `webhook-id`, `webhook-timestamp` and `webhook-signature` ("v1,<base64>",
 * space-separated when several), HMAC-SHA256 over "<id>.<timestamp>.<body>" with the secret's bytes (base64 after "whsec_").
 * A timestamp more than five minutes off is refused, so a captured call can't be replayed later.
 */
export function verifyStandardWebhook(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowMs = Date.now()): { ok: true } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: "no webhook secret is stored" };
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: "missing webhook-id, webhook-timestamp or webhook-signature" };
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return { ok: false, reason: "timestamp is not within five minutes" };
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return { ok: false, reason: "the stored secret is not base64" };
  }
  if (!key.length) return { ok: false, reason: "the stored secret is empty" };
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  for (const part of headers.signature.split(/\s+/)) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let given: Buffer;
    try {
      given = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "signature does not match" };
}

/** The signature a sender computes: the mock and the walk sign with this, the route verifies with the function above. */
export function signStandardWebhook(secret: string, id: string, timestamp: string, body: string): string {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  return `v1,${createHmac("sha256", Buffer.from(raw, "base64")).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/** The hour window for View transcript presses, per member (rev 265): ten an hour. */
export const TRANSCRIPT_PRESSES_PER_HOUR = 10;

/** The title HelixOS shows: its own clear title when a time slot placed the call (rev 491), else Fathom's. */
export const shownTitle = (r: { title: string; clearTitle: string | null }): string => r.clearTitle ?? r.title;
