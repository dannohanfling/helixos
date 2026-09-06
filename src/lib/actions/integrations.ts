"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { PROVIDERS } from "@/db/schema";
import { requireCoach } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { INBOUND_SECRET_COOKIE, PROVIDER_META, getIntegration, logSync, pushPassMessage, resolveApiUrl, type Provider } from "@/lib/integrations";
import { cookies } from "next/headers";
import { hashSecret, open, randomSecret, seal } from "@/lib/crypto";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";

/** The inbound secret is stored only as a hash. The plaintext rides in a short-lived cookie so the Integrations page can show it once. */
async function issueInboundSecret(provider: Provider): Promise<string> {
  const secret = randomSecret();
  const jar = await cookies();
  jar.set(INBOUND_SECRET_COOKIE, JSON.stringify({ provider, secret }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/integrations", maxAge: 600 });
  return hashSecret(secret);
}

export async function saveIntegrationAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const provider = PROVIDERS.find((p) => p === str(formData, "provider")) as Provider | undefined;
  if (!provider) return;
  const existing = await getIntegration(coach.workspace.id, provider);
  const config: Record<string, string> = { ...(existing?.config ?? {}) };
  for (const f of PROVIDER_META[provider].fields) {
    const val = str(formData, f.key);
    if (f.secret && !val) continue; // keep the stored secret when the field is left blank
    config[f.key] = f.secret ? (seal(val) ?? "") : val;
  }
  const enabled = str(formData, "enabled") === "1";
  if (existing) await db.update(schema.integrations).set({ enabled, config, lastError: null }).where(eq(schema.integrations.id, existing.id));
  else await db.insert(schema.integrations).values({ id: newId(), workspaceId: coach.workspace.id, provider, enabled, config, inboundSecretHash: await issueInboundSecret(provider) });
  refresh();
}

export async function rotateInboundSecretAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const provider = PROVIDERS.find((p) => p === str(formData, "provider"));
  if (!provider) return;
  const existing = await getIntegration(coach.workspace.id, provider);
  const inboundSecretHash = await issueInboundSecret(provider);
  if (existing) await db.update(schema.integrations).set({ inboundSecretHash }).where(eq(schema.integrations.id, existing.id));
  else await db.insert(schema.integrations).values({ id: newId(), workspaceId: coach.workspace.id, provider, enabled: false, config: {}, inboundSecretHash });
  refresh();
}

/** "I've copied it": drops the one-time cookie so the secret is gone from the page. */
export async function hideInboundSecretAction(): Promise<void> {
  await requireCoach();
  (await cookies()).delete({ name: INBOUND_SECRET_COOKIE, path: "/integrations" });
  refresh();
}

/** Sends a harmless ping so the coach can see the connection work (or fail) in the sync log. */
export async function testIntegrationAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const provider = PROVIDERS.find((p) => p === str(formData, "provider")) as Provider | undefined;
  if (!provider) return;
  if (provider === "gohighlevel") {
    await logSync({ workspaceId: coach.workspace.id, userId: coach.user.id, provider, direction: "out", event: "ping", status: "skipped", note: "GoHighLevel has no agency credential to ping. Each member's token is checked when they save it on Settings." });
    refresh();
    return;
  }
  const integ = await getIntegration(coach.workspace.id, provider);
  const target = integ?.enabled ? resolveApiUrl(provider, integ.config.apiUrl) : { ok: false as const, error: "Enable the integration and set an API URL first" };
  if (!integ || !target.ok) {
    await logSync({ workspaceId: coach.workspace.id, userId: coach.user.id, provider, direction: "out", event: "ping", status: "skipped", note: target.ok ? "Enable the integration first" : target.error });
    refresh();
    return;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(target.base, { method: "GET", headers: { Authorization: `Bearer ${open(integ.config.apiKey) ?? ""}` }, signal: ctrl.signal });
    clearTimeout(t);
    await logSync({ workspaceId: coach.workspace.id, userId: coach.user.id, provider, direction: "out", event: "ping", status: res.ok ? "sent" : "failed", note: `${res.status} ${res.statusText}` });
    await db.update(schema.integrations).set(res.ok ? { lastSyncAt: nowIso(), lastError: null } : { lastError: `${res.status} ${res.statusText}` }).where(eq(schema.integrations.id, integ.id));
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    await logSync({ workspaceId: coach.workspace.id, userId: coach.user.id, provider, direction: "out", event: "ping", status: "failed", note });
    await db.update(schema.integrations).set({ lastError: note }).where(eq(schema.integrations.id, integ.id));
  }
  refresh();
}

/* ───────── Evolve Omega pass (each member's own) ───────── */

export async function setMemberPassAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const membershipId = str(formData, "membershipId");
  await db
    .update(schema.memberships)
    .set({ eoPassUrl: opt(formData, "eoPassUrl"), eoPassSerial: opt(formData, "eoPassSerial") })
    .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, coach.workspace.id)));
  refresh();
}

export async function markPassInstalledAction(): Promise<void> {
  const { v } = await ctx();
  await db.update(schema.memberships).set({ eoPassInstalledAt: v.membership.eoPassInstalledAt ?? nowIso() }).where(eq(schema.memberships.id, v.membership.id));
  refresh();
}

export async function sendTestPushAction(): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  await pushPassMessage({ workspaceId, userId }, "HelixOS", `Hey ${v.user.name.split(" ")[0]}, your pass is connected. Points you earn show up here.`);
  refresh();
}

/** Coach broadcast to every member's pass (or one member). */
export async function broadcastPassAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const title = str(formData, "title") || "Evolve Omega";
  const body = str(formData, "body");
  if (!body) return;
  const only = opt(formData, "userId");
  const members = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, coach.workspace.id), eq(schema.memberships.role, "client")) });
  const targets = only ? members.filter((m) => m.userId === only) : members;
  for (const m of targets) await pushPassMessage({ workspaceId: coach.workspace.id, userId: m.userId }, title, body);
  refresh();
}

export async function clearSyncLogAction(): Promise<void> {
  const coach = await requireCoach();
  await db.delete(schema.syncEvents).where(and(eq(schema.syncEvents.workspaceId, coach.workspace.id), inArray(schema.syncEvents.status, ["skipped", "sent", "failed", "received"])));
  refresh();
}
