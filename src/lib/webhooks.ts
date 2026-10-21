/**
 * Inbound webhook handling shared by the Community Loyalty and GoHighLevel routes.
 *
 * Two ways a call proves itself:
 *  1. `x-helix-secret` header: the per-workspace inbound secret from the Integrations page. Only its sha256 is stored, so the
 *     row is found by hashing what was presented. This is what a GoHighLevel workflow "Webhook" action or Community Loyalty sends
 *     (they can only attach static headers). The secret is never accepted in the query string: URLs end up in hosting and CDN logs.
 *  2. `x-ghl-signature` header: GoHighLevel's Ed25519 signature over the raw body, sent for marketplace-app webhooks. Verified with
 *     GHL_WEBHOOK_PUBLIC_KEY (from the HighLevel developer portal). The sub-account is identified by the payload's `locationId`,
 *     matched against a member's connected sub-account. Nothing secret is stored on our side for this path.
 */
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";
import { logSync, type Provider } from "@/lib/integrations";
import { award } from "@/lib/queries/points";
import { hashSecret, verifyEd25519 } from "@/lib/crypto";
import { catalogue, matchClaimForAppointment } from "@/lib/engine/rewards";
import { loadRewardsConfig } from "@/lib/rewards-config";
import prizes from "@/data/seed/prizes.json";
import rewards from "@/data/seed/rewards.json";

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

type Auth = { integ: schema.Integration; via: "secret" | "signature"; member?: schema.Membership };

/** Resolves the workspace integration the call is for, or a 401 response. */
/** The workspace integration a presented inbound secret belongs to, by its hash; the secret itself is never stored. */
export async function integrationForSecret(provider: Provider, secret: string): Promise<schema.Integration | null> {
  if (!secret) return null;
  return (await db.query.integrations.findFirst({ where: and(eq(schema.integrations.provider, provider), eq(schema.integrations.inboundSecretHash, hashSecret(secret))) })) ?? null;
}

async function authenticate(provider: Provider, request: Request, raw: string, body: Body): Promise<Auth | Response> {
  const secret = request.headers.get("x-helix-secret") ?? "";
  if (secret) {
    const integ = await integrationForSecret(provider, secret);
    if (!integ) return NextResponse.json({ error: "unknown secret" }, { status: 401 });
    return { integ, via: "secret" };
  }
  const signature = request.headers.get("x-ghl-signature") ?? "";
  if (provider === "gohighlevel" && signature) {
    const publicKey = process.env.GHL_WEBHOOK_PUBLIC_KEY ?? "";
    if (!publicKey) return NextResponse.json({ error: "signature verification is not configured (GHL_WEBHOOK_PUBLIC_KEY)" }, { status: 401 });
    if (!verifyEd25519(raw, signature, publicKey)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
    const locationId = s(body.locationId);
    const conn = locationId ? await db.query.socialConnections.findFirst({ where: and(eq(schema.socialConnections.provider, "gohighlevel"), eq(schema.socialConnections.locationId, locationId)) }) : undefined;
    if (!conn) return NextResponse.json({ error: "no member has connected this location" }, { status: 401 });
    const [integ, member] = await Promise.all([
      db.query.integrations.findFirst({ where: and(eq(schema.integrations.workspaceId, conn.workspaceId), eq(schema.integrations.provider, provider)) }),
      db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, conn.workspaceId), eq(schema.memberships.userId, conn.userId)) }),
    ]);
    if (!integ || !member) return NextResponse.json({ error: "integration not set up for this workspace" }, { status: 401 });
    return { integ, via: "signature", member };
  }
  if (new URL(request.url).searchParams.has("secret")) return NextResponse.json({ error: "send the secret as the x-helix-secret header, not in the URL" }, { status: 401 });
  return NextResponse.json({ error: "missing x-helix-secret header" }, { status: 401 });
}

/**
 * Earn Your Way: a member's appointment lands on one of their open reward claims, so the coach sees "booked", not just
 * "opened the link". Only claims whose reward has a booking link can be booked. Ambiguity is reported, never guessed.
 */
async function bookClaim(ctx: { workspaceId: string; userId: string }, calendarId: string, callAt: string, ref: string): Promise<string> {
  const config = loadRewardsConfig();
  const linked = new Set(catalogue(rewards, prizes, config).filter((i) => i.bookingUrl).map((i) => i.name));
  const claims = await db.query.rewardClaims.findMany({ where: and(eq(schema.rewardClaims.workspaceId, ctx.workspaceId), eq(schema.rewardClaims.userId, ctx.userId)) });
  const open = claims.filter((c) => !c.bookedAt && linked.has(c.rewardName)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const match = matchClaimForAppointment(open, calendarId, config.calendarIds ?? {});
  if (match.claim) await db.update(schema.rewardClaims).set({ bookedAt: callAt || nowIso(), bookedRef: ref || null }).where(eq(schema.rewardClaims.id, match.claim.id));
  return match.note;
}

export async function handleInbound(provider: Provider, request: Request): Promise<Response> {
  const raw = await request.text();
  let body: Body = {};
  try {
    body = raw ? (JSON.parse(raw) as Body) : {};
  } catch {
    body = {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
  const auth = await authenticate(provider, request, raw, body);
  if (auth instanceof Response) return auth;
  const { integ } = auth;
  const event = s(body.event ?? body.type ?? body.eventType) || "unknown";
  const email = s(body.email ?? (body.contact as Body | undefined)?.email).toLowerCase();
  const serial = s(body.serial ?? body.passSerial);
  const member = auth.member ?? (await memberByEmailOrSerial(integ.workspaceId, email, serial));
  const ctx = member ? { workspaceId: integ.workspaceId, userId: member.userId } : null;
  let note = member ? `Matched member (${auth.via})` : "No matching member";

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
    // The Partner Program (H-1361 PR B): GHL's Custom Webhook sends gnc.order_paid and gnc.onboarding_submitted; the log keeps the
    // ids and the business, never the owner's contact.
    if (/^gnc\./.test(event)) {
      const { gncLogPayload, handleGncEvent } = await import("@/lib/partner-ghl");
      const r = await handleGncEvent(integ.workspaceId, event, body);
      const said = r ? r.note : "Not a Partner Program event";
      await logSync({ workspaceId: integ.workspaceId, userId: null, provider, direction: "in", event, payload: gncLogPayload(body), status: r?.ok ? "received" : "skipped", note: said });
      await db.update(schema.integrations).set({ lastSyncAt: nowIso() }).where(eq(schema.integrations.id, integ.id));
      return NextResponse.json(r?.ok ? { ok: true, note: said, restaurantId: r.restaurantId } : { ok: false, note: said }, { status: r && !r.ok ? 400 : 200 });
    }
    // The Magic funnel (rev 837's answer): GoHighLevel's "Form submitted → Webhook" workflow sends the form's mf_code. That is
    // the person registering; nothing else of the form is kept, and the log holds only the code's start.
    const mfCode = s(body.mf_code ?? body.mf ?? (body.customData as Body | undefined)?.mf_code ?? (body.contact as Body | undefined)?.mf_code);
    if (/^[A-Za-z0-9_-]{43}$/.test(mfCode)) {
      const { webhookRegistered } = await import("@/lib/mf/data");
      const said = await webhookRegistered(integ.workspaceId, mfCode);
      await logSync({ workspaceId: integ.workspaceId, userId: null, provider, direction: "in", event: "mf:registered", payload: { mf: `${mfCode.slice(0, 6)}…` }, status: "received", note: said });
      return NextResponse.json({ ok: true, note: said });
    }
    if (ctx && /contact|opportunity|appointment/i.test(event)) {
      const appt = (body.appointment as Body | undefined) ?? {};
      const name = s(body.full_name ?? body.name ?? `${s(body.first_name ?? body.firstName)} ${s(body.last_name ?? body.lastName)}`).trim();
      const callAt = s(body.startTime ?? body.appointmentTime ?? appt.startTime);
      if (name) {
        const existing = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.workspaceId, ctx.workspaceId), eq(schema.contacts.userId, ctx.userId), eq(schema.contacts.name, name)) });
        const isAppt = /appointment/i.test(event);
        const stage = isAppt ? ("call_booked" as const) : ("new" as const);
        // "Booked on" (rev 639's answer): when the call was booked, which the scoreboard counts by week. GoHighLevel's own dateAdded
        // when it sends one, else now. Moving a call that's still ahead keeps the date it was first booked; a booking after the last
        // call has passed is a new one.
        const bookedNow = s(body.dateAdded ?? appt.dateAdded) || nowIso();
        const bookedAt = (c: { callBookedAt: string | null; callAt: string | null } | undefined) => (!isAppt ? (c?.callBookedAt ?? null) : !c?.callBookedAt || (c.callAt && c.callAt < nowIso()) ? bookedNow : c.callBookedAt);
        if (existing) await db.update(schema.contacts).set({ stage: existing.stage === "client" ? "client" : stage, callAt: callAt || existing.callAt, callBookedAt: bookedAt(existing) }).where(eq(schema.contacts.id, existing.id));
        else await db.insert(schema.contacts).values({ id: newId(), workspaceId: ctx.workspaceId, userId: ctx.userId, name, platform: "Other", stage, source: "GoHighLevel", callAt: callAt || null, callBookedAt: bookedAt(undefined) });
        note = existing ? `Updated contact ${name}` : `Created contact ${name}`;
      }
      if (/appointment/i.test(event)) {
        const booked = await bookClaim(ctx, s(body.calendarId ?? appt.calendarId ?? (body.calendar as Body | undefined)?.id), callAt, s(body.id ?? appt.id ?? body.appointmentId));
        note = `${note}; ${booked}`;
      }
    }
  }
  await logSync({ workspaceId: integ.workspaceId, userId: member?.userId ?? null, provider, direction: "in", event, payload: body, status: "received", note });
  await db.update(schema.integrations).set({ lastSyncAt: nowIso() }).where(eq(schema.integrations.id, integ.id));
  return NextResponse.json({ ok: true, note });
}
