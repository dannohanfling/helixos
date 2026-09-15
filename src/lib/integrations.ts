/**
 * Outbound integrations: Community Loyalty (pass + points), GoHighLevel (contacts + pipeline), and the member's own Evolve Omega pass.
 * Every push is logged to sync_events. A missing or disabled integration is a skip, never an error.
 */
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PROVIDERS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso, wallTimeToUtc } from "@/lib/dates";
import { redactSecrets } from "@/lib/engine/redact";
import { open } from "@/lib/crypto";

export type Provider = (typeof PROVIDERS)[number];

/** Cookie that carries a just-created inbound webhook secret to the Integrations page, once (10 minutes). */
export const INBOUND_SECRET_COOKIE = "helix_inbound_secret";

export const PROVIDER_META: Record<Provider, { name: string; icon: string; blurb: string; fields: { key: string; label: string; hint?: string; secret?: boolean; toggle?: boolean }[] }> = {
  walletpush: {
    name: "WalletPush (the Evolve Omega pass)",
    icon: "🎟️",
    blurb: "The pass itself: points and push messages on each member's Evolve Omega wallet pass, through the WalletPush instance behind the Community Loyalty Mini-App. HelixOS calls it directly; the bot flows go through the Mini-App.",
    fields: [
      { key: "apiUrl", label: "Loyalty host URL", hint: "https://eloyalty.ai" },
      { key: "apiKey", label: "App key", secret: true },
      { key: "pointsRate", label: "Points multiplier", hint: "1 = HelixOS points map 1:1" },
    ],
  },
  community_loyalty: {
    name: "Community Loyalty (uChat)",
    icon: "🤖",
    blurb: "The chatbot platform. Its bot flows call the inbound webhook below when a pass is installed or points are earned inside the bot. HelixOS sends nothing to it: points and push messages go to WalletPush.",
    fields: [],
  },
  gohighlevel: {
    name: "Omnichannel Marketing System (GoHighLevel)",
    icon: "📡",
    blurb: "Social Planner publishing and contacts, through each client's own sub-account. Every member pastes their own location-level Private Integration token on Settings → Publishing; nothing agency-level is needed or stored.",
    fields: [
      { key: "apiUrl", label: "API base URL (advanced)", hint: "https://services.leadconnectorhq.com" },
      // Scopes are granted once. Until the list is final, no client is walked through creating a Private Integration.
      { key: "onboardingOpen", label: "Open Publishing setup to clients", hint: "Off until the scope list is final: a token made early has to be made again when a scope is added. Coaches always see the setup.", toggle: true },
    ],
  },
};
/** Whether a client may be walked through creating their Private Integration: the coach's switch, off by default. */
export const onboardingOpen = (config: Record<string, string> | undefined) => config?.onboardingOpen === "1";

const BUILT_IN_HOSTS: Record<Provider, string[]> = {
  gohighlevel: ["services.leadconnectorhq.com"],
  walletpush: ["eloyalty.ai"],
  community_loyalty: [],
};

/**
 * The API base an integration may call. The agency token travels with every request, so the host must be one we know:
 * a built-in host, one listed in INTEGRATION_URL_ALLOWLIST, or (outside production only) anything, so tests can point at a mock.
 */
export function resolveApiUrl(provider: Provider, configured: string | null | undefined): { ok: true; base: string } | { ok: false; error: string } {
  const raw = (configured ?? "").trim() || (BUILT_IN_HOSTS[provider][0] ? `https://${BUILT_IN_HOSTS[provider][0]}` : "");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: `API URL isn't a valid URL: ${raw}` };
  }
  const extra = (process.env.INTEGRATION_URL_ALLOWLIST ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const allowed = [...BUILT_IN_HOSTS[provider], ...extra];
  const dev = process.env.NODE_ENV !== "production";
  if (!dev && u.protocol !== "https:") return { ok: false, error: "API URL must use https" };
  if (!dev && !allowed.includes(u.hostname.toLowerCase())) return { ok: false, error: `${u.hostname} isn't an approved API host. Add it to INTEGRATION_URL_ALLOWLIST if it's right.` };
  return { ok: true, base: `${u.origin}${u.pathname.replace(/\/$/, "")}` };
}

export async function getIntegration(workspaceId: string, provider: Provider) {
  return db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, workspaceId), eq(schema.integrations.provider, provider)) });
}

export async function logSync(row: { workspaceId: string; userId?: string | null; provider: string; direction: "out" | "in"; event: string; payload?: Record<string, unknown>; status: "sent" | "received" | "failed" | "skipped"; note?: string | null }) {
  await db.insert(schema.syncEvents).values({ id: newId(), workspaceId: row.workspaceId, userId: row.userId ?? null, provider: row.provider, direction: row.direction, event: row.event, payload: row.payload ?? {}, status: row.status, note: row.note ?? null });
}

/** POSTs JSON with a short timeout. Returns a note describing the outcome. Never throws. */
async function post(url: string, body: unknown, headers: Record<string, string>): Promise<{ ok: boolean; note: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    clearTimeout(t);
    const text = redactSecrets((await res.text()).slice(0, 200));
    return { ok: res.ok, note: `${res.status} ${text}`.trim() };
  } catch (e) {
    return { ok: false, note: redactSecrets(e instanceof Error ? e.message : String(e)) };
  }
}

async function send(workspaceId: string, userId: string | null, provider: Provider, event: string, path: string, payload: Record<string, unknown>): Promise<boolean> {
  const integ = await getIntegration(workspaceId, provider);
  if (!integ || !integ.enabled) {
    await logSync({ workspaceId, userId, provider, direction: "out", event, payload, status: "skipped", note: integ ? "Integration disabled" : "Integration not configured" });
    return false;
  }
  const target = resolveApiUrl(provider, integ.config.apiUrl);
  const apiKey = open(integ.config.apiKey);
  if (!target.ok || !apiKey) {
    await logSync({ workspaceId, userId, provider, direction: "out", event, payload, status: "skipped", note: target.ok ? "Missing API key" : target.error });
    return false;
  }
  const headers: Record<string, string> = provider === "gohighlevel" ? { Authorization: `Bearer ${apiKey}`, Version: "2021-07-28" } : { Authorization: `Bearer ${apiKey}` };
  const r = await post(`${target.base}${path}`, payload, headers);
  await logSync({ workspaceId, userId, provider, direction: "out", event, payload, status: r.ok ? "sent" : "failed", note: r.note });
  await db.update(schema.integrations).set(r.ok ? { lastSyncAt: nowIso(), lastError: null } : { lastError: r.note }).where(eq(schema.integrations.id, integ.id));
  return r.ok;
}

/**
 * Points earned in HelixOS go to the member's Evolve Omega pass, which is a WalletPush pass. Silent when nothing is configured.
 * The path and body here are the 6 September placeholder and have never been verified against the service: WalletPush's own
 * call is POST {host}/api/public/admin/points/add with { customerId, points, reason } (read off a live flow node on 15 Sep),
 * keyed on the customer id, not the pass serial. Rebuilt only once the sync log has said whether a push ever succeeded.
 */
export async function pushPoints(ctx: { workspaceId: string; userId: string }, points: number, reason: string): Promise<void> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, ctx.userId)) });
  if (!m?.eoPassSerial) return;
  const integ = await getIntegration(ctx.workspaceId, "walletpush");
  if (!integ?.enabled) return;
  const rate = Number(integ.config.pointsRate ?? "1") || 1;
  await send(ctx.workspaceId, ctx.userId, "walletpush", "points.add", "/v1/points", { serial: m.eoPassSerial, points: Math.round(points * rate), reason });
}

/** A booked call or a new client becomes a contact in the member's own GoHighLevel sub-account (their token needs contacts.write; skipped with a note otherwise). */
/**
 * Pushes one person to the member's own GoHighLevel sub-account under the identity rule (src/lib/engine/contact-sync.ts):
 * a stored GoHighLevel id is updated in place; otherwise an email, a phone or a chatbot id is required for the first push,
 * whose returned id is stored on the row; a name alone makes no call and says why in the sync log. The failure of a push is
 * written on the sync log; the contact itself says whether it has an identity to sync with.
 */
export async function pushContact(ctx: { workspaceId: string; userId: string }, person: { kind: "contact" | "client"; rowId: string; ghlContactId?: string | null; name: string; email?: string | null; phone?: string | null; userNs?: string | null; stage: string; source?: string | null }): Promise<{ ok: boolean; note: string }> {
  const integ = await getIntegration(ctx.workspaceId, "gohighlevel");
  if (!integ?.enabled) return { ok: false, note: "GoHighLevel is off" };
  const { connectionFor, updateContact, upsertContact } = await import("@/lib/ghl");
  const { NO_IDENTITY_NOTE, identityOf, pushedNote } = await import("@/lib/engine/contact-sync");
  const conn = await connectionFor(ctx.userId);
  const payload = { name: person.name, stage: person.stage, kind: person.kind, rowId: person.rowId };
  const log = (status: "sent" | "failed" | "skipped", note: string) => logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event: "contact.upsert", payload, status, note });
  if (!conn) {
    await log("skipped", "Member hasn't connected their sub-account on Settings");
    return { ok: false, note: "not connected" };
  }
  // No identity, no call: a name alone would create an orphan in the client's CRM, and a second push a second one.
  if (!person.ghlContactId && !identityOf(person)) {
    await log("skipped", NO_IDENTITY_NOTE);
    return { ok: false, note: NO_IDENTITY_NOTE };
  }
  const r = person.ghlContactId ? await updateContact(conn, person.ghlContactId, person) : await upsertContact(conn, person);
  if (!r.ok) {
    await log("failed", r.error);
    return { ok: false, note: r.error };
  }
  if (!person.ghlContactId) {
    const table = person.kind === "client" ? schema.clientRecords : schema.contacts;
    await db.update(table).set({ ghlContactId: r.data.id }).where(eq(table.id, person.rowId));
  }
  const note = pushedNote(r.data, conn.locationId);
  await log("sent", note);
  await db.update(schema.integrations).set({ lastSyncAt: nowIso() }).where(eq(schema.integrations.id, integ.id));
  return { ok: true, note };
}

/**
 * Publishes one channel version through the member's own GoHighLevel sub-account (Social Planner).
 * Writes GHL's post id and status back onto the variant so the Distribute page can show what happened.
 * A variant the Social Planner already holds as scheduled is edited in place under the same id, so re-scheduling or
 * pushing an update never leaves a second copy in the planner.
 */
export async function pushSocialPost(ctx: { workspaceId: string; userId: string; tz: string }, post: { variantId: string; channel: string; body: string; postAt: string | null; mediaUrl?: string | null; title?: string; followUpComment?: string | null }): Promise<boolean> {
  const { connectionFor, createPost, updatePost } = await import("@/lib/ghl");
  const { PUBLISHABLE, mediaTypeFor, postTypeFor } = await import("@/lib/engine/ghl-map");
  const channel = post.channel as keyof typeof PUBLISHABLE;
  // "manual" is a channel that is pasted by design; "failed" is something the client can fix, said beside the post.
  const skip = async (note: string, as: "manual" | "failed" = "manual") => {
    await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event: "social.schedule", payload: { channel: post.channel, postAt: post.postAt }, status: "skipped", note });
    await db.update(schema.contentVariants).set({ externalStatus: as, externalError: note, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, post.variantId));
    return false;
  };
  if (!PUBLISHABLE[channel]?.via) return skip(PUBLISHABLE[channel]?.note ?? "This channel is posted by hand");
  const conn = await connectionFor(ctx.userId);
  if (!conn) return skip("Connect your GoHighLevel sub-account in Settings to auto-publish");
  const accountId = conn.mapping[post.channel];
  if (channel === "stories" && !post.mediaUrl) return skip("Stories need a photo or video");
  // The Social Planner requires the posting user (CreatePostDTO: type, accountIds, userId). Without one the post is refused
  // with a validation error, so it is refused here first, with the place to fix it.
  if (!conn.ghlUserId?.trim()) return skip("Add your GHL user ID on Settings → Publishing; the Social Planner won't take a post without it", "failed");
  if (!accountId) return skip(`No ${PUBLISHABLE[channel].note} chosen for this channel in Settings`);
  // postAt is a wall time in the member's own zone; the Social Planner wants the UTC instant, with milliseconds and a Z.
  const scheduleDate = post.postAt ? wallTimeToUtc(post.postAt, ctx.tz) : null;
  if (post.postAt && !scheduleDate) return skip("The schedule time couldn't be read. Set the date and time again and re-schedule.", "failed");
  const variant = await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, post.variantId) });
  const held = variant?.externalId && variant.externalStatus === "scheduled" ? variant.externalId : null;
  const event = held ? "social.update" : "social.schedule";
  const draft = { accountId, summary: post.body, type: postTypeFor(channel), scheduleDate, media: post.mediaUrl ? [{ url: post.mediaUrl, type: mediaTypeFor(post.mediaUrl) }] : [], followUpComment: post.followUpComment };
  const r = held ? await updatePost(conn, held, draft) : await createPost(conn, draft);
  if (!r.ok) {
    await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event, payload: { channel: post.channel, postAt: post.postAt, scheduleDate, accountId, ghlPostId: held ?? undefined }, status: "failed", note: r.error });
    // The post's failure is said on the post (Distribute page) and in the sync log; the connection itself is not marked broken by it.
    await db.update(schema.contentVariants).set({ externalStatus: "failed", externalError: r.error, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, post.variantId));
    return false;
  }
  await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event, payload: { channel: post.channel, postAt: post.postAt, scheduleDate, accountId, ghlPostId: r.data.id }, status: "sent", note: `${held ? "Updated in" : scheduleDate ? "Scheduled via" : "Published via"} Social Planner · ${r.data.id}` });
  await db.update(schema.contentVariants).set({ externalId: r.data.id, externalStatus: scheduleDate ? "scheduled" : "published", externalError: null, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, post.variantId));
  // A push is not a check: "checked" on Settings moves only when the accounts call runs.
  await db.update(schema.socialConnections).set({ lastError: null }).where(eq(schema.socialConnections.id, conn.id));
  return true;
}

/** A push notification to one member's Evolve Omega pass. Same placeholder status as pushPoints: the WalletPush path is not yet verified. */
export async function pushPassMessage(ctx: { workspaceId: string; userId: string }, title: string, body: string): Promise<boolean> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, ctx.userId)) });
  if (!m?.eoPassSerial) {
    await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "walletpush", direction: "out", event: "pass.push", payload: { title, body }, status: "skipped", note: "Member has no Evolve Omega pass yet" });
    return false;
  }
  const ok = await send(ctx.workspaceId, ctx.userId, "walletpush", "pass.push", "/v1/passes/push", { serial: m.eoPassSerial, title, body });
  await db.update(schema.memberships).set({ eoPassLastPushAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  return ok;
}

/**
 * Runs an integration push after the response is sent, and keeps the serverless invocation alive until it settles: a bare
 * detached promise is frozen with the function the moment the action returns, so the fetch never completes and nothing is
 * written down. Never breaks the action that triggered it. Outside a request (a script, a test) the promise simply runs.
 */
export function background(p: Promise<unknown>): void {
  const settled = p.catch((e) => console.error("[integrations]", e instanceof Error ? e.message : e));
  try {
    after(settled);
  } catch (e) {
    // No request scope (a script, a test), or a host without waitUntil: the promise is already running, detached. Say so.
    console.warn("[integrations] after() unavailable, running detached:", e instanceof Error ? e.message : e);
  }
}
