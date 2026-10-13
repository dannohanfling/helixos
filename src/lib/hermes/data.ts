/**
 * What a Hermes page shows, read from the Magic funnel's own rows: the prospect's webinar_signups row (found by its code), the
 * webinar entry, its Magic funnel setup and the member's Proof Bank. The copy is the engine's: the prospect's pitch, or the
 * webinar's default copy through the engine's defaultPitch. Nothing here writes copy or calls an AI. It never throws to a page:
 * anything missing ends in the cold version, or a quiet "no call open" page. Logs carry codes and outcomes only.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { defaultPitch, rankProof, stateFor, type MfPitch } from "@/lib/engine/magic-funnel";
import { factsFor, mfAvailable, setupFor } from "@/lib/mf/data";
import { COLD_HERO } from "@/lib/hermes/copy";
import { callWhen, CALL_MINUTES, type CallWhen } from "@/lib/hermes/when";
import { hermesFor, hostedWebinarIds, pagesOpen, previewDeploy } from "@/lib/hermes/settings";
import { cleanPixelId, hasNumbers, isPageCode, quoteOnce, youtubeEmbed } from "@/lib/hermes/rules";
import type { HermesPage } from "@/db/schema-hermes";

export type Member = { workspaceId: string; userId: string };
export type Proof = { id: string; who: string; quote: string };
export type Prefill = { firstName: string; email: string; phone: string };

/** Everything about one webinar a page needs, once it is known to be open. */
export type CallContext = {
  member: Member;
  membership: schema.Membership;
  webinarId: string;
  title: string;
  tz: string;
  when: CallWhen;
  minutes: number;
  joinUrl: string | null;
  setup: schema.MfSetup;
  hermes: HermesPage | null;
  videoEmbed: string | null;
  pixelId: string | null;
};

export type PageView =
  | { kind: "personal"; code: string; ctx: CallContext; pitch: MfPitch; firstName: string; prefill: Prefill; proofs: Proof[]; ready: boolean }
  | { kind: "registered"; code: string }
  | { kind: "cold"; ctx: CallContext; pitch: MfPitch; proofs: Proof[] }
  | { kind: "closed" };

const mine = <T extends { workspaceId: unknown; userId: unknown }>(t: T, m: Member) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));

async function memberTz(m: Member): Promise<{ tz: string; membership: schema.Membership } | null> {
  const [membership, ws] = await Promise.all([
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.memberships.userId, m.userId)) }),
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, m.workspaceId), columns: { timezone: true } }),
  ]);
  if (!membership || membership.removedAt || !mfAvailable(membership)) return null;
  return { tz: membership.timezone ?? ws?.timezone ?? "UTC", membership };
}

/**
 * One webinar's context, or null when its page isn't open: the member has the Magic funnel, the webinar has a date, its Magic
 * funnel setup is live, and (on production) its "Host pages in HelixOS" switch is on.
 */
export async function callContext(m: Member, webinarId: string): Promise<CallContext | null> {
  return context(m, webinarId, true);
}

/** The same context for the coach's own preview: the page as it would look, live or not, switch on or off. */
export async function previewContext(m: Member, webinarId: string): Promise<CallContext | null> {
  return context(m, webinarId, false);
}

async function context(m: Member, webinarId: string, mustBeOpen: boolean): Promise<CallContext | null> {
  const who = await memberTz(m);
  if (!who) return null;
  const [w, setup, hermes] = await Promise.all([
    db.query.webinars.findFirst({ where: and(mine(schema.webinars, m), eq(schema.webinars.id, webinarId)) }),
    setupFor(m, webinarId),
    hermesFor(webinarId),
  ]);
  if (!w || !setup) return null;
  if (mustBeOpen && (!setup.live || !pagesOpen(hermes, m))) return null;
  const facts = factsFor(w, who.tz);
  if (!facts.startsAt) return null;
  return {
    member: m,
    membership: who.membership,
    webinarId,
    title: w.title,
    tz: who.tz,
    when: callWhen(facts.startsAt, who.tz, CALL_MINUTES),
    minutes: CALL_MINUTES,
    joinUrl: w.joinUrl?.trim() && /^https:\/\//.test(w.joinUrl.trim()) ? w.joinUrl.trim() : null,
    setup,
    hermes,
    videoEmbed: youtubeEmbed(hermes?.videoUrl),
    pixelId: hermes?.pixelOn ? cleanPixelId(hermes.pixelId) : null,
  };
}

const upcomingCtx = (ctx: CallContext | null, now: Date) => (ctx && new Date(ctx.when.startsAt).getTime() > now.getTime() ? ctx : null);

/** The member's proof, word for word, approved and with the permission tick only (the engine's own rule). */
async function proofRows(m: Member) {
  const rows = await db.query.proofs.findMany({ where: and(mine(schema.proofs, m), eq(schema.proofs.status, "approved")), columns: { id: true, who: true, name: true, quote: true, shortVersion: true, resultAfter: true, tags: true, status: true, permissionAt: true } });
  return rows.map((r) => ({ id: r.id, who: r.who?.trim() || r.name, quote: (r.quote ?? r.shortVersion ?? r.resultAfter ?? "").trim(), tags: r.tags ?? [], status: r.status, permissionAt: r.permissionAt })).filter((r) => r.quote && r.permissionAt);
}

/**
 * What a public page may show of a proof item (H-21 A): its quote with the name once, under it; and, until Danno has picked the
 * webinar's proof (its Magic funnel setup's list), nothing that states a number.
 */
const shown = (picked: boolean) => (r: { id: string; who: string; quote: string }): Proof | null => {
  const quote = quoteOnce(r.quote, r.who);
  return !picked && hasNumbers(quote) ? null : { id: r.id, who: r.who, quote };
};

async function proofsById(m: Member, ids: string[], picked: boolean): Promise<Proof[]> {
  if (!ids.length) return [];
  const rows = await proofRows(m);
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r)).map(shown(picked)).filter((p): p is Proof => Boolean(p)).slice(0, 3);
}

/** The webinar's default copy through the engine, with the canvas's cold hero where the setup leaves the hero empty. */
async function coldPitch(ctx: CallContext, firstName: string): Promise<{ pitch: MfPitch; proofs: Proof[] }> {
  const ranked = rankProof(await proofRows(ctx.member), ctx.setup.proofIds, null);
  const facts = { title: ctx.title, startsAt: ctx.when.startsAt, when: ctx.when.line, promise: "", learn: [], whoFor: "" };
  const pitch = defaultPitch({ defaults: ctx.setup.defaults, pillars: ctx.setup.pillars, agenda: ctx.setup.agenda, proofIds: ranked.map((p) => p.id), firstName, facts });
  if (!ctx.setup.defaults.header?.trim()) pitch.hero = { ...pitch.hero, header: COLD_HERO.header };
  if (!ctx.setup.defaults.subheader?.trim()) pitch.hero = { ...pitch.hero, subheader: COLD_HERO.subheader(ctx.when) };
  return { pitch, proofs: ranked.map(shown(ctx.setup.proofIds.length > 0)).filter((p): p is Proof => Boolean(p)).slice(0, 3) };
}

/** The cold page for the soonest open, upcoming webinar of this member (or of anyone, for an unknown code); else "closed". */
async function fallbackCold(m: Member | null, now: Date): Promise<PageView> {
  let candidates: { member: Member; webinarId: string }[] = [];
  if (m) {
    const ids = previewDeploy() ? (await db.query.mfSetups.findMany({ where: and(mine(schema.mfSetups, m), eq(schema.mfSetups.live, true)), columns: { webinarId: true } })).map((r) => r.webinarId) : await hostedWebinarIds(m);
    candidates = ids.map((webinarId) => ({ member: m, webinarId }));
  } else if (!previewDeploy()) {
    const ids = await hostedWebinarIds(null);
    if (ids.length) {
      const rows = await db.query.webinars.findMany({ where: inArray(schema.webinars.id, ids), columns: { id: true, workspaceId: true, userId: true } });
      candidates = rows.map((r) => ({ member: { workspaceId: r.workspaceId, userId: r.userId }, webinarId: r.id }));
    }
  }
  const open = (await Promise.all(candidates.map((c) => callContext(c.member, c.webinarId)))).map((c) => upcomingCtx(c, now)).filter((c): c is CallContext => Boolean(c));
  // An unknown code with more than one member's call open: no way to tell whose it was, so no one's page.
  if (!m && new Set(open.map((c) => `${c.member.workspaceId}:${c.member.userId}`)).size > 1) return { kind: "closed" };
  const next = open.sort((a, b) => a.when.startsAt.localeCompare(b.when.startsAt))[0];
  if (!next) return { kind: "closed" };
  return { kind: "cold", ctx: next, ...(await coldPitch(next, "")) };
}

/** The cold page, by webinar id (the address for ads). A past or closed webinar falls to the member's next open one. */
export async function coldView(webinarId: string, now = new Date()): Promise<PageView> {
  const w = await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId), columns: { id: true, workspaceId: true, userId: true } });
  if (!w) return { kind: "closed" };
  const m = { workspaceId: w.workspaceId, userId: w.userId };
  const ctx = upcomingCtx(await callContext(m, w.id), now);
  if (!ctx) return fallbackCold(m, now);
  return { kind: "cold", ctx, ...(await coldPitch(ctx, "")) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long a page opened before the engine finished writing waits for it, and how often it looks. */
export const WAIT_MS = 5000;
const POLL_MS = 500;

/**
 * A personal page by its code. Still being written: wait up to five seconds, then Danno's default copy (the personal version
 * shows on the next open). Registered: their confirmation. Unknown, closed or past: the cold version. Marks the first open.
 */
export async function personalView(code: string, o: { now?: Date; waitMs?: number } = {}): Promise<PageView> {
  const now = o.now ?? new Date();
  if (!isPageCode(code)) return fallbackCold(null, now);
  let s = await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.pageCode, code) });
  if (!s) return fallbackCold(null, now);
  const m = { workspaceId: s.workspaceId, userId: s.userId };
  const ctx = await callContext(m, s.webinarId);
  if (!ctx) return fallbackCold(m, now);
  const state = stateFor({ registeredAt: s.registeredAt, startsAt: ctx.when.startsAt }, now);
  if (state === "registered") return { kind: "registered", code };
  if (state === "generic") return fallbackCold(m, now);

  const deadline = Date.now() + (o.waitMs ?? WAIT_MS);
  while (!s.pitch && s.pitchStatus === "writing" && Date.now() < deadline) {
    await sleep(POLL_MS);
    s = (await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.id, s.id) })) ?? s;
  }
  if (!s.openedAt) await db.update(schema.webinarSignups).set({ openedAt: nowIso() }).where(eq(schema.webinarSignups.id, s.id));
  const prefill = { firstName: s.firstName, email: s.email, phone: s.phone ?? "" };
  if (!s.pitch) {
    console.log("[hermes] page", JSON.stringify({ code: `${code.slice(0, 6)}…`, outcome: "default copy", pitch: s.pitchStatus }));
    return { kind: "personal", code, ctx, firstName: s.firstName, prefill, ready: false, ...(await coldPitch(ctx, s.firstName)) };
  }
  return { kind: "personal", code, ctx, pitch: s.pitch, firstName: s.firstName, prefill, ready: true, proofs: await proofsById(m, s.pitch.proof_ids, ctx.setup.proofIds.length > 0) };
}

/** The confirmation page by code: the signed-up person's first name and their ticket and lines. Only once registered. */
export async function confirmedView(code: string): Promise<{ ctx: CallContext; firstName: string; pitch: MfPitch | null } | null> {
  if (!isPageCode(code)) return null;
  const s = await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.pageCode, code), columns: { workspaceId: true, userId: true, webinarId: true, firstName: true, pitch: true, registeredAt: true } });
  if (!s?.registeredAt) return null;
  const ctx = await callContext({ workspaceId: s.workspaceId, userId: s.userId }, s.webinarId);
  return ctx ? { ctx, firstName: s.firstName, pitch: s.pitch ?? null } : null;
}
