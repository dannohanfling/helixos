/**
 * The seat form's server side. The person registers for the webinar their page is for; HelixOS marks them registered on the
 * Magic funnel's own row (the engine's markRegistered, as the GoHighLevel webhook does, counted as "helixos"), then sends them
 * to GoHighLevel by API. A cleared form ("Not you?") whose email isn't the code's person is a new sign-up: the bot's prospect is
 * never marked registered for someone else. A cold sign-up is a registered webinar_signups row and a DMs lead, as the chat's
 * webinar_register makes them. GoHighLevel failing never stops the person reaching their confirmation.
 */
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { PAGE_CODE_BYTES } from "@/lib/engine/bot-mcp";
import { cleanFirstName, cleanPhone } from "@/lib/engine/magic-funnel";
import { markRegistered } from "@/lib/mf/data";
import { countRegistered, personInDms } from "@/lib/bot-mcp/data";
import { callContext, type CallContext } from "@/lib/hermes/data";
import { registerInGhl } from "@/lib/hermes/ghl";
import { cleanEmail, isPageCode, isWebinarId } from "@/lib/hermes/rules";
import { hermesPages } from "@/db/schema-hermes";

export type RegisterInput = { code: string | null; webinarId: string | null; firstName: unknown; email: unknown; phone: unknown };
export type RegisterResult =
  | { ok: true; code: string; outcome: "registered" | "already registered"; fresh: boolean; ctx: CallContext; ghl: (() => Promise<void>) | null }
  | { ok: false; outcome: "check the form" | "closed"; back: string | null };

const upcoming = (ctx: CallContext | null, now: Date) => (ctx && new Date(ctx.when.startsAt).getTime() > now.getTime() ? ctx : null);

/** One sign-up, new or found by email, registered now. Returns its code and whether this request registered it. */
async function signUp(ctx: CallContext, p: { firstName: string; lastName: string | null; email: string; phone: string | null; clContactId: string | null }): Promise<{ code: string; fresh: boolean }> {
  const had = await db.query.webinarSignups.findFirst({ where: and(eq(schema.webinarSignups.webinarId, ctx.webinarId), eq(schema.webinarSignups.email, p.email)), columns: { id: true, pageCode: true, registeredAt: true } });
  if (had) return { code: had.pageCode, fresh: had.registeredAt ? false : await markRegistered(had.id, "helixos") };
  const bot = { keyId: "hermes", workspaceId: ctx.member.workspaceId, userId: ctx.member.userId, tz: ctx.tz, membership: ctx.membership };
  const contactId = await personInDms(bot, { firstName: p.firstName, email: p.email, contactId: p.clContactId, note: `Signed up for "${ctx.title}" on its HelixOS page.` });
  const pageCode = randomBytes(PAGE_CODE_BYTES).toString("base64url");
  try {
    await db.insert(schema.webinarSignups).values({ id: newId(), workspaceId: ctx.member.workspaceId, userId: ctx.member.userId, webinarId: ctx.webinarId, firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone, contactId, custom: {}, pageCode, source: "mf", pitchStatus: "none", registeredAt: nowIso(), registeredVia: "helixos" });
  } catch {
    // The same email at the same moment: the other request's row stands.
    const again = await db.query.webinarSignups.findFirst({ where: and(eq(schema.webinarSignups.webinarId, ctx.webinarId), eq(schema.webinarSignups.email, p.email)), columns: { pageCode: true } });
    if (again) return { code: again.pageCode, fresh: false };
    throw new Error("sign-up not saved");
  }
  await countRegistered(ctx.webinarId);
  return { code: pageCode, fresh: true };
}

async function countGhlFailure(webinarId: string): Promise<void> {
  try {
    await db.update(hermesPages).set({ ghlFailed: sql`${hermesPages.ghlFailed} + 1` }).where(eq(hermesPages.webinarId, webinarId));
  } catch {
    // No table yet (before the merge): the sync log still has the row.
  }
}

export async function register(input: RegisterInput, now = new Date()): Promise<RegisterResult> {
  const firstName = cleanFirstName(input.firstName);
  const email = cleanEmail(input.email);
  const phone = cleanPhone(input.phone) || null;
  const code = input.code && isPageCode(input.code) ? input.code : null;
  const webinarId = !code && input.webinarId && isWebinarId(input.webinarId) ? input.webinarId : null;
  const back = code ? `/mf/${code}` : webinarId ? `/mf/w/${webinarId}` : null;
  if (!firstName || !email) return { ok: false, outcome: "check the form", back };

  let ctx: CallContext | null = null;
  let mine: { id: string; email: string; lastName: string | null; clContactId: string | null; registeredAt: string | null; pageCode: string } | null = null;
  if (code) {
    const s = await db.query.webinarSignups.findFirst({ where: eq(schema.webinarSignups.pageCode, code), columns: { id: true, workspaceId: true, userId: true, webinarId: true, email: true, lastName: true, clContactId: true, registeredAt: true, pageCode: true } });
    if (s) {
      ctx = upcoming(await callContext({ workspaceId: s.workspaceId, userId: s.userId }, s.webinarId), now);
      mine = s;
    }
  } else if (webinarId) {
    const w = await db.query.webinars.findFirst({ where: eq(schema.webinars.id, webinarId), columns: { id: true, workspaceId: true, userId: true } });
    if (w) ctx = upcoming(await callContext({ workspaceId: w.workspaceId, userId: w.userId }, w.id), now);
  }
  if (!ctx) return { ok: false, outcome: "closed", back };

  let result: { code: string; fresh: boolean };
  if (mine && mine.email === email) {
    result = { code: mine.pageCode, fresh: mine.registeredAt ? false : await markRegistered(mine.id, "helixos") };
    if (phone) await db.update(schema.webinarSignups).set({ phone }).where(eq(schema.webinarSignups.id, mine.id));
  } else {
    result = await signUp(ctx, { firstName, lastName: null, email, phone, clContactId: null });
  }
  console.log("[hermes] register", JSON.stringify({ code: `${result.code.slice(0, 6)}…`, outcome: result.fresh ? "registered" : "already registered", from: mine ? (mine.email === email ? "their code" : "cleared form") : "cold" }));

  const lastName = mine && mine.email === email ? mine.lastName : null;
  const c = ctx;
  // GoHighLevel runs after the redirect (the route hands this to after()), so a slow or failing GoHighLevel never holds the page.
  const ghl = result.fresh
    ? async () => {
        const r = await registerInGhl(c.member, { firstName, lastName, email, phone }, c.when);
        console.log("[hermes] ghl", JSON.stringify({ code: `${result.code.slice(0, 6)}…`, outcome: r.step, dateField: r.dateField }));
        if (!r.ok) await countGhlFailure(c.webinarId);
      }
    : null;
  return { ok: true, code: result.code, outcome: result.fresh ? "registered" : "already registered", fresh: result.fresh, ctx, ghl };
}
