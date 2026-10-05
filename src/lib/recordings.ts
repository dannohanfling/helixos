/**
 * Recordings from Fathom (R1), the server side: the workspace's connection (the coach's key), what an arriving meeting becomes,
 * Sync now, publishing, the transcript read once and kept, and who sees what. Only the coach's key ever calls Fathom from here;
 * nothing in this file is ever sent to Community Loyalty or GoHighLevel, and no Body data comes near it.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { RecordingAudience } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { open } from "@/lib/crypto";
import { logSync } from "@/lib/integrations";
import { listMeetingsFull, readTranscript, type FathomResult } from "@/lib/fathom";
import { assignSteps, canSee, intake, inviteeMembers, meetingFields, type Member, type RawMeeting } from "@/lib/engine/recordings";
import { JUST_YOU, attendeeSummary, groupKey, groupOf, minutesOf, suggestAudience, type PublishedBefore, type Suggestion } from "@/lib/engine/recording-review";
import { readRules, ruleMatch, type RecordingRules } from "@/lib/engine/recording-rules";

export const FATHOM_PROVIDER = "fathom";
/** The first Sync now reaches back this far before switch-on, so the coach has recent calls to publish by hand on day one. */
const FIRST_SYNC_DAYS = 30;
/** A later sync overlaps the last one by a day: a webhook missed on the day of an outage is picked up without listing everything. */
const RESYNC_OVERLAP_MS = 24 * 3600 * 1000;
const MAX_PAGES = 20;

export async function workspaceFathom(workspaceId: string) {
  return db.query.fathomWorkspaceConnections.findFirst({ where: eq(schema.fathomWorkspaceConnections.workspaceId, workspaceId) });
}

/** The usable workspace key, or null (not connected, the last check failed, or sealed under another secret). */
export async function workspaceFathomKey(workspaceId: string): Promise<{ key: string; conn: schema.FathomWorkspaceConnection } | null> {
  const conn = await workspaceFathom(workspaceId);
  if (!conn || conn.lastError) return null;
  const key = open(conn.keyEncrypted);
  return key ? { key, conn } : null;
}

export const paceKeyFor = (workspaceId: string) => `ws:${workspaceId}`;

export type ClientMember = Member & { programTier: string; membershipId: string };
/** The workspace's clients still in it, with the email a call's invitee list is matched against. */
export async function clientMembers(workspaceId: string): Promise<ClientMember[]> {
  const ms = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "client"), isNull(schema.memberships.removedAt)) });
  if (!ms.length) return [];
  const users = await db.query.users.findMany({ where: inArray(schema.users.id, ms.map((m) => m.userId)) });
  const byId = new Map(users.map((u) => [u.id, u]));
  return ms.flatMap((m) => {
    const u = byId.get(m.userId);
    return u ? [{ userId: u.id, email: u.email, name: u.name, programTier: m.programTier, membershipId: m.id }] : [];
  });
}

/** The workspace's publishing rules (rev 491; the defaults until the coach edits them) and when they took effect. */
export async function workspaceRules(workspaceId: string): Promise<{ rules: RecordingRules; from: string | null }> {
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId), columns: { recordingRules: true, recordingRulesFrom: true } });
  return { rules: readRules(ws?.recordingRules ?? null), from: ws?.recordingRulesFrom ?? null };
}

/** The coaches' emails: a call with nobody else on it is "Just you". */
export async function coachEmailsOf(workspaceId: string): Promise<string[]> {
  const ms = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "coach")) });
  if (!ms.length) return [];
  return (await db.query.users.findMany({ where: inArray(schema.users.id, ms.map((m) => m.userId)) })).map((u) => u.email);
}

/** Who published a recording when no person did: the rules (rev 491), or the rev 261 title phrases before them. */
export const BY_RULES = new Set(["rules", "title"]);

/** The members a published recording reaches. */
export function audienceOf(r: schema.Recording, members: ClientMember[]): ClientMember[] {
  return members.filter((m) => canSee(r, { userId: m.userId, programTier: m.programTier, role: "client" }));
}

/** Suggested steps for the audience: Fathom's assignee matched a member. Rows that already exist (any state) are left alone. */
async function suggestSteps(r: schema.Recording, members: ClientMember[]): Promise<number> {
  const audience = audienceOf(r, members);
  const steps = assignSteps(r.actionItems, audience);
  let made = 0;
  for (const s of steps) {
    const res = await db
      .insert(schema.recordingSteps)
      .values({ id: newId(), workspaceId: r.workspaceId, userId: s.userId, recordingId: r.id, itemIndex: s.itemIndex, text: s.text, assigneeEmail: s.assigneeEmail })
      .onConflictDoNothing();
    made += res.rowsAffected ?? 0;
  }
  return made;
}

export type IntakeOutcome = { recording: schema.Recording; created: boolean; steps: number };
export type IntakeContext = { members: ClientMember[]; rules: RecordingRules; rulesFrom: string | null; coachEmails: string[] };
export async function intakeContext(workspaceId: string): Promise<IntakeContext> {
  const [members, wr, coachEmails] = await Promise.all([clientMembers(workspaceId), workspaceRules(workspaceId), coachEmailsOf(workspaceId)]);
  return { members, rules: wr.rules, rulesFrom: wr.from, coachEmails };
}

/**
 * One meeting in: new rows take the intake decision (published at once by the coach's rules after switch-on, otherwise a draft); a
 * meeting already here keeps its status and audience and only refreshes what Fathom may have filled in since (summary, items).
 */
export async function ingestMeeting(conn: schema.FathomWorkspaceConnection, raw: RawMeeting, source: "webhook" | "sync" | "backfill", context?: IntakeContext): Promise<IntakeOutcome | null> {
  const f = meetingFields(raw);
  if (!f) return null;
  const existing = await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, conn.workspaceId), eq(schema.recordings.fathomRecordingId, f.fathomRecordingId)) });
  const ctx = context ?? (await intakeContext(conn.workspaceId));
  const ms = ctx.members;
  if (existing) {
    const patch: Partial<typeof schema.recordings.$inferInsert> = {};
    if (f.summary && !existing.summary) patch.summary = f.summary;
    if (f.actionItems.length && !existing.actionItems.length) patch.actionItems = f.actionItems;
    if (f.invitees.length && !existing.invitees.length) patch.invitees = f.invitees;
    if (f.endedAt && !existing.endedAt) patch.endedAt = f.endedAt;
    if (Object.keys(patch).length) await db.update(schema.recordings).set(patch).where(eq(schema.recordings.id, existing.id));
    const fresh = { ...existing, ...patch } as schema.Recording;
    const steps = fresh.status === "published" ? await suggestSteps(fresh, ms) : 0;
    return { recording: fresh, created: false, steps };
  }
  // The rules publish only what was recorded after both the switch-on and the rules themselves.
  const from = ctx.rulesFrom && ctx.rulesFrom > conn.enabledAt ? ctx.rulesFrom : conn.enabledAt;
  const d = intake(f, from, ctx.rules, ctx.coachEmails);
  const row: typeof schema.recordings.$inferInsert = {
    id: newId(),
    workspaceId: conn.workspaceId,
    fathomRecordingId: f.fathomRecordingId,
    title: f.title,
    clearTitle: d.clearTitle,
    url: f.url,
    shareUrl: f.shareUrl,
    startedAt: f.startedAt,
    endedAt: f.endedAt,
    summary: f.summary,
    actionItems: f.actionItems,
    invitees: f.invitees,
    source,
    titleMatch: d.titleMatch,
    note: d.note,
    audience: d.audience,
    status: d.status,
    publishedAt: d.status === "published" ? nowIso() : null,
    // Published by the rules, not a person.
    publishedBy: d.status === "published" ? "rules" : null,
  };
  await db.insert(schema.recordings).values(row);
  const recording = (await db.query.recordings.findFirst({ where: eq(schema.recordings.id, row.id) }))!;
  const steps = recording.status === "published" ? await suggestSteps(recording, ms) : 0;
  return { recording, created: true, steps };
}

/**
 * Sync now: the meetings Fathom lists since the last sync (or the last thirty days, the first time), each through intake.
 * Transcripts are never requested here. The outcome is written on the connection in plain words and logged in sync_events.
 */
export async function syncRecordings(workspaceId: string, by: string | null): Promise<{ ok: true; created: number; seen: number; published: number } | { ok: false; error: string }> {
  const wk = await workspaceFathomKey(workspaceId);
  if (!wk) return { ok: false, error: "Fathom isn't connected for this workspace, or its key failed its last check." };
  const { key, conn } = wk;
  const since = conn.lastSyncAt ? new Date(new Date(conn.lastSyncAt).getTime() - RESYNC_OVERLAP_MS).toISOString() : new Date(new Date(conn.enabledAt).getTime() - FIRST_SYNC_DAYS * 86400000).toISOString();
  const ctx = await intakeContext(workspaceId);
  let cursor: string | null = null;
  let created = 0;
  let seen = 0;
  let published = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const r: FathomResult<{ meetings: RawMeeting[]; nextCursor: string | null }> = await listMeetingsFull(paceKeyFor(workspaceId), key, { createdAfter: since, cursor });
    if (!r.ok) {
      await db.update(schema.fathomWorkspaceConnections).set({ lastSyncNote: r.error }).where(eq(schema.fathomWorkspaceConnections.id, conn.id));
      await logSync({ workspaceId, userId: by, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.sync", payload: { since, page }, status: "failed", note: r.error });
      return { ok: false, error: r.error };
    }
    for (const m of r.data.meetings) {
      const out = await ingestMeeting(conn, m, "sync", ctx);
      if (!out) continue;
      seen++;
      if (out.created) created++;
      if (out.created && out.recording.status === "published") published++;
    }
    cursor = r.data.nextCursor;
    if (!cursor) break;
  }
  const note = `${seen} listed, ${created} new, ${published} published by your rules`;
  await db.update(schema.fathomWorkspaceConnections).set({ lastSyncAt: nowIso(), lastSyncNote: note }).where(eq(schema.fathomWorkspaceConnections.id, conn.id));
  await logSync({ workspaceId, userId: by, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.sync", payload: { since, seen, created, published }, status: "received", note });
  return { ok: true, created, seen, published };
}

/** The coach publishes a draft (or changes who a recording is for): the audience, or the named members for a one-to-one. */
export async function publishRecording(r: schema.Recording, audience: RecordingAudience, userIds: string[], byUserId: string): Promise<schema.Recording> {
  const members = await clientMembers(r.workspaceId);
  const named = audience === "members" ? userIds.filter((id) => members.some((m) => m.userId === id)) : [];
  // A call its slot placed keeps HelixOS's clear title once published (rev 491); one already given stays.
  const clearTitle = r.clearTitle ?? ruleMatch(r.title, r.startedAt, (await workspaceRules(r.workspaceId)).rules)?.clearTitle ?? null;
  await db.update(schema.recordings).set({ status: "published", audience, audienceUserIds: named, clearTitle, publishedAt: r.publishedAt ?? nowIso(), publishedBy: byUserId, note: null }).where(eq(schema.recordings.id, r.id));
  const fresh = (await db.query.recordings.findFirst({ where: eq(schema.recordings.id, r.id) }))!;
  await suggestSteps(fresh, members);
  return fresh;
}

export async function unpublishRecording(r: schema.Recording): Promise<void> {
  // Steps nobody acted on go with the publication; an accepted step is already the member's task and a dismissed one their choice.
  await db.delete(schema.recordingSteps).where(and(eq(schema.recordingSteps.recordingId, r.id), eq(schema.recordingSteps.state, "suggested")));
  await db.update(schema.recordings).set({ status: "draft", publishedAt: null, publishedBy: null, note: "unpublished by the coach" }).where(eq(schema.recordings.id, r.id));
}

/**
 * The transcript, read from Fathom with the coach's key the first time anyone asks and kept on the recording, so every later
 * press opens from HelixOS. Every fetch is a sync_events row naming who asked. Never called while switched (the actions check).
 */
export async function fetchTranscript(r: schema.Recording, askedBy: string, via: "member" | "coach"): Promise<{ ok: true; entries: schema.RecordingTranscriptEntry[]; fetched: boolean } | { ok: false; error: string }> {
  if (r.transcript) return { ok: true, entries: r.transcript, fetched: false };
  const wk = await workspaceFathomKey(r.workspaceId);
  if (!wk) {
    const error = "The transcript can't be fetched: Fathom isn't connected for this workspace.";
    await logSync({ workspaceId: r.workspaceId, userId: askedBy, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.transcript", payload: { recordingId: r.id, via }, status: "failed", note: error });
    return { ok: false, error };
  }
  const t = await readTranscript(paceKeyFor(r.workspaceId), wk.key, r.fathomRecordingId);
  if (!t.ok) {
    await logSync({ workspaceId: r.workspaceId, userId: askedBy, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.transcript", payload: { recordingId: r.id, via }, status: "failed", note: t.error });
    return { ok: false, error: t.error };
  }
  const entries: schema.RecordingTranscriptEntry[] = t.data.map((e) => ({ speaker: e.speaker, email: e.email, text: e.text, timestamp: e.timestamp }));
  await db.update(schema.recordings).set({ transcript: entries, transcriptFetchedAt: nowIso() }).where(eq(schema.recordings.id, r.id));
  await logSync({ workspaceId: r.workspaceId, userId: askedBy, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.transcript", payload: { recordingId: r.id, via, lines: entries.length }, status: "received", note: `Transcript fetched (${via})` });
  return { ok: true, entries, fetched: true };
}

export type Seer = { userId: string; programTier: string; role: "coach" | "client" };

/** The published recordings this member may see, newest first. */
export async function visibleRecordings(workspaceId: string, seer: Seer): Promise<schema.Recording[]> {
  const rows = await db.query.recordings.findMany({ where: and(eq(schema.recordings.workspaceId, workspaceId), eq(schema.recordings.status, "published")), orderBy: [desc(schema.recordings.startedAt), desc(schema.recordings.createdAt)] });
  return rows.filter((r) => canSee(r, seer));
}

/** One recording, if this member may see it. */
export async function visibleRecording(workspaceId: string, id: string, seer: Seer): Promise<schema.Recording | null> {
  const r = await db.query.recordings.findFirst({ where: and(eq(schema.recordings.id, id), eq(schema.recordings.workspaceId, workspaceId)) });
  return r && canSee(r, seer) ? r : null;
}

/** Whether the Recordings item shows in a client's menu: something is published for them. */
export async function hasVisibleRecordings(workspaceId: string, seer: Seer): Promise<boolean> {
  return (await visibleRecordings(workspaceId, seer)).length > 0;
}

/** A member's steps on these recordings, by recording and item. */
export async function stepsFor(userId: string, recordingIds: string[]): Promise<Map<string, schema.RecordingStep>> {
  if (!recordingIds.length) return new Map();
  const rows = await db.query.recordingSteps.findMany({ where: and(eq(schema.recordingSteps.userId, userId), inArray(schema.recordingSteps.recordingId, recordingIds)) });
  return new Map(rows.map((s) => [`${s.recordingId}:${s.itemIndex}`, s]));
}

/** What reviewing the drafts needs once per page (rev 488): the members, the coaches' emails, the rules, and where each group went before. */
export type ReviewContext = { members: ClientMember[]; coachEmails: string[]; rules: RecordingRules; before: PublishedBefore[] };
export async function reviewContext(workspaceId: string): Promise<ReviewContext> {
  const [members, coachEmails, wr, published] = await Promise.all([
    clientMembers(workspaceId),
    coachEmailsOf(workspaceId),
    workspaceRules(workspaceId),
    db.query.recordings.findMany({ where: and(eq(schema.recordings.workspaceId, workspaceId), eq(schema.recordings.status, "published")) }),
  ]);
  const rules = wr.rules;
  const before: PublishedBefore[] = published
    .filter((r) => r.audience && !BY_RULES.has(r.publishedBy ?? ""))
    .map((r) => ({ key: groupKey(groupOf(r.title, r.invitees, coachEmails, ruleMatch(r.title, r.startedAt, rules), rules), r.title), audience: r.audience!, audienceUserIds: r.audienceUserIds, publishedAt: r.publishedAt ?? r.createdAt }));
  return { members, coachEmails, rules, before };
}

/**
 * One call, read for review: its group, who was on it (names, never a guest's email), its length, the suggested audience and,
 * when its slot placed it, HelixOS's clear title (Fathom's stays under it).
 */
export function reviewOf(r: schema.Recording, c: ReviewContext) {
  const match = ruleMatch(r.title, r.startedAt, c.rules);
  const group = groupOf(r.title, r.invitees, c.coachEmails, match, c.rules);
  const key = groupKey(group, r.title);
  const onCall = inviteeMembers(r.invitees, c.members);
  // The coach's rules first; then an audience the rev 261 title phrases set on arrival; then what was done before.
  const preset: Suggestion | null = group.key !== JUST_YOU.key && !match && r.audience && r.audience !== "members" ? { audience: r.audience, userIds: [], why: "title" } : null;
  const suggestion = preset ?? suggestAudience(group, key, match, onCall, c.before);
  const clearTitle = r.clearTitle ?? (group.key !== JUST_YOU.key ? (match?.clearTitle ?? null) : null);
  return { group, key, match, onCall, suggestion, clearTitle, attendees: attendeeSummary(r.invitees, c.members, c.coachEmails), minutes: minutesOf(r.startedAt, r.endedAt) };
}

/** Skipped: not for members, kept and recoverable. A published call is unpublished first, so nothing of it stays with members. */
export async function skipRecording(r: schema.Recording): Promise<void> {
  if (r.status === "published") await unpublishRecording(r);
  await db.update(schema.recordings).set({ status: "skipped", note: null }).where(eq(schema.recordings.id, r.id));
}
export async function restoreRecording(r: schema.Recording): Promise<void> {
  await db.update(schema.recordings).set({ status: "draft" }).where(and(eq(schema.recordings.id, r.id), eq(schema.recordings.status, "skipped")));
}

/* ───────────── Recordings for members (revs 496 to 498): seen, new, and the action items still to decide ───────────── */

/** Seen (rev 498): opened in HelixOS or Watch in Fathom pressed. The first time is kept; a switched coach never marks it. */
export async function markSeen(workspaceId: string, userId: string, recordingId: string): Promise<void> {
  await db.insert(schema.recordingViews).values({ id: newId(), workspaceId, userId, recordingId, seenAt: nowIso() }).onConflictDoNothing();
}

/** Which of these recordings the member has seen. */
export async function seenIds(userId: string, recordingIds: string[]): Promise<Set<string>> {
  if (!recordingIds.length) return new Set();
  const rows = await db.query.recordingViews.findMany({ where: and(eq(schema.recordingViews.userId, userId), inArray(schema.recordingViews.recordingId, recordingIds)) });
  return new Set(rows.map((r) => r.recordingId));
}

/** The published recordings this member hasn't seen yet: the menu's count and Today's line. */
export async function newRecordings(workspaceId: string, seer: Seer): Promise<schema.Recording[]> {
  const rows = await visibleRecordings(workspaceId, seer);
  const seen = await seenIds(seer.userId, rows.map((r) => r.id));
  return rows.filter((r) => !seen.has(r.id));
}

/** "Mark all as seen": every recording this member can see, now. */
export async function markAllSeen(workspaceId: string, seer: Seer): Promise<number> {
  const fresh = await newRecordings(workspaceId, seer);
  for (const r of fresh) await markSeen(workspaceId, seer.userId, r.id);
  return fresh.length;
}

/** Who has seen each recording, for the coach's "Seen by N of M". */
export async function seenBy(recordingIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!recordingIds.length) return out;
  const rows = await db.query.recordingViews.findMany({ where: inArray(schema.recordingViews.recordingId, recordingIds) });
  for (const r of rows) out.set(r.recordingId, (out.get(r.recordingId) ?? new Set()).add(r.userId));
  return out;
}

/**
 * The member's action items still to decide (rev 497): per published call they can see, the items Fathom assigned to their
 * email that they have neither made a task nor let go. Newest call first.
 */
export async function openItemsFor(workspaceId: string, seer: Seer & { email: string }): Promise<{ recording: schema.Recording; count: number }[]> {
  const rows = (await visibleRecordings(workspaceId, seer)).filter((r) => r.actionItems.some((i) => (i.assigneeEmail ?? "").toLowerCase() === seer.email.toLowerCase()));
  if (!rows.length) return [];
  const steps = await stepsFor(seer.userId, rows.map((r) => r.id));
  return rows
    .map((r) => ({
      recording: r,
      count: r.actionItems.filter((i, idx) => {
        if ((i.assigneeEmail ?? "").toLowerCase() !== seer.email.toLowerCase()) return false;
        const s = steps.get(`${r.id}:${idx}`);
        return !s || s.state === "suggested";
      }).length,
    }))
    .filter((x) => x.count > 0);
}

/** How far back the coach's action items reach: the calls of the last two weeks. */
export const COACH_ITEMS_DAYS = 14;
/**
 * The coach's action items (rev 497): every item on the calls of the last two weeks, drafts included (only the coach sees those),
 * skipped calls left out, and the member items already made tasks or let go not counted.
 */
export async function coachItems(workspaceId: string, sinceIso: string): Promise<{ recording: schema.Recording; open: number[] }[]> {
  const rows = (await db.query.recordings.findMany({ where: and(eq(schema.recordings.workspaceId, workspaceId), inArray(schema.recordings.status, ["draft", "published"])), orderBy: [desc(schema.recordings.startedAt), desc(schema.recordings.createdAt)] })).filter((r) => (r.startedAt ?? r.createdAt) >= sinceIso && r.actionItems.length);
  if (!rows.length) return [];
  const handled = await db.query.recordingSteps.findMany({ where: and(inArray(schema.recordingSteps.recordingId, rows.map((r) => r.id)), inArray(schema.recordingSteps.state, ["accepted", "dismissed"])) });
  const done = new Set(handled.map((s) => `${s.recordingId}:${s.itemIndex}`));
  return rows.map((r) => ({ recording: r, open: r.actionItems.map((_, i) => i).filter((i) => !done.has(`${r.id}:${i}`)) }));
}
