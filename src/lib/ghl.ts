/**
 * GoHighLevel Social Planner, per client sub-account, using the client's own location-level Private Integration token.
 * (Agency-level Private Integrations expose no socialplanner/* scope and cannot mint location tokens, so there is no agency path.)
 * Verified against HighLevel's OpenAPI (apps/social-media-posting.json):
 *  - GET  /social-media-posting/{locationId}/accounts → results.accounts[]
 *  - POST /social-media-posting/{locationId}/posts → results.post
 *  - GET  /social-media-posting/{locationId}/posts/{id} → results.post (status, error, postId, publishedAt)
 *  - PUT  /social-media-posting/{locationId}/posts/{id} → edits a scheduled post in place (same body as create)
 *  - POST /social-media-posting/{locationId}/posts/list → results.posts[] (read-only listing, used by the coach's planner audit)
 * Tokens are encrypted at rest (src/lib/crypto.ts) and decrypted only for the request.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SocialAccount, SocialConnection } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { getIntegration, logSync, resolveApiUrl } from "@/lib/integrations";
import { open, seal } from "@/lib/crypto";
import { autoMap } from "@/lib/engine/ghl-map";

const VERSION = "2021-07-28";

/** The six scopes a client ticks when creating the Private Integration. Shown in the UI and named in error messages. */
export const REQUIRED_SCOPES = ["socialplanner/oauth.readonly", "socialplanner/oauth.write", "socialplanner/post.readonly", "socialplanner/post.write", "socialplanner/account.readonly", "socialplanner/account.write"] as const;

/** `error` is what a client may see and what is persisted; `detail` is the upstream reply, for the classifier and the log only. */
export type GhlResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number; detail?: string };

/** The server-side record of a failed call: status, path and the upstream body, which never reach a client or a note. */
function logGhl(what: string, detail: Record<string, unknown>): void {
  console.error(`[ghl] ${what}`, JSON.stringify(detail));
}

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
      const msg = (json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : text).slice(0, 500);
      logGhl(`upstream ${res.status}`, { status: res.status, path, body: msg });
      return { ok: false, error: `GoHighLevel didn't accept the request (${res.status}).`, status: res.status, detail: msg };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    logGhl("request failed", { path, detail });
    return { ok: false, error: "Couldn't reach GoHighLevel.", detail };
  }
}

/** Turns GoHighLevel's reply into the reason a non-technical client can act on. */
export function explain(r: { error: string; status?: number; detail?: string }): string {
  const lower = (r.detail ?? "").toLowerCase();
  if (r.status === 401) return "GoHighLevel rejected the token (401). It was pasted incompletely, or it was deleted in GoHighLevel. Create a new Private Integration and paste the new token.";
  if (r.status === 403 || lower.includes("scope")) return `The token is valid but is missing Social Planner permissions (403). Edit the Private Integration in GoHighLevel and tick all six scopes: ${REQUIRED_SCOPES.join(", ")}.`;
  if (r.status === 404 || r.status === 422 || lower.includes("location")) return "GoHighLevel says that location ID doesn't match this token (it belongs to a different sub-account, or has a typo). Copy the Location ID from Settings → Business Profile in the same sub-account where you created the token.";
  if (r.status === 429) return "GoHighLevel is rate-limiting requests (429). Wait a minute and try again.";
  if (lower.includes("abort") || lower.includes("fetch failed") || lower.includes("econn")) return "Couldn't reach GoHighLevel. Check the API base URL on Integrations, or try again in a minute.";
  // The fallthrough keeps the case and drops the vendor's words: they are in the log under [ghl].
  return `GoHighLevel didn't accept the request${r.status ? ` (${r.status})` : ""}. Try again in a minute.`;
}

export async function connectionFor(userId: string): Promise<SocialConnection | undefined> {
  return db.query.socialConnections.findFirst({ where: and(eq(schema.socialConnections.userId, userId), eq(schema.socialConnections.provider, "gohighlevel")) });
}

/** The member's own token, decrypted for this request, plus the API base. The only path there is. */
export async function credentials(conn: SocialConnection): Promise<GhlResult<{ token: string; base: string }>> {
  const integ = await getIntegration(conn.workspaceId, "gohighlevel");
  const target = resolveApiUrl("gohighlevel", integ?.config.apiUrl);
  if (!target.ok) {
    // The allowlist message names a variable for the operator who can set it, on the coach's Integrations page; a client's note gets a sentence.
    logGhl("API URL refused for a member's push", { reason: target.error });
    return { ok: false, error: "Publishing isn't set up on this server yet. Ask your coach." };
  }
  const token = open(conn.manualToken);
  if (!token) return { ok: false, error: "Paste your sub-account's Private Integration token on Settings → Publishing." };
  return { ok: true, data: { token, base: target.base } };
}

type RawAccount = { id?: string; _id?: string; name?: string; platform?: string; type?: string; isExpired?: boolean; avatar?: string; meta?: Record<string, unknown> };

/** Validates the token against the sub-account, stores its connected pages and profiles, and fills the channel map where it's obvious. */
export async function refreshAccounts(conn: SocialConnection): Promise<GhlResult<SocialAccount[]>> {
  const cred = await credentials(conn);
  if (!cred.ok) {
    await db.update(schema.socialConnections).set({ lastError: cred.error }).where(eq(schema.socialConnections.id, conn.id));
    return cred;
  }
  const r = await call<{ results?: { accounts?: RawAccount[] } }>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/accounts`);
  if (!r.ok) {
    const error = explain(r);
    await db.update(schema.socialConnections).set({ lastError: error, accounts: [], connectedAt: null }).where(eq(schema.socialConnections.id, conn.id));
    await logSync({ workspaceId: conn.workspaceId, userId: conn.userId, provider: "gohighlevel", direction: "out", event: "social.accounts", status: "failed", note: error });
    return { ok: false, error };
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
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
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
  const r = await call<{ results?: { post?: { _id?: string; id?: string } } }>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r), status: r.status };
  const id = String(r.data.results?.post?._id ?? r.data.results?.post?.id ?? "");
  return id ? { ok: true, data: { id } } : { ok: false, error: "GoHighLevel accepted the post but returned no id" };
}

/** Edits a post the Social Planner already holds (a scheduled one), keeping its id: no second copy appears in the planner. */
export async function updatePost(conn: SocialConnection, id: string, post: NewPost): Promise<GhlResult<{ id: string }>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const body = {
    accountIds: [post.accountId],
    summary: post.summary,
    media: post.media ?? [],
    status: post.scheduleDate ? "scheduled" : "published",
    scheduleDate: post.scheduleDate ?? new Date().toISOString(),
    type: post.type,
    followUpComment: post.followUpComment ?? undefined,
    userId: conn.ghlUserId ?? "",
  };
  const r = await call<unknown>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r), status: r.status };
  return { ok: true, data: { id } };
}

export type PostStatus = { status: string; error: string | null; postId: string | null; publishedAt: string | null; summary: string | null; scheduleDate: string | null; accountIds: string[] };
type RawPost = { _id?: string; id?: string; status?: string; error?: string; postId?: string; publishedAt?: string; summary?: string; scheduleDate?: string; accountIds?: unknown };

const accountIdsOf = (p: RawPost) => (Array.isArray(p.accountIds) ? p.accountIds.map(String) : []);

export async function getPost(conn: SocialConnection, id: string): Promise<GhlResult<PostStatus>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const r = await call<{ results?: { post?: RawPost } }>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts/${encodeURIComponent(id)}`);
  if (!r.ok) return { ok: false, error: explain(r), status: r.status };
  const p = r.data.results?.post ?? {};
  return { ok: true, data: { status: String(p.status ?? "unknown"), error: p.error ?? null, postId: p.postId ?? null, publishedAt: p.publishedAt ?? null, summary: p.summary ?? null, scheduleDate: p.scheduleDate ?? null, accountIds: accountIdsOf(p) } };
}

export type PlannerPost = { id: string; status: string | null; summary: string | null; scheduleDate: string | null; accountIds: string[] };

/** Read-only: the posts the Social Planner holds for this location in one state (default: scheduled). Never changes anything. */
export async function listPosts(conn: SocialConnection, type: "scheduled" | "all" = "scheduled", limit = 100): Promise<GhlResult<PlannerPost[]>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const now = Date.now();
  const body = { type, skip: "0", limit: String(limit), fromDate: new Date(now - 120 * 86400000).toISOString(), toDate: new Date(now + 400 * 86400000).toISOString(), includeUsers: "true" };
  const r = await call<{ results?: { posts?: RawPost[] } | RawPost[]; posts?: RawPost[] }>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts/list`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r), status: r.status };
  const raw = Array.isArray(r.data.results) ? r.data.results : (r.data.results?.posts ?? r.data.posts ?? []);
  return { ok: true, data: raw.map((p) => ({ id: String(p._id ?? p.id ?? ""), status: p.status ?? null, summary: p.summary ?? null, scheduleDate: p.scheduleDate ?? null, accountIds: accountIdsOf(p) })).filter((p) => p.id) };
}

/** A GoHighLevel contact in the member's own sub-account (needs contacts.write on their token; skipped otherwise). */
export async function upsertContact(conn: SocialConnection, contact: { name: string; email?: string | null; phone?: string | null; stage: string; source?: string | null }): Promise<GhlResult<{ id: string }>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const [firstName, ...rest] = contact.name.split(" ");
  const r = await call<{ contact?: { id?: string } }>(cred.data.base, cred.data.token, "/contacts/upsert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locationId: conn.locationId, firstName, lastName: rest.join(" "), email: contact.email ?? undefined, phone: contact.phone ?? undefined, source: contact.source ?? "HelixOS", tags: ["helixos", contact.stage] }) });
  if (!r.ok) return { ok: false, error: explain(r), status: r.status };
  return { ok: true, data: { id: String(r.data.contact?.id ?? "") } };
}

/**
 * Saves the member's own sub-account details. A new connection needs a token; an existing one keeps its token when the field is left blank.
 * Changing the location clears the cached accounts and channel map.
 */
export async function upsertConnection(input: { workspaceId: string; userId: string; locationId: string; ghlUserId: string | null; manualToken: string | null }): Promise<GhlResult<SocialConnection>> {
  const existing = await connectionFor(input.userId);
  const token = input.manualToken ? seal(input.manualToken.trim()) : (existing?.manualToken ?? null);
  if (!token) return { ok: false, error: "Paste the Private Integration token from your sub-account (see the steps below)." };
  if (existing) {
    const changedLocation = existing.locationId !== input.locationId;
    await db
      .update(schema.socialConnections)
      .set({ locationId: input.locationId, ghlUserId: input.ghlUserId, manualToken: token, ...(changedLocation ? { accounts: [], mapping: {}, connectedAt: null } : {}), lastError: null })
      .where(eq(schema.socialConnections.id, existing.id));
  } else {
    await db.insert(schema.socialConnections).values({ id: newId(), workspaceId: input.workspaceId, userId: input.userId, provider: "gohighlevel", locationId: input.locationId, ghlUserId: input.ghlUserId, manualToken: token });
  }
  return { ok: true, data: (await connectionFor(input.userId))! };
}
