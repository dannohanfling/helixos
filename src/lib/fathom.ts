/**
 * Fathom, with the client's own user-level API key. Two calls only: list recordings (titles and dates, never transcripts) and
 * read one transcript by the recording id a human chose. There is no sync, no batch and no background job in this file, and
 * nothing here may read a transcript the client did not point at.
 * Endpoints per Fathom's public API: GET /external/v1/meetings (X-Api-Key), GET /external/v1/recordings/{id}/transcript.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { open } from "@/lib/crypto";
import type { TranscriptEntry } from "@/lib/engine/fathom";

const DEFAULT_BASE = "https://api.fathom.ai";
/** Development and smoke tests point at a mock. Never honoured in production. */
export function fathomBase(): string {
  return (process.env.NODE_ENV !== "production" && process.env.FATHOM_BASE_URL ? process.env.FATHOM_BASE_URL : DEFAULT_BASE).replace(/\/$/, "");
}

export type FathomResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };
export type Recording = { recordingId: string; title: string; url: string; recordedAt: string | null; invitees: string[] };

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
  return `Fathom replied: ${message}`.slice(0, 300);
}

async function call<T>(key: string, path: string): Promise<FathomResult<T>> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`${fathomBase()}${path}`, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: ctrl.signal, cache: "no-store" });
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
      return { ok: false, error: explainFathom(res.status, msg), status: res.status };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: explainFathom(undefined, e instanceof Error ? e.message : String(e)) };
  }
}

type RawMeeting = { recording_id?: number | string; title?: string; meeting_title?: string; share_url?: string; url?: string; created_at?: string; recording_start_time?: string; calendar_invitees?: { name?: string; email?: string }[] };
type RawEntry = { speaker?: { display_name?: string; matched_calendar_invitee_email?: string | null }; text?: string; timestamp?: string };

/** Titles, dates and who was on the call. No transcript is requested here, ever. */
export async function listRecordings(userId: string, key: string, cursor?: string | null): Promise<FathomResult<{ recordings: Recording[]; nextCursor: string | null }>> {
  await pace(userId);
  const r = await call<{ items?: RawMeeting[]; next_cursor?: string | null }>(key, `/external/v1/meetings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  if (!r.ok) return r;
  const recordings = (r.data.items ?? [])
    .map((m) => ({ recordingId: String(m.recording_id ?? ""), title: m.title ?? m.meeting_title ?? "Untitled recording", url: m.share_url ?? m.url ?? "", recordedAt: m.recording_start_time ?? m.created_at ?? null, invitees: (m.calendar_invitees ?? []).map((i) => i.name || i.email || "").filter(Boolean) }))
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
  return { ok: true, data: raw.map((e) => ({ speaker: e.speaker?.display_name?.trim() || "Unknown speaker", email: e.speaker?.matched_calendar_invitee_email ?? null, text: (e.text ?? "").trim(), timestamp: e.timestamp ?? "00:00:00" })).filter((e) => e.text) };
}

/** The cheap check on save: one page of titles. */
export async function validateFathomKey(userId: string, key: string): Promise<FathomResult<number>> {
  const r = await listRecordings(userId, key);
  return r.ok ? { ok: true, data: r.data.recordings.length } : r;
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
