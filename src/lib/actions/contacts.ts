"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { CONTACT_STAGES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { addDays, nowIso } from "@/lib/dates";
import { POINTS } from "@/lib/engine/points";
import { award } from "@/lib/queries/points";
import { background, pushContact } from "@/lib/integrations";
import { clean, identityOf, pushesAt } from "@/lib/engine/contact-sync";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";

export async function createContactAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const name = str(formData, "name");
  if (!name) return;
  const id = newId();
  const firstMessage = opt(formData, "firstMessage");
  await db.insert(schema.contacts).values({
    id,
    workspaceId,
    userId,
    name,
    platform: str(formData, "platform") || "Facebook",
    profileUrl: opt(formData, "profileUrl"),
    email: clean(opt(formData, "email")),
    phone: clean(opt(formData, "phone")),
    warmth: (["cold", "warm", "hot"] as const).find((w) => w === str(formData, "warmth")) ?? "warm",
    source: opt(formData, "source"),
    whatTheyreBuilding: opt(formData, "whatTheyreBuilding"),
    notes: opt(formData, "notes"),
    stage: "new",
    lastOutboundAt: firstMessage ? nowIso() : null,
    nextFollowUpAt: addDays(v.today, firstMessage ? 3 : 1),
  });
  if (firstMessage) {
    await db.insert(schema.messages).values({ id: newId(), contactId: id, userId, direction: "out", body: firstMessage, templateId: opt(formData, "templateId") });
    await award({ workspaceId, userId }, "dm", POINTS.dmStarted, `Started a conversation with ${name}`, `contact:${id}`);
  }
  refresh();
  if (str(formData, "open") === "1") redirect(`/conversations/${id}`);
}

export async function logMessageAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const contactId = str(formData, "contactId");
  const body = str(formData, "body");
  const direction = str(formData, "direction") === "in" ? "in" : "out";
  const contact = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, contactId), eq(schema.contacts.userId, userId)) });
  if (!contact || !body) return;
  const now = nowIso();
  await db.insert(schema.messages).values({ id: newId(), contactId, userId, direction, body, templateId: opt(formData, "templateId"), sentAt: now });

  const isFirstOutbound = direction === "out" && !contact.lastOutboundAt;
  const patch: Partial<typeof schema.contacts.$inferInsert> = {};
  if (direction === "out") {
    patch.lastOutboundAt = now;
    patch.nextFollowUpAt = opt(formData, "nextFollowUpAt") ?? addDays(v.today, 3);
    if (isFirstOutbound) await award({ workspaceId, userId }, "dm", POINTS.dmStarted, `Started a conversation with ${contact.name}`, `contact:${contactId}`);
  } else {
    patch.lastInboundAt = now;
    patch.nextFollowUpAt = v.today;
    if (contact.stage === "new") patch.stage = "replied";
    else if (contact.stage === "replied") patch.stage = "conversation";
    await award({ workspaceId, userId }, "dm", POINTS.reply, `${contact.name} replied`, `reply:${contactId}:${now}`);
  }
  await db.update(schema.contacts).set(patch).where(eq(schema.contacts.id, contactId));
  refresh();
}

export async function updateContactAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const id = str(formData, "id");
  const contact = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId)) });
  if (!contact) return;
  const stage = CONTACT_STAGES.find((s) => s === str(formData, "stage")) ?? contact.stage;
  const callAt = opt(formData, "callAt");
  const email = formData.has("email") ? clean(opt(formData, "email")) : contact.email;
  const phone = formData.has("phone") ? clean(opt(formData, "phone")) : contact.phone;
  // A stage that pushes needs an identity to push on. The refusal is said on the page, with which one is missing; nothing is saved.
  if (pushesAt(stage) && stage !== contact.stage && !contact.ghlContactId && !identityOf({ email, phone, userNs: contact.userNs })) redirect(`/conversations/${id}?needsIdentity=${stage}`);
  await db
    .update(schema.contacts)
    .set({
      stage,
      email,
      phone,
      warmth: (["cold", "warm", "hot"] as const).find((w) => w === str(formData, "warmth")) ?? contact.warmth,
      nextFollowUpAt: stage === "cold" || stage === "client" ? null : (opt(formData, "nextFollowUpAt") ?? contact.nextFollowUpAt),
      callAt: callAt ?? contact.callAt,
      notes: formData.has("notes") ? opt(formData, "notes") : contact.notes,
      whatTheyreBuilding: formData.has("whatTheyreBuilding") ? opt(formData, "whatTheyreBuilding") : contact.whatTheyreBuilding,
      profileUrl: formData.has("profileUrl") ? opt(formData, "profileUrl") : contact.profileUrl,
    })
    .where(eq(schema.contacts.id, id));
  if (stage === "call_booked" && contact.stage !== "call_booked") {
    await award({ workspaceId, userId }, "call", POINTS.callBooked, `Call booked with ${contact.name}`, `call:${id}`);
    background(pushContact({ workspaceId, userId }, { kind: "contact", rowId: id, ghlContactId: contact.ghlContactId, name: contact.name, email, phone, userNs: contact.userNs, stage: "call_booked", source: contact.source }));
  }
  if (stage === "client" && contact.stage !== "client") {
    await award({ workspaceId, userId }, "call", POINTS.newClient, `New client: ${contact.name}`, `client:${id}`);
    background(pushContact({ workspaceId, userId }, { kind: "contact", rowId: id, ghlContactId: contact.ghlContactId, name: contact.name, email, phone, userNs: contact.userNs, stage: "client", source: contact.source }));
  }
  void v;
  refresh();
}

export async function snoozeContactAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const id = str(formData, "id");
  const days = Number(str(formData, "days") || "1");
  await db
    .update(schema.contacts)
    .set({ nextFollowUpAt: addDays(v.today, Number.isFinite(days) ? days : 1) })
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId)));
  refresh();
}

export async function deleteContactAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.contacts).where(and(eq(schema.contacts.id, str(formData, "id")), eq(schema.contacts.userId, userId)));
  refresh();
  redirect("/conversations");
}
