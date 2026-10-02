/**
 * Fathom. Two uses, two keys:
 *  - a member's own key (fathom_connections): list their recordings (titles and dates, never transcripts) and read one transcript
 *    by the recording id a human chose, for the testimonial harvest. No sync, no batch and no background job for that key.
 *  - the workspace's key, the coach's (fathom_workspace_connections, Recordings R1): list meetings with their summaries and action
 *    items since a date, register and remove the webhook Fathom calls, and read one transcript when a member asks for it.
 * Endpoints per Fathom's public API: GET /external/v1/meetings (X-Api-Key), GET /external/v1/recordings/{id}/transcript,
 * POST and DELETE /external/v1/webhooks.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import type { TranscriptEntry } from "@/lib/engine/fathom";
import type { RawMeeting } from "@/lib/engine/recordings";

const DEFAULT_BASE = "https://api.fathom.ai";
/** Development and smoke tests point at a mock. Never honoured in production. */
export function fathomBase(): string {
  return (process.env.NODE_ENV !== "production" && process.env.FATHOM_BASE_URL ? process.env.FATHOM_BASE_URL : DEFAULT_BASE).replace(/\/$/, "");
}

export type FathomResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };
export type Recording = { recordingId: string; title: string; url: string; recordedAt: string | null; invitees: { name: string | null; email: string | null }[] };

/** 60 calls a minute per key. One recording at a time never gets near it; this keeps a fast clicker a second apart. */
const lastCall = new Map<string, number>();
async function pace(userId: string): Promise<void> {
  const wait = (lastCall.get(userId) ?? 0) + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall.set(userId, Date.now());
}

export function explainFathom(status: number | undefined, message: string): string {
  if (status === 401 || status === 403) return "Fathom rejected the key (401). Create a new API key in Fathom (Settings → API) and paste it again.";
  if (status === 404) return "Fathom says that recording isn't there any more (404). Refresh the list and pick again.";
  if (status === 429) return "Fathom is rate-limiting this key (429). Wait a minute and try again.";
  if (/abort|fetch failed|econn/i.test(message)) return "Couldn't reach Fathom. Try again in a minute.";
  // The fallthrough keeps the case and drops the vendor's words; they are in the log under [fathom].
  return `Fathom returned an error${status ? ` (${status})` : ""}. Try again in a minute.`;
}

async function call<T>(key: string, path: string, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}): Promise<FathomResult<T>> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`${fathomBase()}${path}`, { method: init.method ?? "GET", headers: { "X-Api-Key": key, Accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}) }, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : text.slice(0, 200);
      console.error("[fathom] upstream error", JSON.stringify({ status: res.status, body: msg.slice(0, 500) }));
      return { ok: false, error: explainFathom(res.status, msg), status: res.status };
    }
    return { ok: true, data: (json ?? {}) as T };
  } catch (e) {
    console.error("[fathom] request failed", JSON.stringify({ message: (e instanceof Error ? e.message : String(e)).slice(0, 300) }));
    return { ok: false, error: explainFathom(undefined, e instanceof Error ? e.message : String(e)) };
  }
}


type RawEntry = { speaker?: { display_name?: string; matched_calendar_invitee_email?: string | null }; text?: string; timestamp?: string | number };

/** Titles, dates and who was on the call. No transcript is requested here, ever. */
export async function listRecordings(userId: string, key: string, cursor?: string | null): Promise<FathomResult<{ recordings: Recording[]; nextCursor: string | null }>> {
  await pace(userId);
  const r = await call<{ items?: RawMeeting[]; next_cursor?: string | null }>(key, `/external/v1/meetings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  if (!r.ok) return r;
  const recordings = (r.data.items ?? [])
    // `url` is the meeting's own address (fathom.video/calls/<call id>); the deep link is built from it. `recording_id` is a different number and only ever fetches.
    .map((m) => ({ recordingId: String(m.recording_id ?? ""), title: m.title ?? m.meeting_title ?? "Untitled recording", url: m.url ?? m.share_url ?? "", recordedAt: m.recording_start_time ?? m.created_at ?? null, invitees: (m.calendar_invitees ?? []).map((i) => ({ name: i.name?.trim() || null, email: i.email?.trim() || null })).filter((i) => i.name || i.email) }))
    .filter((m) => m.recordingId);
  return { ok: true, data: { recordings, nextCursor: r.data.next_cursor ?? null } };
}

/** One transcript, by the id a human picked. */
export async function readTranscript(userId: string, key: string, recordingId: string): Promise<FathomResult<TranscriptEntry[]>> {
  if (!/^[\w-]+$/.test(recordingId)) return { ok: false, error: "That recording id isn't valid." };
  await pace(userId);
  const r = await call<{ transcript?: RawEntry[] } | RawEntry[]>(key, `/external/v1/recordings/${encodeURIComponent(recordingId)}/transcript`);
  if (!r.ok) return r;
  const raw = Array.isArray(r.data) ? r.data : (r.data.transcript ?? []);
  return { ok: true, data: raw.map((e) => ({ speaker: e.speaker?.display_name?.trim() || "Unknown speaker", email: e.speaker?.matched_calendar_invitee_email ?? null, text: (e.text ?? "").trim(), timestamp: String(e.timestamp ?? "00:00:00") })).filter((e) => e.text) };
}

/** The cheap check on save: one page of titles. */
export async function validateFathomKey(userId: string, key: string): Promise<FathomResult<number>> {
  const r = await listRecordings(userId, key);
  return r.ok ? { ok: true, data: r.data.recordings.length } : r;
}

/**
 * Meetings with their summaries and action items (Recordings R1), one page at a time, newest first, optionally only those created
 * after a moment. Transcripts are never asked for here: include_transcript is never sent, which the mock checks.
 */
export async function listMeetingsFull(paceKey: string, key: string, opts: { createdAfter?: string | null; cursor?: string | null } = {}): Promise<FathomResult<{ meetings: RawMeeting[]; nextCursor: string | null }>> {
  await pace(paceKey);
  const q = new URLSearchParams({ include_summary: "true", include_action_items: "true" });
  if (opts.createdAfter) q.set("created_after", opts.createdAfter);
  if (opts.cursor) q.set("cursor", opts.cursor);
  const r = await call<{ items?: RawMeeting[]; next_cursor?: string | null }>(key, `/external/v1/meetings?${q.toString()}`);
  if (!r.ok) return r;
  return { ok: true, data: { meetings: r.data.items ?? [], nextCursor: r.data.next_cursor ?? null } };
}

/**
 * Registers the webhook Fathom will call for the coach's own recordings, with the summary and action items in the payload and
 * never the transcript. Fathom answers with the webhook's id and its signing secret, which the caller seals.
 */
export async function createWebhook(paceKey: string, key: string, destinationUrl: string): Promise<FathomResult<{ id: string; secret: string }>> {
  await pace(paceKey);
  const r = await call<{ id?: string | number; secret?: string }>(key, "/external/v1/webhooks", { method: "POST", body: { destination_url: destinationUrl, triggered_for: ["my_recordings"], include_summary: true, include_action_items: true, include_transcript: false, include_crm_matches: false } });
  if (!r.ok) return r;
  const id = String(r.data.id ?? "").trim();
  const secret = String(r.data.secret ?? "").trim();
  if (!id || !secret) return { ok: false, error: "Fathom created the webhook but didn't return its id and secret. Remove it in Fathom and try again." };
  return { ok: true, data: { id, secret } };
}

export async function deleteWebhook(paceKey: string, key: string, webhookId: string): Promise<FathomResult<null>> {
  if (!/^[\w-]+$/.test(webhookId)) return { ok: false, error: "That webhook id isn't valid." };
  await pace(paceKey);
  const r = await call<unknown>(key, `/external/v1/webhooks/${encodeURIComponent(webhookId)}`, { method: "DELETE" });
  // Already gone counts as removed.
  if (!r.ok && r.status !== 404) return r;
  return { ok: true, data: null };
}

export async function fathomConnectionFor(workspaceId: string, userId: string) {
  return db.query.fathomConnections.findFirst({ where: and(eq(schema.fathomConnections.workspaceId, workspaceId), eq(schema.fathomConnections.userId, userId)) });
}
/** The usable key, or null (not connected, or the last check failed). */
export async function fathomKeyFor(workspaceId: string, userId: string): Promise<{ key: string; conn: schema.FathomConnection } | null> {
  const conn = await fathomConnectionFor(workspaceId, userId);
  if (!conn || conn.lastError) return null;
  const key = open(conn.keyEncrypted);
  return key ? { key, conn } : null;
}
