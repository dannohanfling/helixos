/**
 * Outbound integrations: Community Loyalty (pass + points), GoHighLevel (contacts + pipeline), and the member's own Evolve Omega pass.
 * Every push is logged to sync_events. A missing or disabled integration is a skip, never an error.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PROVIDERS } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";

export type Provider = (typeof PROVIDERS)[number];

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
    blurb: "Contacts, pipelines, SMS and email. Booked calls and new clients become contacts and opportunities in your sub-account.",
    fields: [
      { key: "apiUrl", label: "API base URL", hint: "https://services.leadconnectorhq.com" },
      { key: "apiKey", label: "Private integration token", secret: true },
      { key: "locationId", label: "Location (sub-account) ID" },
      { key: "pipelineId", label: "Pipeline ID", hint: "Where booked calls land" },
      { key: "stageId", label: "Pipeline stage ID" },
      { key: "webhookUrl", label: "Inbound webhook URL (optional)", hint: "A GHL workflow webhook to post events into" },
    ],
  },
};

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
  const base = (integ.config.apiUrl ?? "").replace(/\/$/, "");
  if (!base || !integ.config.apiKey) {
    await logSync({ workspaceId, userId, provider, direction: "out", event, payload, status: "skipped", note: "Missing API URL or key" });
    return false;
  }
  const headers: Record<string, string> = provider === "gohighlevel" ? { Authorization: `Bearer ${integ.config.apiKey}`, Version: "2021-07-28" } : { Authorization: `Bearer ${integ.config.apiKey}` };
  const r = await post(`${base}${path}`, payload, headers);
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

/** A booked call or a new client becomes a GoHighLevel contact (and an opportunity when a pipeline is set). */
export async function pushContact(ctx: { workspaceId: string; userId: string }, contact: { name: string; email?: string | null; phone?: string | null; stage: string; source?: string | null }): Promise<void> {
  const integ = await getIntegration(ctx.workspaceId, "gohighlevel");
  if (!integ?.enabled) return;
  const [firstName, ...rest] = contact.name.split(" ");
  const ok = await send(ctx.workspaceId, ctx.userId, "gohighlevel", "contact.upsert", "/contacts/upsert", { locationId: integ.config.locationId ?? "", firstName, lastName: rest.join(" "), email: contact.email ?? undefined, phone: contact.phone ?? undefined, source: contact.source ?? "HelixOS", tags: ["helixos", contact.stage] });
  if (ok && integ.config.pipelineId && contact.stage === "call_booked") {
    await send(ctx.workspaceId, ctx.userId, "gohighlevel", "opportunity.create", "/opportunities/", { locationId: integ.config.locationId ?? "", pipelineId: integ.config.pipelineId, pipelineStageId: integ.config.stageId ?? "", name: `${contact.name} · call`, status: "open", source: "HelixOS" });
  }
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
