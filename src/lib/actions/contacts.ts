"use server";

import { deletedTo } from "@/lib/deleted";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { CONTACT_STAGES } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { createContact, logMessage, updateContact } from "@/lib/contacts-core";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";

export async function createContactAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  const name = str(formData, "name");
  if (!name) return;
  // The one way a conversation starts (src/lib/contacts-core.ts), the same the connector's dm_log uses.
  const id = await createContact(
    { workspaceId, userId, today: v.today },
    { name, platform: str(formData, "platform"), profileUrl: opt(formData, "profileUrl"), email: opt(formData, "email"), phone: opt(formData, "phone"), warmth: str(formData, "warmth"), source: opt(formData, "source"), whatTheyreBuilding: opt(formData, "whatTheyreBuilding"), notes: opt(formData, "notes"), firstMessage: opt(formData, "firstMessage"), templateId: opt(formData, "templateId") },
  );
  refresh();
  if (str(formData, "open") === "1") redirect(`/conversations/${id}`);
}

export async function logMessageAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ whileSwitched: "refuse", reason: "Nothing is sent or published as {first} from their HelixOS. They can do it themselves.", team: "allow" });
  const contactId = str(formData, "contactId");
  const body = str(formData, "body");
  const contact = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, contactId), eq(schema.contacts.userId, userId)) });
  if (!contact || !body) return;
  await logMessage({ workspaceId, userId, today: v.today }, contact, { direction: str(formData, "direction") === "in" ? "in" : "out", body, templateId: opt(formData, "templateId"), nextFollowUpAt: opt(formData, "nextFollowUpAt") });
  refresh();
}

export async function updateContactAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const contact = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId)) });
  if (!contact) return;
  const keep = (k: string) => (formData.has(k) ? opt(formData, k) : undefined);
  const out = await updateContact(
    { workspaceId, userId, today: v.today },
    contact,
    { stage: CONTACT_STAGES.find((s) => s === str(formData, "stage")), email: keep("email"), phone: keep("phone"), warmth: str(formData, "warmth") || null, nextFollowUpAt: opt(formData, "nextFollowUpAt") ?? undefined, callAt: opt(formData, "callAt"), notes: keep("notes"), whatTheyreBuilding: keep("whatTheyreBuilding"), profileUrl: keep("profileUrl") },
  );
  // A stage that pushes needs an identity to push on. The refusal is said on the page, with which one is missing; nothing is saved.
  if (!out.ok) redirect(`/conversations/${id}?identityError=${out.needsIdentity}`);
  refresh();
}

export async function snoozeContactAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx({ team: "allow" });
  const id = str(formData, "id");
  const days = Number(str(formData, "days") || "1");
  await db
    .update(schema.contacts)
    .set({ nextFollowUpAt: addDays(v.today, Number.isFinite(days) ? days : 1) })
    .where(and(eq(schema.contacts.id, id), eq(schema.contacts.userId, userId)));
  refresh();
}

export async function deleteContactAction(formData: FormData): Promise<void> {
  const { userId } = await ctx({ team: "allow" });
  await db.delete(schema.contacts).where(and(eq(schema.contacts.id, str(formData, "id")), eq(schema.contacts.userId, userId)));
  refresh();
  redirect(deletedTo("/conversations", "contact"));
}
