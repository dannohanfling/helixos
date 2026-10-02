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
import { assignSteps, canSee, intake, meetingFields, type Member, type RawMeeting } from "@/lib/engine/recordings";

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

/**
 * One meeting in: new rows take the intake decision (published at once on an exact title after switch-on, otherwise a draft); a
 * meeting already here keeps its status and audience and only refreshes what Fathom may have filled in since (summary, items).
 */
export async function ingestMeeting(conn: schema.FathomWorkspaceConnection, raw: RawMeeting, source: "webhook" | "sync" | "backfill", members?: ClientMember[]): Promise<IntakeOutcome | null> {
  const f = meetingFields(raw);
  if (!f) return null;
  const existing = await db.query.recordings.findFirst({ where: and(eq(schema.recordings.workspaceId, conn.workspaceId), eq(schema.recordings.fathomRecordingId, f.fathomRecordingId)) });
  const ms = members ?? (await clientMembers(conn.workspaceId));
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
  const d = intake(f, conn.enabledAt);
  const row: typeof schema.recordings.$inferInsert = {
    id: newId(),
    workspaceId: conn.workspaceId,
    fathomRecordingId: f.fathomRecordingId,
    title: f.title,
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
    // Published by the rule, not a person.
    publishedBy: d.status === "published" ? "title" : null,
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
  const members = await clientMembers(workspaceId);
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
      const out = await ingestMeeting(conn, m, "sync", members);
      if (!out) continue;
      seen++;
      if (out.created) created++;
      if (out.created && out.recording.status === "published") published++;
    }
    cursor = r.data.nextCursor;
    if (!cursor) break;
  }
  const note = `${seen} listed, ${created} new, ${published} published by title`;
  await db.update(schema.fathomWorkspaceConnections).set({ lastSyncAt: nowIso(), lastSyncNote: note }).where(eq(schema.fathomWorkspaceConnections.id, conn.id));
  await logSync({ workspaceId, userId: by, provider: FATHOM_PROVIDER, direction: "in", event: "recordings.sync", payload: { since, seen, created, published }, status: "received", note });
  return { ok: true, created, seen, published };
}

/** The coach publishes a draft (or changes who a recording is for): the audience, or the named members for a one-to-one. */
export async function publishRecording(r: schema.Recording, audience: RecordingAudience, userIds: string[], byUserId: string): Promise<schema.Recording> {
  const members = await clientMembers(r.workspaceId);
  const named = audience === "members" ? userIds.filter((id) => members.some((m) => m.userId === id)) : [];
  await db.update(schema.recordings).set({ status: "published", audience, audienceUserIds: named, publishedAt: r.publishedAt ?? nowIso(), publishedBy: byUserId, note: null }).where(eq(schema.recordings.id, r.id));
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
