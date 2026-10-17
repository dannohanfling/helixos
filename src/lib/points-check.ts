/**
 * The points check (H-102, H-112) on the server: read eLoyalty for the client's passes on both templates (the feed row's
 * primary and second template) and, per customer, the events the Mini-App's GetPassActivity reads, paced and stopped at the
 * first 429; take the coach's one-time upload of the Community Loyalty export, already parsed to its pass fields; compare in
 * memory; keep one sealed snapshot of "First L." and numbers on the feed row. The export itself is never stored. Nothing here
 * writes to eLoyalty or Community Loyalty: every call is a GET.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { open, seal } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { type ClRecord, type LastChange, type Snapshot, compare, fieldNamesOf, idReportCsv, latestChange, parseClExport, passHolders, snapshotIsClean } from "@/lib/engine/points-check";
import { customers, getJson, statusWords, templatesOf } from "@/lib/leaderboard";

/** The largest Community Loyalty export read. */
export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

/** The uploaded export, checked and parsed in memory, or the reason in plain words. The file itself is never kept. */
export async function readExportUpload(file: FormDataEntryValue | null): Promise<{ ok: true; parsed: ReturnType<typeof parseClExport> } | { ok: false; error: string }> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the export file first." };
  if (file.size > MAX_EXPORT_BYTES) return { ok: false, error: "That file is over 5MB." };
  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".txt") && !name.endsWith(".tsv")) return { ok: false, error: "Use the CSV export." };
  const parsed = parseClExport(Buffer.from(await file.arrayBuffer()).toString("utf8"));
  if (!parsed.columns.customerId && !parsed.columns.serial) return { ok: false, error: "That export has no Loyalty Customer ID or pass serial column; pin them in Community Loyalty and export again." };
  return { ok: true, parsed };
}

/** The events path the Mini-App's GetPassActivity uses (architecture doc, read off the config): unverified until the first live call. */
export const EVENTS_PATH = (customerId: string) => `/api/public/admin/customers/${encodeURIComponent(customerId)}/events?limit=50`;
/** A short pause between customers, so a run over a few dozen passes never trips the rate limit. */
export const PACE_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Each customer's latest points change, one GET per customer, in order, with a pause; the first 429 or no answer ends the
 * history pass (the rest read as null) and the note says so. The first answer's field names, never a value, go to the log.
 */
export async function readHistory(host: string, key: string, ids: readonly string[]): Promise<{ history: Map<string, LastChange | null>; note: string }> {
  const history = new Map<string, LastChange | null>();
  let logged = false;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const r = await getJson(host, key, EVENTS_PATH(id));
    if (r.status === 429 || r.status === 0) return { history, note: `${statusWords(r.status)} after ${i} of ${ids.length} histories; the rest read as unknown.` };
    if (r.status === 404) {
      if (!logged) console.log("[points-check] events path answered 404; no history is read for this program");
      return { history, note: "eLoyalty has no events path for this program (404); last changes are unknown." };
    }
    if (r.status < 200 || r.status >= 300) {
      history.set(id, null);
      continue;
    }
    if (!logged) {
      const list = (r.json as { data?: unknown[]; events?: unknown[] } | unknown[] | null) ?? null;
      const first = Array.isArray(list) ? list[0] : Array.isArray(list?.data) ? list.data[0] : Array.isArray(list?.events) ? list.events[0] : undefined;
      console.log(`[points-check] events fields: ${fieldNamesOf(first).join(", ") || "none"}`);
      logged = true;
    }
    history.set(id, latestChange(r.json));
    if (i + 1 < ids.length) await sleep(PACE_MS);
  }
  return { history, note: `${ids.length} histories read.` };
}

/**
 * The whole check for one feed, with the export's parsed records: read, compare, seal, store. Returns the snapshot, or the
 * reason it could not run (in words, never a key or a body). Only the sealed snapshot and its time are written, on the feed row.
 */
export async function runPointsCheck(feed: schema.LeaderboardFeed, cl: readonly ClRecord[], meta: { columns: Snapshot["columns"]; clRows: number }): Promise<{ ok: true; snapshot: Snapshot } | { ok: false; error: string }> {
  const key = open(feed.keyEncrypted);
  if (!key) return { ok: false, error: "No eLoyalty key is saved on this row." };
  if (!feed.lastCheckOk) return { ok: false, error: "Connect and check has to pass first." };
  const got = await customers(feed.host, key, feed);
  if (!got.ok) return { ok: false, error: `${statusWords(got.status)} reading the passes.` };
  const holders = passHolders(got.list);
  const { history, note } = await readHistory(feed.host, key, holders.map((h) => h.id));
  const snapshot = compare(holders, cl, new Set(feed.hidden), history, { at: nowIso(), templates: templatesOf(feed).map((t) => t ?? ""), columns: meta.columns, clRows: meta.clRows, note });
  if (!snapshotIsClean(snapshot)) return { ok: false, error: "The result carried something that looked like an id, an email or a long number, so it was not kept." };
  await db.update(schema.leaderboardFeeds).set({ pointsCheckSealed: seal(JSON.stringify(snapshot)), pointsCheckAt: snapshot.at, updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feed.id));
  return { ok: true, snapshot };
}

/**
 * The id report (H-402 step 2): the same reads as the check, every one a GET, and the comparison as CSV with the customer ids
 * kept, handed straight back for download. Nothing is stored, so the ids never sit in HelixOS.
 */
export async function pointsCheckReport(feed: schema.LeaderboardFeed, cl: readonly ClRecord[]): Promise<{ ok: true; csv: string; note: string } | { ok: false; error: string }> {
  const key = open(feed.keyEncrypted);
  if (!key) return { ok: false, error: "No eLoyalty key is saved on this row." };
  if (!feed.lastCheckOk) return { ok: false, error: "Connect and check has to pass first." };
  const got = await customers(feed.host, key, feed);
  if (!got.ok) return { ok: false, error: `${statusWords(got.status)} reading the passes.` };
  const holders = passHolders(got.list);
  const { history, note } = await readHistory(feed.host, key, holders.map((h) => h.id));
  return { ok: true, csv: idReportCsv(holders, cl, new Set(feed.hidden), history), note };
}

/** The last snapshot, opened, or null. */
export function readPointsCheck(feed: Pick<schema.LeaderboardFeed, "pointsCheckSealed">): Snapshot | null {
  const text = open(feed.pointsCheckSealed);
  if (!text) return null;
  try {
    return JSON.parse(text) as Snapshot;
  } catch {
    return null;
  }
}

/** Clear the snapshot: nothing else changes. */
export async function clearPointsCheck(feedId: string, workspaceId: string): Promise<void> {
  const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedId) });
  if (!feed || feed.workspaceId !== workspaceId) return;
  await db.update(schema.leaderboardFeeds).set({ pointsCheckSealed: null, pointsCheckAt: null, updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feedId));
}
