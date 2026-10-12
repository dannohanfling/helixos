/**
 * Bot connection (rev 696, rev 808), the database side: the member's bot key, and what each of the six tools reads or writes.
 * Everything is scoped to the one member the key belongs to; nothing reads another member's rows, and nothing here sends a
 * message, deletes anything, or touches the never-list (Essence, numbers, tasks, Proof Bank, the Pathway, health, Danno's
 * library).
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashSecret } from "@/lib/crypto";
import { nowIso, todayInTz, wallTimeToUtc } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { priceAnswerFor } from "@/lib/engine/bot-fields";
import { BOT_KEY_PREFIX, PAGE_CODE_BYTES, bookedOnIso, faqMatches, isBotKeyShape, nextStage, nextWebinar, offerFacts, whenLine, withNote, type BotStage } from "@/lib/engine/bot-mcp";

export type BotMember = { keyId: string; workspaceId: string; userId: string; tz: string; membership: schema.Membership };
const mine = <T extends { workspaceId: unknown; userId: unknown }>(t: T, m: { workspaceId: string; userId: string }) => and(eq(t.workspaceId as never, m.workspaceId), eq(t.userId as never, m.userId));

/* ───────────────────────── the key ───────────────────────── */

/** A new key for a member's bot: any live one is revoked first, so there is only ever one. Returned once, never stored. */
export async function makeBotKey(m: { workspaceId: string; userId: string }, createdBy: string): Promise<string> {
  const key = `${BOT_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  await db.update(schema.botKeys).set({ revokedAt: nowIso() }).where(and(mine(schema.botKeys, m), isNull(schema.botKeys.revokedAt)));
  await db.insert(schema.botKeys).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, tokenHash: hashSecret(key), last4: key.slice(-4), createdBy });
  return key;
}

export async function revokeBotKey(m: { workspaceId: string; userId: string }): Promise<void> {
  await db.update(schema.botKeys).set({ revokedAt: nowIso() }).where(and(mine(schema.botKeys, m), isNull(schema.botKeys.revokedAt)));
}

/** The member's live key as Settings shows it: its last four, when it was made and by whom, and when the bot last used it. */
export async function botKeyStatus(m: { workspaceId: string; userId: string }) {
  return (await db.query.botKeys.findFirst({ where: and(mine(schema.botKeys, m), isNull(schema.botKeys.revokedAt)), columns: { last4: true, createdAt: true, createdBy: true, lastUsedAt: true } })) ?? null;
}

/** Whose bot is calling: a live key of the right shape, of a member still in the workspace. Null for anything else. */
export async function memberForKey(key: string): Promise<BotMember | null> {
  if (!isBotKeyShape(key)) return null;
  const row = await db.query.botKeys.findFirst({ where: and(eq(schema.botKeys.tokenHash, hashSecret(key)), isNull(schema.botKeys.revokedAt)) });
  if (!row) return null;
  const membership = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, row.workspaceId), eq(schema.memberships.userId, row.userId)) });
  if (!membership || membership.removedAt) return null;
  const ws = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, row.workspaceId), columns: { timezone: true } });
  return { keyId: row.id, workspaceId: row.workspaceId, userId: row.userId, tz: membership.timezone ?? ws?.timezone ?? "UTC", membership };
}

export async function touchKey(keyId: string): Promise<void> {
  await db.update(schema.botKeys).set({ lastUsedAt: nowIso() }).where(eq(schema.botKeys.id, keyId));
}

/* ───────────────────────── the reads ───────────────────────── */

export async function offerInfo(m: BotMember) {
  const offers = await db.query.offers.findMany({ where: mine(schema.offers, m), orderBy: [asc(schema.offers.createdAt)] });
  return offerFacts(offers, { pricesOn: m.membership.botPricesOn, priceMode: m.membership.priceMode, priceAnswer: priceAnswerFor(m.membership.priceAnswer) });
}

export async function faqAnswer(m: BotMember, question: string) {
  const rows = await db.query.faqEntries.findMany({ where: mine(schema.faqEntries, m), columns: { question: true, alsoAsked: true, keywords: true, answer: true } });
  return faqMatches(question, rows.map((r) => ({ question: r.question, alsoAsked: r.alsoAsked ?? [], keywords: r.keywords ?? [], answer: r.answer })));
}

export function bookingInfo(m: BotMember) {
  return { booking_link: m.membership.bookingUrl?.trim() || null, what_to_expect: m.membership.bookingExpect?.trim() || null, call_minutes: m.membership.callMinutes ?? null };
}

async function upcoming(m: BotMember, now = new Date()) {
  const rows = await db.query.webinars.findMany({ where: mine(schema.webinars, m), columns: { id: true, title: true, status: true, isExample: true, scheduledAt: true, registrationUrl: true, joinUrl: true } });
  return nextWebinar(rows, now, (wall) => wallTimeToUtc(wall, m.tz));
}

export async function webinarNext(m: BotMember, askerTz: string | null) {
  const w = await upcoming(m);
  if (!w) return null;
  return { title: w.title, when: whenLine(w.startsAt, askerTz ?? m.tz), starts_at: w.startsAt, registration_link: w.registrationUrl?.trim() || null };
}

/* ───────────────────────── the writes ───────────────────────── */

/**
 * lead_log: add or update the one person with this contact id in the member's DMs. It never reads anyone else, and says only
 * whether it logged a new person or updated one. A note is a new dated line; booked sets the booked-on date the Weekly
 * scoreboard counts; the stage never moves back.
 */
export async function leadLog(m: BotMember, input: { contactId: string; firstName: string; channel: string | null; stage: BotStage; note: string | null; bookedOn: string | null }): Promise<"logged" | "updated"> {
  const now = new Date();
  const day = todayInTz(m.tz, now);
  const found = await db.query.contacts.findFirst({ where: and(mine(schema.contacts, m), eq(schema.contacts.userNs, input.contactId)) });
  const booked = input.stage === "booked" ? bookedOnIso(input.bookedOn ?? undefined, now) : null;
  if (!found) {
    await db.insert(schema.contacts).values({
      id: newId(),
      workspaceId: m.workspaceId,
      userId: m.userId,
      name: input.firstName,
      platform: input.channel || "Chatbot",
      stage: nextStage(null, input.stage) as schema.Contact["stage"],
      warmth: "warm",
      source: "bot",
      userNs: input.contactId,
      notes: input.note ? withNote(null, input.note, day) : null,
      lastInboundAt: now.toISOString(),
      callBookedAt: booked,
    });
    return "logged";
  }
  const stage = nextStage(found.stage, input.stage) as schema.Contact["stage"];
  await db
    .update(schema.contacts)
    .set({
      stage,
      ...(input.note ? { notes: withNote(found.notes, input.note, day) } : {}),
      ...(booked && stage === "call_booked" ? { callBookedAt: booked } : {}),
      ...(!found.name.trim() ? { name: input.firstName } : {}),
      lastInboundAt: now.toISOString(),
    })
    .where(eq(schema.contacts.id, found.id));
  return "updated";
}

/**
 * webinar_register: signs a person up for the member's next webinar, once per email; adds them to DMs as a "webinar" lead (or
 * updates the one with this contact id or email); counts them in the webinar's Registered number; and keeps a long random code
 * for their own page (the Magic funnel, coming). Returns the join link.
 */
export async function webinarRegister(m: BotMember, input: { firstName: string; email: string; contactId: string | null; custom: Record<string, string> }): Promise<{ status: "registered" | "already registered"; title: string; join_link: string | null } | null> {
  const w = await upcoming(m);
  if (!w) return null;
  const email = input.email.toLowerCase();
  const join = w.joinUrl?.trim() || w.registrationUrl?.trim() || null;
  const had = await db.query.webinarSignups.findFirst({ where: and(eq(schema.webinarSignups.webinarId, w.id), eq(schema.webinarSignups.email, email)), columns: { id: true } });
  if (had) return { status: "already registered", title: w.title, join_link: join };

  // The person in DMs: the one with this bot contact id, else this email, else new.
  const now = nowIso();
  const byNs = input.contactId ? await db.query.contacts.findFirst({ where: and(mine(schema.contacts, m), eq(schema.contacts.userNs, input.contactId)) }) : undefined;
  const person = byNs ?? (await db.query.contacts.findFirst({ where: and(mine(schema.contacts, m), eq(schema.contacts.email, email)) }));
  let contactId = person?.id ?? null;
  if (person) {
    await db
      .update(schema.contacts)
      .set({ ...(person.email ? {} : { email }), ...(person.userNs || !input.contactId ? {} : { userNs: input.contactId }), notes: withNote(person.notes, `Signed up for "${w.title}".`, todayInTz(m.tz)), lastInboundAt: now })
      .where(eq(schema.contacts.id, person.id));
  } else {
    contactId = newId();
    await db.insert(schema.contacts).values({ id: contactId, workspaceId: m.workspaceId, userId: m.userId, name: input.firstName, platform: "Chatbot", stage: "new", warmth: "warm", source: "webinar", email, userNs: input.contactId, notes: withNote(null, `Signed up for "${w.title}".`, todayInTz(m.tz)), lastInboundAt: now });
  }
  try {
    await db.insert(schema.webinarSignups).values({ id: newId(), workspaceId: m.workspaceId, userId: m.userId, webinarId: w.id, firstName: input.firstName, email, contactId, clContactId: input.contactId, custom: input.custom, pageCode: randomBytes(PAGE_CODE_BYTES).toString("base64url") });
  } catch {
    // Two sign-ups for the same email at the same moment: the second finds the first.
    return { status: "already registered", title: w.title, join_link: join };
  }
  const row = await db.query.webinars.findFirst({ where: eq(schema.webinars.id, w.id), columns: { registered: true } });
  await db.update(schema.webinars).set({ registered: (row?.registered ?? 0) + 1 }).where(eq(schema.webinars.id, w.id));
  return { status: "registered", title: w.title, join_link: join };
}
