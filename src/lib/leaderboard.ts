/**
 * A client's loyalty-pass leaderboard (rev 639) on the server: the eLoyalty (WalletPush) REST API read with the client's key,
 * which the coach pasted on their /coach row. The key is a full admin key, so it is sealed at rest, opened only for the request
 * in hand, and never returned, logged or put in an error. HelixOS only ever reads: GET customers and GET templates.
 *
 * The board is held here with eLoyalty's customer ids (never served) so the client's hide list applies the moment it changes;
 * the feed is fresh for five minutes, and on a 429 or an error the last good board is served instead.
 */
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "@/db";
import { open, seal } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { boardRows, feedIsClean, feedSlug, fieldNames, publicFeed, type BoardRow, type Customer, type Feed } from "@/lib/engine/leaderboard";

export const DEFAULT_HOST = "https://www.eloyalty.ai";
const FALLBACK_HOST = "https://walletpush.io";
export const FRESH_MS = 5 * 60 * 1000;
const MAX_PAGES = 50;

type Got = { status: number; json: unknown };
async function get(host: string, key: string, path: string): Promise<Got> {
  try {
    const res = await fetch(`${host.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

/** A status in plain words for the coach; nothing from the response body (it could echo the key) is ever repeated. */
export function statusWords(status: number): string {
  if (status === 401) return "eLoyalty didn't accept that key";
  if (status === 403) return "eLoyalty refused the key here (its scope or allowed domains)";
  if (status === 429) return "eLoyalty is busy; try again in a minute";
  if (status === 0) return "eLoyalty didn't answer";
  return `eLoyalty answered ${status}`;
}

type Page = { data?: Customer[]; pagination?: { next_cursor?: string | null; has_more?: boolean } };
/** Every active customer on the template, page by page until has_more is false. */
async function customers(host: string, key: string, templateId: string | null): Promise<{ ok: true; list: Customer[] } | { ok: false; status: number }> {
  const list: Customer[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ limit: "100", is_active: "true", ...(templateId ? { template_id: templateId } : {}), ...(cursor ? { cursor } : {}) });
    const r = await get(host, key, `/api/external/v1/customers?${q}`);
    if (r.status < 200 || r.status >= 300) return { ok: false, status: r.status };
    const page = (r.json ?? {}) as Page;
    list.push(...(Array.isArray(page.data) ? page.data : []));
    if (!page.pagination?.has_more || !page.pagination.next_cursor) break;
    cursor = page.pagination.next_cursor;
  }
  return { ok: true, list };
}

type Template = { id?: string; name?: string };
/** The template to read when the coach left it blank: the one that isn't a test. Several left over: named, none picked. */
async function findTemplate(host: string, key: string): Promise<{ id: string | null; note: string | null }> {
  const r = await get(host, key, "/api/external/v1/templates");
  if (r.status < 200 || r.status >= 300) return { id: null, note: null };
  const raw = (r.json as { data?: Template[] } | Template[] | null) ?? [];
  const all = (Array.isArray(raw) ? raw : (raw.data ?? [])).filter((t) => t.id && !/test/i.test(t.name ?? ""));
  if (all.length === 1) return { id: all[0].id!, note: `template "${all[0].name ?? "unnamed"}"` };
  if (!all.length) return { id: null, note: "no template found; reading every pass" };
  return { id: null, note: `several templates (${all.map((t) => `"${t.name ?? "unnamed"}" ${String(t.id).slice(0, 8)}`).join(", ")}): paste the one to use` };
}

const hostWords = (h: string) => h.replace(/^https?:\/\//, "");

/**
 * Connect and check (and Check again): try the coach's host, then WalletPush's own when the default was used; keep the one that
 * answers; find the template when it's blank; read every member; keep the board and say, in words, the host, how many are on
 * it and the field names eLoyalty sent (names only).
 */
export async function checkFeed(feed: schema.LeaderboardFeed): Promise<{ ok: boolean; note: string }> {
  const key = open(feed.keyEncrypted);
  const done = async (ok: boolean, note: string, extra: Partial<schema.LeaderboardFeed> = {}) => {
    await db.update(schema.leaderboardFeeds).set({ lastCheckAt: nowIso(), lastCheckOk: ok, lastCheckNote: note, updatedAt: nowIso(), ...extra }).where(eq(schema.leaderboardFeeds.id, feed.id));
    return { ok, note };
  };
  if (!key) return done(false, "No key saved.");
  const hosts = feed.host === DEFAULT_HOST ? [DEFAULT_HOST, FALLBACK_HOST] : [feed.host];
  let host: string | null = null;
  let last = 0;
  for (const h of hosts) {
    const r = await get(h, key, "/api/external/v1/customers?limit=1");
    last = r.status;
    if (r.status >= 200 && r.status < 300) {
      host = h;
      break;
    }
    if (r.status === 401 || r.status === 429) break;
  }
  if (!host) return done(false, `${statusWords(last)}.`);
  let templateId = feed.templateId;
  let templateNote: string | null = null;
  if (!templateId) {
    const t = await findTemplate(host, key);
    templateId = t.id;
    templateNote = t.note;
  }
  const got = await customers(host, key, templateId);
  if (!got.ok) return done(false, `${statusWords(got.status)} reading the members on ${hostWords(host)}.`, { host });
  const rows = boardRows(got.list);
  const note = [`Connected on ${hostWords(host)}: ${rows.length} on the board of ${got.list.length} active`, templateNote, `fields seen: ${fieldNames(got.list[0]).join(", ") || "none (no members yet)"}`].filter(Boolean).join("; ");
  return done(true, `${note}.`, { host, templateId: templateId ?? null, cacheJson: JSON.stringify(rows), cachedAt: nowIso() });
}

/** The client's feed row, made on first save with an address of their name and a random tail. */
export async function feedForMembership(m: schema.Membership, name: string): Promise<schema.LeaderboardFeed> {
  const have = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, m.id) });
  if (have) return have;
  const row = { id: newId(), workspaceId: m.workspaceId, userId: m.userId, membershipId: m.id, slug: feedSlug(name, randomBytes(4).toString("hex").slice(0, 6)) };
  await db.insert(schema.leaderboardFeeds).values(row);
  return (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, row.id) }))!;
}

/** Saves the coach's entries: a new key sealed (blank keeps the old one), the host, the template. */
export async function saveFeedSettings(feed: schema.LeaderboardFeed, input: { key: string; host: string; templateId: string }): Promise<schema.LeaderboardFeed> {
  const host = /^https:\/\/[\w.-]+(:\d+)?$/.test(input.host.trim().replace(/\/$/, "")) || (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(input.host.trim())) ? input.host.trim().replace(/\/$/, "") : DEFAULT_HOST;
  const key = input.key.trim();
  await db
    .update(schema.leaderboardFeeds)
    .set({ host, templateId: input.templateId.trim() || null, ...(key ? { keyEncrypted: seal(key), keyLast4: key.slice(-4) } : {}), updatedAt: nowIso() })
    .where(eq(schema.leaderboardFeeds.id, feed.id));
  return (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feed.id) }))!;
}

/** Remove key: the key and the held board go; the address stays, and answers 503 until a key is saved again. */
export async function removeFeedKey(feedId: string, workspaceId: string): Promise<void> {
  await db.update(schema.leaderboardFeeds).set({ keyEncrypted: null, keyLast4: null, cacheJson: null, cachedAt: null, lastCheckOk: null, lastCheckNote: "Key removed.", updatedAt: nowIso() }).where(and(eq(schema.leaderboardFeeds.id, feedId), eq(schema.leaderboardFeeds.workspaceId, workspaceId)));
}

/**
 * The public feed by its address: the held board when it's under five minutes old; else read eLoyalty again and keep it; on a
 * 429 or an error the last good board. Null when there is nothing to serve (503 to the page, which falls back by itself).
 */
export async function servedFeed(slug: string): Promise<Feed | null> {
  const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.slug, slug) });
  if (!feed) return null;
  const held = (): Feed | null => {
    if (!feed.cacheJson || !feed.cachedAt) return null;
    const out = publicFeed(JSON.parse(feed.cacheJson) as BoardRow[], feed.hidden, feed.cachedAt);
    return feedIsClean(out) ? out : null;
  };
  if (!feed.keyEncrypted) return null;
  if (feed.cachedAt && Date.now() - Date.parse(feed.cachedAt) < FRESH_MS) return held();
  const key = open(feed.keyEncrypted);
  if (!key) return held();
  const got = await customers(feed.host, key, feed.templateId);
  if (!got.ok) return held();
  const rows = boardRows(got.list);
  const at = nowIso();
  await db.update(schema.leaderboardFeeds).set({ cacheJson: JSON.stringify(rows), cachedAt: at }).where(eq(schema.leaderboardFeeds.id, feed.id));
  const out = publicFeed(rows, feed.hidden, at);
  return feedIsClean(out) ? out : null;
}
