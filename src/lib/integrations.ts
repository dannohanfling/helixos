/**
 * Outbound integrations: Community Loyalty (pass + points), GoHighLevel (contacts + pipeline), and the member's own Evolve Omega pass.
 * Every push is logged to sync_events. A missing or disabled integration is a skip, never an error.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PROVIDERS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { open } from "@/lib/crypto";

export type Provider = (typeof PROVIDERS)[number];

/** Cookie that carries a just-created inbound webhook secret to the Integrations page, once (10 minutes). */
export const INBOUND_SECRET_COOKIE = "helix_inbound_secret";

export const PROVIDER_META: Record<Provider, { name: string; icon: string; blurb: string; fields: { key: string; label: string; hint?: string; secret?: boolean }[] }> = {
  community_loyalty: {
    name: "Community Loyalty",
    icon: "🎟️",
    blurb: "Wallet passes, points and push notifications. Points earned in HelixOS flow to each member's Evolve Omega pass.",
    fields: [
      { key: "apiUrl", label: "API base URL", hint: "https://api.communityloyalty.app" },
      { key: "apiKey", label: "API key", secret: true },
      { key: "programId", label: "Loyalty program ID" },
      { key: "pointsRate", label: "Points multiplier", hint: "1 = HelixOS points map 1:1" },
    ],
  },
  gohighlevel: {
    name: "Omnichannel Marketing System (GoHighLevel)",
    icon: "📡",
    blurb: "Social Planner publishing and contacts, through each client's own sub-account. Every member pastes their own location-level Private Integration token on Settings → Publishing; nothing agency-level is needed or stored.",
    fields: [{ key: "apiUrl", label: "API base URL (advanced)", hint: "https://services.leadconnectorhq.com" }],
  },
};

const BUILT_IN_HOSTS: Record<Provider, string[]> = {
  gohighlevel: ["services.leadconnectorhq.com"],
  community_loyalty: ["api.communityloyalty.app"],
};

/**
 * The API base an integration may call. The agency token travels with every request, so the host must be one we know:
 * a built-in host, one listed in INTEGRATION_URL_ALLOWLIST, or (outside production only) anything, so tests can point at a mock.
 */
export function resolveApiUrl(provider: Provider, configured: string | null | undefined): { ok: true; base: string } | { ok: false; error: string } {
  const raw = (configured ?? "").trim() || `https://${BUILT_IN_HOSTS[provider][0]}`;
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
    const text = (await res.text()).slice(0, 200);
    return { ok: res.ok, note: `${res.status} ${text}`.trim() };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : String(e) };
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

/** Points earned in HelixOS go to the member's Evolve Omega pass. Silent when nothing is configured. */
export async function pushPoints(ctx: { workspaceId: string; userId: string }, points: number, reason: string): Promise<void> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, ctx.userId)) });
  if (!m?.eoPassSerial) return;
  const integ = await getIntegration(ctx.workspaceId, "community_loyalty");
  if (!integ?.enabled) return;
  const rate = Number(integ.config.pointsRate ?? "1") || 1;
  await send(ctx.workspaceId, ctx.userId, "community_loyalty", "points.add", "/v1/points", { programId: integ.config.programId ?? "", serial: m.eoPassSerial, points: Math.round(points * rate), reason });
}

/** A booked call or a new client becomes a contact in the member's own GoHighLevel sub-account (their token needs contacts.write; skipped with a note otherwise). */
export async function pushContact(ctx: { workspaceId: string; userId: string }, contact: { name: string; email?: string | null; phone?: string | null; stage: string; source?: string | null }): Promise<void> {
  const integ = await getIntegration(ctx.workspaceId, "gohighlevel");
  if (!integ?.enabled) return;
  const { connectionFor, upsertContact } = await import("@/lib/ghl");
  const conn = await connectionFor(ctx.userId);
  const payload = { name: contact.name, stage: contact.stage };
  if (!conn) {
    await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event: "contact.upsert", payload, status: "skipped", note: "Member hasn't connected their sub-account on Settings" });
    return;
  }
  const r = await upsertContact(conn, contact);
  await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event: "contact.upsert", payload, status: r.ok ? "sent" : "failed", note: r.ok ? `Contact ${r.data.id || "upserted"} in ${conn.locationId}` : r.error });
  if (r.ok) await db.update(schema.integrations).set({ lastSyncAt: nowIso() }).where(eq(schema.integrations.id, integ.id));
}

/**
 * Publishes one channel version through the member's own GoHighLevel sub-account (Social Planner).
 * Writes GHL's post id and status back onto the variant so the Distribute page can show what happened.
 * A variant the Social Planner already holds as scheduled is edited in place under the same id, so re-scheduling or
 * pushing an update never leaves a second copy in the planner.
 */
export async function pushSocialPost(ctx: { workspaceId: string; userId: string }, post: { variantId: string; channel: string; body: string; postAt: string | null; mediaUrl?: string | null; title?: string; followUpComment?: string | null }): Promise<boolean> {
  const { connectionFor, createPost, updatePost } = await import("@/lib/ghl");
  const { PUBLISHABLE, mediaTypeFor, postTypeFor } = await import("@/lib/engine/ghl-map");
  const channel = post.channel as keyof typeof PUBLISHABLE;
  const skip = async (note: string) => {
    await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event: "social.schedule", payload: { channel: post.channel, postAt: post.postAt }, status: "skipped", note });
    await db.update(schema.contentVariants).set({ externalStatus: "manual", externalError: note, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, post.variantId));
    return false;
  };
  if (!PUBLISHABLE[channel]?.via) return skip(PUBLISHABLE[channel]?.note ?? "This channel is posted by hand");
  const conn = await connectionFor(ctx.userId);
  if (!conn) return skip("Connect your GoHighLevel sub-account in Settings to auto-publish");
  const accountId = conn.mapping[post.channel];
  if (!accountId) return skip(`No ${PUBLISHABLE[channel].note} chosen for this channel in Settings`);
  if (channel === "stories" && !post.mediaUrl) return skip("Stories need a photo or video");
  const scheduleDate = post.postAt ? new Date(post.postAt).toISOString() : null;
  const variant = await db.query.contentVariants.findFirst({ where: eq(schema.contentVariants.id, post.variantId) });
  const held = variant?.externalId && variant.externalStatus === "scheduled" ? variant.externalId : null;
  const event = held ? "social.update" : "social.schedule";
  const draft = { accountId, summary: post.body, type: postTypeFor(channel), scheduleDate, media: post.mediaUrl ? [{ url: post.mediaUrl, type: mediaTypeFor(post.mediaUrl) }] : [], followUpComment: post.followUpComment };
  const r = held ? await updatePost(conn, held, draft) : await createPost(conn, draft);
  if (!r.ok) {
    await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event, payload: { channel: post.channel, postAt: post.postAt, accountId, ghlPostId: held ?? undefined }, status: "failed", note: r.error });
    await db.update(schema.contentVariants).set({ externalStatus: "failed", externalError: r.error, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, post.variantId));
    await db.update(schema.socialConnections).set({ lastError: r.error }).where(eq(schema.socialConnections.id, conn.id));
    return false;
  }
  await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "gohighlevel", direction: "out", event, payload: { channel: post.channel, postAt: post.postAt, accountId, ghlPostId: r.data.id }, status: "sent", note: `${held ? "Updated in" : scheduleDate ? "Scheduled via" : "Published via"} Social Planner · ${r.data.id}` });
  await db.update(schema.contentVariants).set({ externalId: r.data.id, externalStatus: scheduleDate ? "scheduled" : "published", externalError: null, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, post.variantId));
  await db.update(schema.socialConnections).set({ lastSyncAt: nowIso(), lastError: null }).where(eq(schema.socialConnections.id, conn.id));
  return true;
}

/** A push notification to one member's Evolve Omega pass. */
export async function pushPassMessage(ctx: { workspaceId: string; userId: string }, title: string, body: string): Promise<boolean> {
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, ctx.userId)) });
  if (!m?.eoPassSerial) {
    await logSync({ workspaceId: ctx.workspaceId, userId: ctx.userId, provider: "community_loyalty", direction: "out", event: "pass.push", payload: { title, body }, status: "skipped", note: "Member has no Evolve Omega pass yet" });
    return false;
  }
  const integ = await getIntegration(ctx.workspaceId, "community_loyalty");
  const ok = await send(ctx.workspaceId, ctx.userId, "community_loyalty", "pass.push", "/v1/passes/push", { programId: integ?.config.programId ?? "", serial: m.eoPassSerial, title, body });
  await db.update(schema.memberships).set({ eoPassLastPushAt: nowIso() }).where(eq(schema.memberships.id, m.id));
  return ok;
}

/** Fire-and-forget wrapper: integrations never break the action that triggered them. */
export function background(p: Promise<unknown>): void {
  p.catch((e) => console.error("[integrations]", e instanceof Error ? e.message : e));
}
