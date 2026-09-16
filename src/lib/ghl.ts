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
import { explainGhl, type GhlCall } from "@/lib/engine/ghl-errors";
import { redactSecrets } from "@/lib/engine/redact";
import { USER_NS_FIELD_KEY, clean } from "@/lib/engine/contact-sync";

const VERSION = "2021-07-28";

/** The six scopes a client ticks when creating the Private Integration. Shown in the UI and named in error messages. */
export { REQUIRED_SCOPES } from "@/lib/engine/ghl-errors";

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
      const raw = json && typeof json === "object" && "message" in json ? (json as { message: unknown }).message : text;
      // Nothing token-shaped survives into the log or the classifier's detail, whoever put it in the body.
      const msg = redactSecrets((Array.isArray(raw) ? raw.map(String).join("; ") : String(raw)).slice(0, 500));
      logGhl(`upstream ${res.status}`, { status: res.status, path, body: msg });
      return { ok: false, error: `GoHighLevel didn't accept the request (${res.status}).`, status: res.status, detail: msg };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    const detail = redactSecrets(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    logGhl("request failed", { path, detail });
    return { ok: false, error: "Couldn't reach GoHighLevel.", detail };
  }
}

/** Turns GoHighLevel's reply into the reason a non-technical client can act on, by the call that was made (src/lib/engine/ghl-errors.ts). */
export const explain = (r: { error: string; status?: number; detail?: string }, call: GhlCall): string => explainGhl(r, call);

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
    return { ok: false, error: "Publishing isn't set up yet. Ask your coach." };
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
    const error = explain(r, "accounts");
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
export async function createPost(conn: SocialConnection, post: NewPost): Promise<GhlResult<{ id: string | null }>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const body = {
    accountIds: [post.accountId],
    summary: post.summary,
    media: post.media ?? [],
    // The reference call that works: an immediate post is status "published" with no scheduleDate; a scheduled one carries the UTC instant.
    status: post.scheduleDate ? "scheduled" : "published",
    scheduleDate: post.scheduleDate ?? undefined,
    type: post.type,
    followUpComment: post.followUpComment ?? undefined,
    userId: conn.ghlUserId ?? "",
  };
  const r = await call<{ results?: { post?: { _id?: string; id?: string } } }>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r, "post"), status: r.status };
  const id = String(r.data.results?.post?._id ?? r.data.results?.post?.id ?? "");
  // Seen live 15 Sep: a 2xx with no id in results.post for an immediate post that was published within the minute. That is
  // accepted, not failed; the id is found from the planner's own list on the next check. The body's shape goes to the log
  // (keys only, never the text) so the next time it is known rather than guessed.
  if (!id) {
    const shape = (o: unknown): unknown => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, v && typeof v === "object" ? shape(v) : typeof v])) : Array.isArray(o) ? `array(${o.length})` : typeof o);
    console.warn("[ghl] create returned 2xx without an id", JSON.stringify({ shape: shape(r.data) }).slice(0, 600));
  }
  return { ok: true, data: { id: id || null } };
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
    scheduleDate: post.scheduleDate ?? undefined,
    // The planner keys a re-schedule on this flag (PostCreateRequest.scheduleTimeUpdated: "if schedule datetime is updated").
    scheduleTimeUpdated: post.scheduleDate ? true : undefined,
    type: post.type,
    followUpComment: post.followUpComment ?? undefined,
    userId: conn.ghlUserId ?? "",
  };
  const r = await call<unknown>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r, "post"), status: r.status };
  return { ok: true, data: { id } };
}

export type PostStatus = { status: string; error: string | null; postId: string | null; publishedAt: string | null; summary: string | null; scheduleDate: string | null; accountIds: string[] };
type RawPost = { _id?: string; id?: string; status?: string; error?: string; postId?: string; publishedAt?: string; createdAt?: string; summary?: string; scheduleDate?: string; accountIds?: unknown };

const accountIdsOf = (p: RawPost) => (Array.isArray(p.accountIds) ? p.accountIds.map(String) : []);

export async function getPost(conn: SocialConnection, id: string): Promise<GhlResult<PostStatus>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const r = await call<{ results?: { post?: RawPost } }>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts/${encodeURIComponent(id)}`);
  if (!r.ok) return { ok: false, error: explain(r, "post"), status: r.status };
  const p = r.data.results?.post ?? {};
  return { ok: true, data: { status: String(p.status ?? "unknown"), error: p.error ?? null, postId: p.postId ?? null, publishedAt: p.publishedAt ?? null, summary: p.summary ?? null, scheduleDate: p.scheduleDate ?? null, accountIds: accountIdsOf(p) } };
}

export type PlannerPost = { id: string; status: string | null; summary: string | null; scheduleDate: string | null; accountIds: string[]; createdAt: string | null; publishedAt: string | null };

/** Read-only: the posts the Social Planner holds for this location in one state (default: scheduled). Never changes anything. */
export async function listPosts(conn: SocialConnection, type: "scheduled" | "all" = "scheduled", limit = 100): Promise<GhlResult<PlannerPost[]>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const now = Date.now();
  const body = { type, skip: "0", limit: String(limit), fromDate: new Date(now - 120 * 86400000).toISOString(), toDate: new Date(now + 400 * 86400000).toISOString(), includeUsers: "true" };
  const r = await call<{ results?: { posts?: RawPost[] } | RawPost[]; posts?: RawPost[] }>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts/list`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r, "post"), status: r.status };
  const raw = Array.isArray(r.data.results) ? r.data.results : (r.data.results?.posts ?? r.data.posts ?? []);
  return { ok: true, data: raw.map((p) => ({ id: String(p._id ?? p.id ?? ""), status: p.status ?? null, summary: p.summary ?? null, scheduleDate: p.scheduleDate ?? null, accountIds: accountIdsOf(p), createdAt: p.createdAt ?? null, publishedAt: p.publishedAt ?? null })).filter((p) => p.id) };
}

/**
 * The posts the planner holds for one account inside a window, with the planner's own count when it gives one. The reconcile
 * reads this rather than the whole list, so it does not depend on how the planner orders a list longer than one page.
 */
export async function listPostsIn(conn: SocialConnection, opts: { accountId: string; fromIso: string; toIso: string; limit?: number }): Promise<GhlResult<{ posts: PlannerPost[]; total: number | null }>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const limit = opts.limit ?? 100;
  const body = { type: "all", accounts: opts.accountId, skip: "0", limit: String(limit), fromDate: opts.fromIso, toDate: opts.toIso, includeUsers: "false" };
  const r = await call<{ results?: { posts?: RawPost[]; count?: number } | RawPost[]; posts?: RawPost[]; count?: number }>(cred.data.base, cred.data.token, `/social-media-posting/${conn.locationId}/posts/list`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r, "post"), status: r.status };
  const raw = Array.isArray(r.data.results) ? r.data.results : (r.data.results?.posts ?? r.data.posts ?? []);
  const count = Array.isArray(r.data.results) ? null : (r.data.results?.count ?? r.data.count ?? null);
  const posts = raw.map((p) => ({ id: String(p._id ?? p.id ?? ""), status: p.status ?? null, summary: p.summary ?? null, scheduleDate: p.scheduleDate ?? null, accountIds: accountIdsOf(p), createdAt: p.createdAt ?? null, publishedAt: p.publishedAt ?? null })).filter((p) => p.id);
  return { ok: true, data: { posts, total: typeof count === "number" ? count : null } };
}

/** A GoHighLevel contact in the member's own sub-account (needs contacts.write on their token; skipped otherwise). */
export type ContactPush = { name: string; email?: string | null; phone?: string | null; userNs?: string | null; stage: string; source?: string | null };
/**
 * The first push for a person: GoHighLevel matches on email or phone under the sub-account's own duplicate setting and says
 * whether it created or linked (`new`). The chatbot id, when that is the identity, goes into the custom field the sub-account
 * holds for it. The id that comes back is the join from then on. Needs contacts.write.
 */
export async function upsertContact(conn: SocialConnection, contact: ContactPush): Promise<GhlResult<{ id: string; isNew: boolean | null }>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const [firstName, ...rest] = contact.name.split(" ");
  const email = clean(contact.email);
  const phone = clean(contact.phone);
  const userNs = clean(contact.userNs);
  const body = {
    locationId: conn.locationId,
    firstName,
    lastName: rest.join(" ") || undefined,
    email: email ?? undefined,
    phone: phone ?? undefined,
    source: contact.source ?? "HelixOS",
    tags: [`helixos:${contact.stage}`],
    customFields: userNs ? [{ key: USER_NS_FIELD_KEY, field_value: userNs }] : undefined,
  };
  const r = await call<{ new?: boolean; contact?: { id?: string } }>(cred.data.base, cred.data.token, "/contacts/upsert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r, "contact"), status: r.status };
  const id = String(r.data.contact?.id ?? "");
  if (!id) return { ok: false, error: "GoHighLevel accepted the contact but returned no id" };
  return { ok: true, data: { id, isNew: typeof r.data.new === "boolean" ? r.data.new : null } };
}

/** Every push after the first: the stored id is the target, and no matching happens. Needs contacts.write. */
export async function updateContact(conn: SocialConnection, ghlContactId: string, contact: ContactPush): Promise<GhlResult<{ id: string; isNew: null }>> {
  const cred = await credentials(conn);
  if (!cred.ok) return cred;
  const [firstName, ...rest] = contact.name.split(" ");
  const body = {
    firstName,
    lastName: rest.join(" ") || undefined,
    email: clean(contact.email) ?? undefined,
    phone: clean(contact.phone) ?? undefined,
    tags: [`helixos:${contact.stage}`],
  };
  const r = await call<unknown>(cred.data.base, cred.data.token, `/contacts/${encodeURIComponent(ghlContactId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { ok: false, error: explain(r, "contact"), status: r.status };
  return { ok: true, data: { id: ghlContactId, isNew: null } };
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
