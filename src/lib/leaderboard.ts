/**
 * A client's loyalty-pass leaderboard (rev 639, H-29) on the server: the eLoyalty (WalletPush) REST API read with the client's
 * key, which the coach pasted on their /coach row. The key is a full admin key, so it is sealed at rest, opened only for the
 * request in hand, and never returned, logged or put in an error. HelixOS only ever reads: GET customers and GET templates.
 *
 * A visitor never reaches eLoyalty (H-29): the feed and the hosted page serve the held board, then the pasted export, else
 * nothing. The cron (/api/cron/leaderboards, every five minutes) is the only reader after Connect and check, one feed at a
 * time, only on a host that has answered 2xx, and it leaves a feed alone for a minute after a 429.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, schema } from "@/db";
import { open, seal } from "@/lib/crypto";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { type BoardRow, type Customer, type ExportRow, type Feed, type PageConfig, type PageModel, type Source, SAMPLE_ROWS, boardRows, feedIsClean, feedSlug, fieldNames, mergeCustomers, normalizeSlug, pageMembersText, pageModel, publicFeed, readPageConfig, slugProblem, textIsClean } from "@/lib/engine/leaderboard";

export const DEFAULT_HOST = "https://www.eloyalty.ai";
const FALLBACK_HOST = "https://walletpush.io";
export const FRESH_MS = 5 * 60 * 1000;
export const BACKOFF_MS = 60 * 1000;
const MAX_PAGES = 50;

export type Got = { status: number; json: unknown };
/** One GET to eLoyalty with the client's key: the status and the body as JSON (null when it isn't). Nothing from the body is ever logged. */
export async function getJson(host: string, key: string, path: string): Promise<Got> {
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
/** Every active customer on one template, page by page until has_more is false. */
async function customersOn(host: string, key: string, templateId: string | null): Promise<{ ok: true; list: Customer[] } | { ok: false; status: number }> {
  const list: Customer[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ limit: "100", is_active: "true", ...(templateId ? { template_id: templateId } : {}), ...(cursor ? { cursor } : {}) });
    const r = await getJson(host, key, `/api/external/v1/customers?${q}`);
    if (r.status < 200 || r.status >= 300) return { ok: false, status: r.status };
    const page = (r.json ?? {}) as Page;
    list.push(...(Array.isArray(page.data) ? page.data : []));
    if (!page.pagination?.has_more || !page.pagination.next_cursor) break;
    cursor = page.pagination.next_cursor;
  }
  return { ok: true, list };
}

/** The templates a feed reads: the primary and, during a pass migration (H-32), the second; blank means every pass. */
export const templatesOf = (feed: Pick<schema.LeaderboardFeed, "templateId" | "templateIdAlt">): (string | null)[] => {
  const ids = [feed.templateId, feed.templateIdAlt].map((t) => (t ?? "").trim()).filter(Boolean);
  return ids.length ? [...new Set(ids)] : [null];
};

/** Every active customer across the feed's templates, merged by customer id so nobody is counted twice. */
export async function customers(host: string, key: string, feed: Pick<schema.LeaderboardFeed, "templateId" | "templateIdAlt">): Promise<{ ok: true; list: Customer[] } | { ok: false; status: number }> {
  const lists: Customer[][] = [];
  for (const t of templatesOf(feed)) {
    const got = await customersOn(host, key, t);
    if (!got.ok) return got;
    lists.push(got.list);
  }
  return { ok: true, list: mergeCustomers(lists) };
}

type Template = { id?: string; name?: string };
/** The template to read when the coach left it blank: the one that isn't a test. Several left over: named, none picked. */
async function findTemplate(host: string, key: string): Promise<{ id: string | null; note: string | null }> {
  const r = await getJson(host, key, "/api/external/v1/templates");
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
 * it and the field names eLoyalty sent (names only). A passed check is what lets the cron refresh this feed.
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
    const r = await getJson(h, key, "/api/external/v1/customers?limit=1");
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
  const got = await customers(host, key, { templateId, templateIdAlt: feed.templateIdAlt });
  if (!got.ok) return done(false, `${statusWords(got.status)} reading the members on ${hostWords(host)}.`, { host });
  const rows = boardRows(got.list);
  const config = readPageConfig(feed.pageJson);
  const onBoard = publicFeed(rows, feed.hidden, nowIso(), config).members.length;
  const note = [`Connected on ${hostWords(host)}: ${onBoard} on the board of ${got.list.length} active`, templateNote, `fields seen: ${fieldNames(got.list[0]).join(", ") || "none (no members yet)"}`].filter(Boolean).join("; ");
  return done(true, `${note}.`, { host, templateId: templateId ?? null, cacheJson: JSON.stringify(rows), cachedAt: nowIso(), refreshAfter: null });
}

/** The feed row for a membership (a client's, or the coach's own program), made on first save with an address of their name and a random tail. */
export async function feedForMembership(m: schema.Membership, name: string): Promise<schema.LeaderboardFeed> {
  const have = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, m.id) });
  if (have) return have;
  const row = { id: newId(), workspaceId: m.workspaceId, userId: m.userId, membershipId: m.id, slug: feedSlug(name, randomBytes(4).toString("hex").slice(0, 6)) };
  await db.insert(schema.leaderboardFeeds).values(row);
  return (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, row.id) }))!;
}

const tidyHost = (h: string) => h.trim().replace(/\/$/, "");
const hostOk = (h: string) => /^https:\/\/[\w.-]+(:\d+)?$/.test(h) || (process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(h));
const tidyTemplate = (t: string) => (/^[\w-]{1,80}$/.test(t.trim()) ? t.trim() : null);

/** Saves the coach's entries: a new key sealed (blank keeps the old one), the host, the templates. A changed host has to answer again before the cron uses it. */
export async function saveFeedSettings(feed: schema.LeaderboardFeed, input: { key: string; host: string; templateId: string; templateIdAlt?: string }): Promise<schema.LeaderboardFeed> {
  const host = hostOk(tidyHost(input.host)) ? tidyHost(input.host) : DEFAULT_HOST;
  const key = input.key.trim();
  await db
    .update(schema.leaderboardFeeds)
    .set({ host, templateId: tidyTemplate(input.templateId), templateIdAlt: tidyTemplate(input.templateIdAlt ?? ""), ...(key ? { keyEncrypted: seal(key), keyLast4: key.slice(-4) } : {}), ...(host !== feed.host ? { lastCheckOk: null } : {}), updatedAt: nowIso() })
    .where(eq(schema.leaderboardFeeds.id, feed.id));
  return (await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feed.id) }))!;
}

/** Remove key: the key and the held board go; the address stays, and the feed falls back to the pasted export or 503. */
export async function removeFeedKey(feedId: string, workspaceId: string): Promise<void> {
  await db.update(schema.leaderboardFeeds).set({ keyEncrypted: null, keyLast4: null, cacheJson: null, cachedAt: null, lastCheckOk: null, lastCheckNote: "Key removed.", refreshAfter: null, updatedAt: nowIso() }).where(and(eq(schema.leaderboardFeeds.id, feedId), eq(schema.leaderboardFeeds.workspaceId, workspaceId)));
}

/** The client's page settings and export, saved from the editor (the engine has already read them into shape). */
export async function savePageConfig(feedId: string, workspaceId: string, config: PageConfig): Promise<void> {
  await db.update(schema.leaderboardFeeds).set({ pageJson: JSON.stringify(config), updatedAt: nowIso() }).where(and(eq(schema.leaderboardFeeds.id, feedId), eq(schema.leaderboardFeeds.workspaceId, workspaceId)));
}
export async function saveExport(feedId: string, workspaceId: string, rows: ExportRow[] | null, asOf: string | null): Promise<void> {
  // Only stripped rows are ever written; the parser has already dropped every other column.
  if (rows && !textIsClean(JSON.stringify(rows))) rows = null;
  await db.update(schema.leaderboardFeeds).set({ exportJson: rows ? JSON.stringify(rows) : null, exportAsOf: rows ? asOf : null, updatedAt: nowIso() }).where(and(eq(schema.leaderboardFeeds.id, feedId), eq(schema.leaderboardFeeds.workspaceId, workspaceId)));
}

const parseRows = <T>(json: string | null): T[] | null => {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
};

/** What a feed has to show, in order: the held live board (with a key), the pasted export, nothing. Never a call to eLoyalty. */
export function heldBoard(feed: schema.LeaderboardFeed): { rows: ExportRow[]; source: Source } | null {
  const config = readPageConfig(feed.pageJson);
  if (feed.keyEncrypted && feed.cacheJson && feed.cachedAt) {
    const rows = parseRows<BoardRow>(feed.cacheJson);
    if (rows) {
      const members = publicFeed(rows, feed.hidden, feed.cachedAt, { tiers: config.tiers, showZero: true }).members;
      return { rows: members.map(({ name, lifetime, available }) => ({ name, lifetime, available })), source: { kind: "live", at: feed.cachedAt } };
    }
  }
  const exported = parseRows<ExportRow>(feed.exportJson);
  if (exported) return { rows: exported, source: { kind: "export", at: feed.exportAsOf } };
  return null;
}

/**
 * The public feed by its address: the held board when there is one, else the pasted export; the hide list and the zero rule
 * applied now, so a change on the client's Settings shows at once. Null when there is nothing to serve (503 to the page,
 * which falls back by itself). This never calls eLoyalty: a visitor cannot make HelixOS read a client's program.
 */
export async function servedFeed(slug: string): Promise<Feed | null> {
  const found = await resolveFeed(slug);
  if (!found) return null;
  const { feed } = found;
  const held = heldBoard(feed);
  if (!held) return null;
  const config = readPageConfig(feed.pageJson);
  const at = held.source.kind === "live" ? held.source.at : held.source.kind === "export" && held.source.at ? held.source.at : (feed.updatedAt ?? nowIso());
  const out = publicFeed(
    held.rows.map((r) => ({ id: "", name: r.name, lifetime: r.lifetime, available: r.available ?? 0 })),
    [],
    at,
    config,
  );
  return feedIsClean(out) ? out : null;
}

/** The hosted page's model by its address: the held board, else the export, else the design's sample people marked Sample. Null for no such address. */
export async function pageFor(slug: string): Promise<PageModel | null> {
  const found = await resolveFeed(slug);
  return found ? pageModelFor(found.feed) : null;
}

/**
 * The feed behind an address (H-109): its current slug, or one it had before (an alias). The page redirects an alias to the
 * current address; the feed answers on both, so a page already reading the old feed URL keeps working.
 */
export async function resolveFeed(slug: string): Promise<{ feed: schema.LeaderboardFeed; current: boolean } | null> {
  const s = normalizeSlug(slug);
  const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.slug, s) });
  if (feed) return { feed, current: true };
  const alias = await db.query.leaderboardSlugAliases.findFirst({ where: eq(schema.leaderboardSlugAliases.slug, s) });
  if (!alias) return null;
  const old = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, alias.feedId) });
  return old ? { feed: old, current: false } : null;
}

/**
 * A new page address (H-109): checked for shape and reserved words, then for a clash with any feed's current address or any
 * alias (another feed's old address stays its own, so a link out there never changes owner). The old address becomes an
 * alias of this feed; taking back one of this feed's own aliases swaps the two. Returns the problem in words, or null when set.
 */
export async function setFeedSlug(feed: schema.LeaderboardFeed, wanted: string): Promise<string | null> {
  const problem = slugProblem(wanted);
  if (problem) return problem;
  const slug = normalizeSlug(wanted);
  if (slug === feed.slug) return null;
  const taken = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.slug, slug), columns: { id: true } });
  if (taken) return "That address is taken.";
  const alias = await db.query.leaderboardSlugAliases.findFirst({ where: eq(schema.leaderboardSlugAliases.slug, slug) });
  if (alias && alias.feedId !== feed.id) return "That address is taken.";
  if (alias) await db.delete(schema.leaderboardSlugAliases).where(eq(schema.leaderboardSlugAliases.id, alias.id));
  await db.insert(schema.leaderboardSlugAliases).values({ id: newId(), feedId: feed.id, slug: feed.slug });
  await db.update(schema.leaderboardFeeds).set({ slug, updatedAt: nowIso() }).where(eq(schema.leaderboardFeeds.id, feed.id));
  return null;
}

/** The addresses a feed has had, newest first, for the editor's note. */
export async function feedAliases(feedId: string): Promise<string[]> {
  const rows = await db.query.leaderboardSlugAliases.findMany({ where: eq(schema.leaderboardSlugAliases.feedId, feedId) });
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => r.slug);
}

export function pageModelFor(feed: schema.LeaderboardFeed): PageModel | null {
  const config = readPageConfig(feed.pageJson);
  const held = heldBoard(feed);
  const model = held ? pageModel(held.rows, config, held.source) : pageModel(SAMPLE_ROWS, config, { kind: "sample" });
  return textIsClean(pageMembersText(model)) ? model : null;
}

export type RefreshResult = { slug: string; outcome: "fresh" | "refreshed" | "busy" | "failed" | "waiting" | "unchecked" };

/**
 * The cron's work: every feed with a key whose last check passed, one at a time. A board under five minutes old is left; a
 * read that answers is kept; a 429 (or no answer) sets a minute's wait; any other error keeps the last good board and the
 * note says so. Nothing here is ever triggered by a visitor.
 */
export async function refreshFeeds(now = new Date()): Promise<RefreshResult[]> {
  const feeds = await db.query.leaderboardFeeds.findMany({ where: isNotNull(schema.leaderboardFeeds.keyEncrypted) });
  const out: RefreshResult[] = [];
  for (const feed of feeds) {
    if (!feed.lastCheckOk) {
      out.push({ slug: feed.slug, outcome: "unchecked" });
      continue;
    }
    if (feed.refreshAfter && Date.parse(feed.refreshAfter) > now.getTime()) {
      out.push({ slug: feed.slug, outcome: "waiting" });
      continue;
    }
    if (feed.cachedAt && now.getTime() - Date.parse(feed.cachedAt) < FRESH_MS) {
      out.push({ slug: feed.slug, outcome: "fresh" });
      continue;
    }
    const key = open(feed.keyEncrypted);
    if (!key) {
      out.push({ slug: feed.slug, outcome: "failed" });
      continue;
    }
    const got = await customers(feed.host, key, feed);
    if (!got.ok) {
      const busy = got.status === 429 || got.status === 0;
      await db
        .update(schema.leaderboardFeeds)
        .set(busy ? { refreshAfter: new Date(now.getTime() + BACKOFF_MS).toISOString() } : { lastCheckNote: `${statusWords(got.status)} at the last refresh; the last good board is still served.`, lastCheckAt: now.toISOString() })
        .where(eq(schema.leaderboardFeeds.id, feed.id));
      out.push({ slug: feed.slug, outcome: busy ? "busy" : "failed" });
      continue;
    }
    await db.update(schema.leaderboardFeeds).set({ cacheJson: JSON.stringify(boardRows(got.list)), cachedAt: now.toISOString(), refreshAfter: null }).where(eq(schema.leaderboardFeeds.id, feed.id));
    out.push({ slug: feed.slug, outcome: "refreshed" });
  }
  return out;
}

/** Whether this membership has a leaderboard set up (a feed row): what shows the Loyalty leaderboard menu item (H-140). */
export async function hasLeaderboardFeed(membershipId: string): Promise<boolean> {
  return Boolean(await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.membershipId, membershipId), columns: { id: true } }));
}
