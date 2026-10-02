/**
 * Recordings from Fathom (handoff revs 254 to 265), the rules with no database in them: which title publishes itself and to whom,
 * who may see a published recording, which members were on a call, which action items land on whose plate, and whether a webhook
 * call is Fathom's. Everything here is covered by src/lib/engine/__tests__/recordings.test.ts.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RecordingActionItem, RecordingAudience, RecordingInvitee } from "@/db/schema";

/** The two phrases Danno keeps exact in Fathom from now on (rev 261), matched case-insensitively as whole phrases. */
export const PROGRAM_PHRASES = { accelerator: "evolve omega accelerator", academy: "evolve omega academy" } as const;
const BRAND = "evolve omega";

export type TitleMatch = { match: "exact"; audience: RecordingAudience; program: "Accelerator" | "Academy" } | { match: "close"; note: string } | { match: "none" };

const edit = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/**
 * Exact: the title contains "Evolve Omega Accelerator" or "Evolve Omega Academy". Close: it carries "Evolve Omega" and the word
 * after it is a near miss of either program word (a prefix of four letters or more, or within three edits: "Accel", "Acadamy"),
 * which lands as a draft with "title didn't match". Anything else is none: a draft with no note about its title.
 */
export function titleMatch(title: string): TitleMatch {
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  if (t.includes(PROGRAM_PHRASES.accelerator)) return { match: "exact", audience: "accelerator_academy", program: "Accelerator" };
  if (t.includes(PROGRAM_PHRASES.academy)) return { match: "exact", audience: "academy", program: "Academy" };
  const at = t.indexOf(BRAND);
  if (at < 0) return { match: "none" };
  const next = t.slice(at + BRAND.length).trim().split(/[^a-z]+/)[0] ?? "";
  if (!next) return { match: "none" };
  const near = (word: string) => (next.length >= 4 && word.startsWith(next)) || edit(next, word) <= 3;
  if (near("accelerator") || near("academy")) return { match: "close", note: `title didn't match: "${title.trim()}" is close to Evolve Omega ${near("accelerator") ? "Accelerator" : "Academy"} but not exact` };
  return { match: "none" };
}

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
 * What happens to a meeting that arrives: made after switch-on with an exact title, it publishes to its program audience at once;
 * a close title is a draft with the note; a title before switch-on is a draft (the backfill, R2, handles those by time slot).
 */
export function intake(fields: { title: string; startedAt: string | null; createdAt: string | null }, enabledAt: string): { status: "draft" | "published"; audience: RecordingAudience | null; titleMatch: TitleMatch["match"]; note: string | null } {
  const tm = titleMatch(fields.title);
  const made = fields.startedAt ?? fields.createdAt;
  const afterSwitchOn = Boolean(made && made >= enabledAt);
  if (tm.match === "exact") {
    if (afterSwitchOn) return { status: "published", audience: tm.audience, titleMatch: "exact", note: null };
    return { status: "draft", audience: tm.audience, titleMatch: "exact", note: "recorded before Recordings was switched on: publish it yourself, or let the backfill place it" };
  }
  if (tm.match === "close") return { status: "draft", audience: null, titleMatch: "close", note: tm.note };
  return { status: "draft", audience: null, titleMatch: "none", note: null };
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
