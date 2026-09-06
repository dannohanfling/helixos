/**
 * GoHighLevel Social Planner, per client sub-account. Verified against HighLevel's OpenAPI (apps/social-media-posting.json, apps/oauth.json):
 *  - POST /oauth/locationToken (form: companyId, locationId) with the agency token → 24h location token
 *  - GET  /social-media-posting/{locationId}/accounts → results.accounts[] / results.groups[]
 *  - POST /social-media-posting/{locationId}/posts → results.post
 *  - GET  /social-media-posting/{locationId}/posts/{id} → results.post (status, error, postId, publishedAt)
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SocialAccount, SocialConnection } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { getIntegration, logSync } from "@/lib/integrations";
import { autoMap } from "@/lib/engine/ghl-map";

const VERSION = "2021-07-28";

export type GhlResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(base: string, token: string, path: string, init: RequestInit = {}): Promise<GhlResult<T>> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json", ...(init.headers ?? {}) }, signal: ctrl.signal });
    clearTimeout(t);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = (json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : text).slice(0, 200);
      return { ok: false, error: `${res.status} ${msg}`.trim() };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function connectionFor(userId: string): Promise<SocialConnection | undefined> {
  return db.query.socialConnections.findFirst({ where: and(eq(schema.socialConnections.userId, userId), eq(schema.socialConnections.provider, "gohighlevel")) });
}

/** A usable location token: the client's own private token, a cached minted one, or a fresh mint from the agency token. */
export async function locationToken(conn: SocialConnection): Promise<GhlResult<{ token: string; base: string }>> {
  const integ = await getIntegration(conn.workspaceId, "gohighlevel");
  const base = integ?.config.apiUrl || "https://services.leadconnectorhq.com";
  if (conn.manualToken) return { ok: true, data: { token: conn.manualToken, base } };
  // The agency token can reach every sub-account under the agency. It is only used for a location the coach assigned to this member.
  if (!conn.coachAssigned) return { ok: false, error: "Ask your coach to assign your sub-account on Integrations, or paste your own private integration token" };
  if (conn.accessToken && conn.tokenExpiresAt && new Date(conn.tokenExpiresAt).getTime() - Date.now() > 5 * 60000) return { ok: true, data: { token: conn.accessToken, base } };
  if (!integ?.enabled) return { ok: false, error: "GoHighLevel is turned off on the Integrations page" };
  if (!integ.config.apiKey || !integ.config.companyId) return { ok: false, error: "Agency token or company ID missing on the Integrations page" };
  const body = new URLSearchParams({ companyId: integ.config.companyId, locationId: conn.locationId });
  const r = await call<{ access_token: string; expires_in: number }>(base, integ.config.apiKey, "/oauth/locationToken", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) return r;
  const expires = new Date(Date.now() + Math.max(600, Number(r.data.expires_in || 86400) - 60) * 1000).toISOString();
  await db.update(schema.socialConnections).set({ accessToken: r.data.access_token, tokenExpiresAt: expires, lastError: null }).where(eq(schema.socialConnections.id, conn.id));
  return { ok: true, data: { token: r.data.access_token, base } };
}

type RawAccount = { id?: string; _id?: string; name?: string; platform?: string; type?: string; isExpired?: boolean; avatar?: string; meta?: Record<string, unknown> };

/** Pulls the sub-account's connected pages and profiles, stores them, and fills the channel map where it's obvious. */
export async function refreshAccounts(conn: SocialConnection): Promise<GhlResult<SocialAccount[]>> {
  const tok = await locationToken(conn);
  if (!tok.ok) {
    await db.update(schema.socialConnections).set({ lastError: tok.error }).where(eq(schema.socialConnections.id, conn.id));
    return tok;
  }
  const r = await call<{ results?: { accounts?: RawAccount[] } }>(tok.data.base, tok.data.token, `/social-media-posting/${conn.locationId}/accounts`);
  if (!r.ok) {
    await db.update(schema.socialConnections).set({ lastError: r.error }).where(eq(schema.socialConnections.id, conn.id));
    await logSync({ workspaceId: conn.workspaceId, userId: conn.userId, provider: "gohighlevel", direction: "out", event: "social.accounts", status: "failed", note: r.error });
    return r;
  }
  const accounts: SocialAccount[] = (r.data.results?.accounts ?? []).map((a) => ({ id: String(a.id ?? a._id ?? ""), name: a.name ?? "Account", platform: (a.platform ?? "").toLowerCase(), type: (a.type ?? "").toLowerCase(), isExpired: Boolean(a.isExpired), avatar: a.avatar ?? null })).filter((a) => a.id);
  const mapping = autoMap(accounts, conn.mapping);
  await db.update(schema.socialConnections).set({ accounts, mapping, connectedAt: conn.connectedAt ?? nowIso(), lastSyncAt: nowIso(), lastError: null }).where(eq(schema.socialConnections.id, conn.id));
  await logSync({ workspaceId: conn.workspaceId, userId: conn.userId, provider: "gohighlevel", direction: "out", event: "social.accounts", payload: { count: accounts.length }, status: "sent", note: `${accounts.length} connected accounts` });
  return { ok: true, data: accounts };
}

export type NewPost = { accountId: string; summary: string; type: "post" | "story" | "reel"; scheduleDate: string | null; media?: { url: string; type: string }[]; followUpComment?: string | null };

/** Creates a post in the Social Planner. Scheduled when a date is given, published now otherwise. Returns GHL's post id. */
export async function createPost(conn: SocialConnection, post: NewPost): Promise<GhlResult<{ id: string }>> {
  const tok = await locationToken(conn);
  if (!tok.ok) return tok;
  const body = {
    accountIds: [post.accountId],
    summary: post.summary,
    media: post.media ?? [],
    status: post.scheduleDate ? "scheduled" : "published",
    scheduleDate: post.scheduleDate ?? new Date().toISOString(),
    type: post.type,
    followUpComment: post.followUpComment ?? undefined,
    userId: conn.ghlUserId ?? "",
    createdBy: conn.ghlUserId ?? undefined,
  };
  const r = await call<{ results?: { post?: { _id?: string; id?: string } } }>(tok.data.base, tok.data.token, `/social-media-posting/${conn.locationId}/posts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return r;
  const id = String(r.data.results?.post?._id ?? r.data.results?.post?.id ?? "");
  return id ? { ok: true, data: { id } } : { ok: false, error: "GHL accepted the post but returned no id" };
}

export type PostStatus = { status: string; error: string | null; postId: string | null; publishedAt: string | null };

export async function getPost(conn: SocialConnection, id: string): Promise<GhlResult<PostStatus>> {
  const tok = await locationToken(conn);
  if (!tok.ok) return tok;
  const r = await call<{ results?: { post?: { status?: string; error?: string; postId?: string; publishedAt?: string } } }>(tok.data.base, tok.data.token, `/social-media-posting/${conn.locationId}/posts/${id}`);
  if (!r.ok) return r;
  const p = r.data.results?.post ?? {};
  return { ok: true, data: { status: String(p.status ?? "unknown"), error: p.error ?? null, postId: p.postId ?? null, publishedAt: p.publishedAt ?? null } };
}

/**
 * Creates or updates a member's connection.
 * Coach: may set any location; it becomes coach-assigned, which is what allows agency-token minting.
 * Member: may only change the location when supplying their own private token (proof of access). A coach-assigned location stays put.
 */
export async function upsertConnection(input: { workspaceId: string; userId: string; locationId: string; ghlUserId: string | null; manualToken: string | null; byCoach: boolean }): Promise<GhlResult<SocialConnection>> {
  const existing = await connectionFor(input.userId);
  const token = input.manualToken ?? existing?.manualToken ?? null;
  let locationId = input.locationId;
  let coachAssigned = existing?.coachAssigned ?? false;
  if (input.byCoach) {
    coachAssigned = true;
  } else if (existing?.coachAssigned && existing.locationId !== input.locationId) {
    if (!token) return { ok: false, error: "Your coach assigned this sub-account. To use a different one, paste its private integration token." };
    coachAssigned = false;
  } else if (!existing?.coachAssigned && !token) {
    return { ok: false, error: "Paste your sub-account's private integration token, or ask your coach to assign the sub-account from Integrations." };
  }
  if (!input.byCoach && existing?.coachAssigned && !input.manualToken) locationId = existing.locationId;
  if (existing) {
    const changedLocation = existing.locationId !== locationId;
    await db
      .update(schema.socialConnections)
      .set({ locationId, coachAssigned, ghlUserId: input.ghlUserId, manualToken: token, ...(changedLocation ? { accessToken: null, tokenExpiresAt: null, accounts: [], mapping: {} } : {}), lastError: null })
      .where(eq(schema.socialConnections.id, existing.id));
  } else {
    await db.insert(schema.socialConnections).values({ id: newId(), workspaceId: input.workspaceId, userId: input.userId, provider: "gohighlevel", locationId, coachAssigned, ghlUserId: input.ghlUserId, manualToken: token });
  }
  return { ok: true, data: (await connectionFor(input.userId))! };
}
