/** Inbound webhook handling shared by the Community Loyalty and GoHighLevel routes. */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, ensureMigrated, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { logSync, type Provider } from "@/lib/integrations";
import { award } from "@/lib/queries/points";

type Body = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

async function memberByEmailOrSerial(workspaceId: string, email: string, serial: string) {
  if (serial) {
    const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.eoPassSerial, serial)) });
    if (m) return m;
  }
  if (email) {
    const u = await db.query.users.findFirst({ where: eq(schema.users.email, email.toLowerCase()) });
    if (u) return db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, u.id)) });
  }
  return undefined;
}

export async function handleInbound(provider: Provider, request: Request): Promise<Response> {
  await ensureMigrated();
  const url = new URL(request.url);
  const secret = request.headers.get("x-helix-secret") ?? url.searchParams.get("secret") ?? "";
  if (!secret) return NextResponse.json({ error: "missing secret" }, { status: 401 });
  const integ = await db.query.integrations.findFirst({ where: and(eq(schema.integrations.provider, provider), eq(schema.integrations.inboundSecret, secret)) });
  if (!integ) return NextResponse.json({ error: "unknown secret" }, { status: 401 });
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    body = {};
  }
  const event = s(body.event ?? body.type ?? body.eventType) || "unknown";
  const email = s(body.email ?? (body.contact as Body | undefined)?.email).toLowerCase();
  const serial = s(body.serial ?? body.passSerial);
  const member = await memberByEmailOrSerial(integ.workspaceId, email, serial);
  const ctx = member ? { workspaceId: integ.workspaceId, userId: member.userId } : null;
  let note = member ? "Matched member" : "No matching member";

  if (provider === "community_loyalty") {
    if (member && /pass\.(installed|added)/.test(event)) {
      await db.update(schema.memberships).set({ eoPassInstalledAt: member.eoPassInstalledAt ?? nowIso(), eoPassSerial: serial || member.eoPassSerial }).where(eq(schema.memberships.id, member.id));
      note = "Pass marked installed";
    } else if (ctx && /points\.(earned|added)|reward/.test(event)) {
      const pts = Math.round(Number(body.points ?? 0));
      const ok = pts > 0 && (await award(ctx, "bonus", pts, s(body.reason) || "Community Loyalty reward", `cl:${s(body.id) || newId()}`));
      note = ok ? `Awarded ${pts} points` : "Nothing awarded";
    }
  } else if (provider === "gohighlevel") {
    if (ctx && /contact|opportunity|appointment/i.test(event)) {
      const name = s(body.full_name ?? body.name ?? `${s(body.first_name ?? body.firstName)} ${s(body.last_name ?? body.lastName)}`).trim();
      if (name) {
        const existing = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.userId, ctx.userId), eq(schema.contacts.name, name)) });
        const stage = /appointment/i.test(event) ? ("call_booked" as const) : ("new" as const);
        if (existing) await db.update(schema.contacts).set({ stage: existing.stage === "client" ? "client" : stage, callAt: s(body.startTime ?? body.appointmentTime) || existing.callAt }).where(eq(schema.contacts.id, existing.id));
        else await db.insert(schema.contacts).values({ id: newId(), workspaceId: ctx.workspaceId, userId: ctx.userId, name, platform: "Other", stage, source: "GoHighLevel", callAt: s(body.startTime ?? body.appointmentTime) || null });
        note = existing ? `Updated contact ${name}` : `Created contact ${name}`;
      }
    }
  }
  await logSync({ workspaceId: integ.workspaceId, userId: member?.userId ?? null, provider, direction: "in", event, payload: body, status: "received", note });
  await db.update(schema.integrations).set({ lastSyncAt: nowIso() }).where(eq(schema.integrations.id, integ.id));
  return NextResponse.json({ ok: true, note });
}
