/**
 * The DMs page's writes, shared (Voice pack 2, rev 642): the page's actions and the HelixOS connector's dm_log call these same
 * functions, so a conversation logged by voice moves the stage, sets the follow-up, scores and counts toward the day exactly
 * as one logged on the page. Nothing here reads a form or redirects.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CONTACT_STAGES } from "@/db/schema";
import { addDays, nowIso } from "@/lib/dates";
import { clean, identityOf, pushesAt } from "@/lib/engine/contact-sync";
import { POINTS } from "@/lib/engine/points";
import { newId } from "@/lib/ids";
import { background, pushContact } from "@/lib/integrations";
import { award } from "@/lib/queries/points";

type ContactStage = (typeof CONTACT_STAGES)[number];
export type ContactMember = { workspaceId: string; userId: string; today: string };
type Warmth = "cold" | "warm" | "hot";

export type NewContact = { name: string; platform?: string | null; profileUrl?: string | null; email?: string | null; phone?: string | null; warmth?: string | null; source?: string | null; whatTheyreBuilding?: string | null; notes?: string | null; firstMessage?: string | null; templateId?: string | null };

/** A new conversation: Reached out, a follow-up tomorrow (in three days once a first message is sent), the first message scored. */
export async function createContact(m: ContactMember, c: NewContact): Promise<string> {
  const id = newId();
  const firstMessage = c.firstMessage?.trim() || null;
  await db.insert(schema.contacts).values({
    id,
    workspaceId: m.workspaceId,
    userId: m.userId,
    name: c.name,
    platform: c.platform || "Facebook",
    profileUrl: c.profileUrl ?? null,
    email: clean(c.email ?? null),
    phone: clean(c.phone ?? null),
    warmth: (["cold", "warm", "hot"] as const).find((w) => w === c.warmth) ?? "warm",
    source: c.source ?? null,
    whatTheyreBuilding: c.whatTheyreBuilding ?? null,
    notes: c.notes ?? null,
    stage: "new",
    lastOutboundAt: firstMessage ? nowIso() : null,
    nextFollowUpAt: addDays(m.today, firstMessage ? 3 : 1),
  });
  if (firstMessage) {
    await db.insert(schema.messages).values({ id: newId(), contactId: id, userId: m.userId, direction: "out", body: firstMessage, templateId: c.templateId ?? null });
    await award({ workspaceId: m.workspaceId, userId: m.userId }, "dm", POINTS.dmStarted, `Started a conversation with ${c.name}`, `contact:${id}`);
  }
  return id;
}

/**
 * One message logged on a conversation. Out: the last outbound time (so the day counts this person once) and a follow-up in
 * three days unless one is given; the first ever scores a DM started. In: the last inbound time, a follow-up today, the stage
 * moved on from Reached out or Replied, and a reply scored.
 */
export async function logMessage(m: ContactMember, contact: schema.Contact, msg: { direction: "in" | "out"; body: string; templateId?: string | null; nextFollowUpAt?: string | null }): Promise<void> {
  const now = nowIso();
  await db.insert(schema.messages).values({ id: newId(), contactId: contact.id, userId: m.userId, direction: msg.direction, body: msg.body, templateId: msg.templateId ?? null, sentAt: now });
  const patch: Partial<typeof schema.contacts.$inferInsert> = {};
  if (msg.direction === "out") {
    patch.lastOutboundAt = now;
    patch.nextFollowUpAt = msg.nextFollowUpAt ?? addDays(m.today, 3);
    if (!contact.lastOutboundAt) await award({ workspaceId: m.workspaceId, userId: m.userId }, "dm", POINTS.dmStarted, `Started a conversation with ${contact.name}`, `contact:${contact.id}`);
  } else {
    patch.lastInboundAt = now;
    patch.nextFollowUpAt = m.today;
    if (contact.stage === "new") patch.stage = "replied";
    else if (contact.stage === "replied") patch.stage = "conversation";
    await award({ workspaceId: m.workspaceId, userId: m.userId }, "dm", POINTS.reply, `${contact.name} replied`, `reply:${contact.id}:${now}`);
  }
  await db.update(schema.contacts).set(patch).where(eq(schema.contacts.id, contact.id));
}

/** A field left undefined keeps what the contact has; null clears it. */
export type ContactChange = { stage?: ContactStage; email?: string | null; phone?: string | null; warmth?: string | null; nextFollowUpAt?: string | null; callAt?: string | null; notes?: string | null; whatTheyreBuilding?: string | null; profileUrl?: string | null };

/**
 * The contact's stage and details. A stage that reaches GoHighLevel (Call booked, Client) needs an email or a phone first:
 * refused with the stage named, nothing saved. Cold and Client clear the follow-up; a call booked and a new client score and
 * are pushed, as on the page.
 */
export async function updateContact(m: ContactMember, contact: schema.Contact, ch: ContactChange): Promise<{ ok: true } | { ok: false; needsIdentity: ContactStage }> {
  const stage = ch.stage ?? contact.stage;
  const email = ch.email === undefined ? contact.email : clean(ch.email);
  const phone = ch.phone === undefined ? contact.phone : clean(ch.phone);
  if (pushesAt(stage) && stage !== contact.stage && !contact.ghlContactId && !identityOf({ email, phone, userNs: contact.userNs })) return { ok: false, needsIdentity: stage };
  await db
    .update(schema.contacts)
    .set({
      stage,
      email,
      phone,
      warmth: (["cold", "warm", "hot"] as const).find((w) => w === ch.warmth) ?? (contact.warmth as Warmth),
      nextFollowUpAt: stage === "cold" || stage === "client" ? null : ch.nextFollowUpAt === undefined ? contact.nextFollowUpAt : ch.nextFollowUpAt,
      callAt: ch.callAt ?? contact.callAt,
      notes: ch.notes === undefined ? contact.notes : ch.notes,
      whatTheyreBuilding: ch.whatTheyreBuilding === undefined ? contact.whatTheyreBuilding : ch.whatTheyreBuilding,
      profileUrl: ch.profileUrl === undefined ? contact.profileUrl : ch.profileUrl,
    })
    .where(and(eq(schema.contacts.id, contact.id), eq(schema.contacts.userId, m.userId)));
  const who = { workspaceId: m.workspaceId, userId: m.userId };
  if (stage === "call_booked" && contact.stage !== "call_booked") {
    await award(who, "call", POINTS.callBooked, `Call booked with ${contact.name}`, `call:${contact.id}`);
    background(pushContact(who, { kind: "contact", rowId: contact.id, ghlContactId: contact.ghlContactId, name: contact.name, email, phone, userNs: contact.userNs, stage: "call_booked", source: contact.source }));
  }
  if (stage === "client" && contact.stage !== "client") {
    await award(who, "call", POINTS.newClient, `New client: ${contact.name}`, `client:${contact.id}`);
    background(pushContact(who, { kind: "contact", rowId: contact.id, ghlContactId: contact.ghlContactId, name: contact.name, email, phone, userNs: contact.userNs, stage: "client", source: contact.source }));
  }
  return { ok: true };
}
