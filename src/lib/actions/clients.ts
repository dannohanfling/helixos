"use server";

import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { CLIENT_STATUSES } from "@/db/schema";
import { newId } from "@/lib/ids";
import { addDays, nowIso } from "@/lib/dates";
import { background, pushContact } from "@/lib/integrations";
import { ctx, num, opt, refresh, str } from "./common";

async function own(id: string, userId: string) {
  const c = await db.query.clientRecords.findFirst({ where: and(eq(schema.clientRecords.id, id), eq(schema.clientRecords.userId, userId)) });
  if (!c) throw new Error("Client not found");
  return c;
}

export async function createClientRecordAction(formData: FormData): Promise<void> {
  const { v, workspaceId, userId } = await ctx();
  const name = str(formData, "name");
  if (!name) return;
  const id = newId();
  const contactId = opt(formData, "contactId");
  await db.insert(schema.clientRecords).values({
    id,
    workspaceId,
    userId,
    name,
    email: opt(formData, "email"),
    phone: opt(formData, "phone"),
    status: CLIENT_STATUSES.find((s) => s === str(formData, "status")) ?? "active",
    offerId: opt(formData, "offerId"),
    programName: opt(formData, "programName"),
    startDate: opt(formData, "startDate") ?? v.today,
    goal90: opt(formData, "goal90"),
    fear: opt(formData, "fear"),
    roadblock: opt(formData, "roadblock"),
    checkinCadenceDays: num(formData, "checkinCadenceDays") || 7,
    nextCallAt: opt(formData, "nextCallAt"),
    contactId,
    avatarEmoji: str(formData, "avatarEmoji") || "🙂",
  });
  if (contactId) await db.update(schema.contacts).set({ stage: "client" }).where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.userId, userId)));
  background(pushContact({ workspaceId, userId }, { name, email: opt(formData, "email"), phone: opt(formData, "phone"), stage: "client", source: "HelixOS client" }));
  refresh();
  redirect(`/clients/${id}`);
}

export async function updateClientRecordAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  const c = await own(id, userId);
  await db
    .update(schema.clientRecords)
    .set({
      name: str(formData, "name") || c.name,
      email: opt(formData, "email"),
      phone: opt(formData, "phone"),
      avatarEmoji: str(formData, "avatarEmoji") || c.avatarEmoji,
      status: CLIENT_STATUSES.find((s) => s === str(formData, "status")) ?? c.status,
      offerId: opt(formData, "offerId"),
      programName: opt(formData, "programName"),
      startDate: opt(formData, "startDate"),
      endDate: opt(formData, "endDate"),
      goal90: opt(formData, "goal90"),
      fear: opt(formData, "fear"),
      roadblock: opt(formData, "roadblock"),
      phase: opt(formData, "phase"),
      checkinCadenceDays: num(formData, "checkinCadenceDays") || c.checkinCadenceDays,
      nextCallAt: opt(formData, "nextCallAt"),
      notes: opt(formData, "notes"),
      passSerial: opt(formData, "passSerial"),
    })
    .where(eq(schema.clientRecords.id, id));
  refresh();
}

export async function logCheckinAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const clientRecordId = str(formData, "clientRecordId");
  const c = await own(clientRecordId, userId);
  const kind = (["checkin", "call", "note"] as const).find((k) => k === str(formData, "kind")) ?? "checkin";
  const date = opt(formData, "date") ?? v.today;
  const score = (k: string) => {
    const n = num(formData, k);
    return n ? Math.max(1, Math.min(10, n)) : null;
  };
  await db.insert(schema.clientCheckins).values({
    id: newId(),
    clientRecordId,
    userId,
    date,
    kind,
    wins: opt(formData, "wins"),
    blockers: opt(formData, "blockers"),
    supportNeeded: opt(formData, "supportNeeded"),
    nextStep: opt(formData, "nextStep"),
    mindset: score("mindset"),
    energy: score("energy"),
    business: score("business"),
    cashCollected: num(formData, "cashCollected"),
    nps: formData.has("nps") && str(formData, "nps") ? Math.max(0, Math.min(10, num(formData, "nps"))) : null,
  });
  const nextCall = opt(formData, "nextCallAt");
  await db
    .update(schema.clientRecords)
    .set({ lastCheckinAt: kind === "note" ? c.lastCheckinAt : date, nextCallAt: nextCall ?? (kind === "call" ? addDays(date, c.checkinCadenceDays) : c.nextCallAt) })
    .where(eq(schema.clientRecords.id, clientRecordId));
  refresh();
}

export async function deleteClientRecordAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "id");
  await own(id, userId);
  await db.delete(schema.clientRecords).where(eq(schema.clientRecords.id, id));
  refresh();
  redirect("/clients");
}

/** Awards points to one of the client's own members and pushes to their Community Loyalty webhook if configured. */
export async function awardMemberPointsAction(formData: FormData): Promise<void> {
  const { v, userId } = await ctx();
  const clientRecordId = str(formData, "clientRecordId");
  const c = await own(clientRecordId, userId);
  const points = Math.round(num(formData, "points"));
  const reason = str(formData, "reason") || "Points awarded";
  if (!points) return;
  const id = newId();
  await db.insert(schema.memberPoints).values({ id, clientRecordId, userId, points, reason, syncStatus: "local" });
  const webhook = v.membership.passWebhookUrl;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "points.award", member: { name: c.name, email: c.email, passSerial: c.passSerial }, points, reason, sentAt: nowIso() }),
        signal: AbortSignal.timeout(8000),
      });
      await db.update(schema.memberPoints).set({ syncStatus: res.ok ? "sent" : "failed", syncNote: res.ok ? null : `HTTP ${res.status}` }).where(eq(schema.memberPoints.id, id));
    } catch (err) {
      await db.update(schema.memberPoints).set({ syncStatus: "failed", syncNote: err instanceof Error ? err.message : "network error" }).where(eq(schema.memberPoints.id, id));
    }
  }
  refresh();
}

export async function updatePassAction(formData: FormData): Promise<void> {
  const { v } = await ctx();
  if (!v.membership.passEnabled) return;
  await db
    .update(schema.memberships)
    .set({
      passName: opt(formData, "passName"),
      passUrl: opt(formData, "passUrl"),
      passWebhookUrl: opt(formData, "passWebhookUrl"),
      passHashtag: opt(formData, "passHashtag"),
      passCommunityUrl: opt(formData, "passCommunityUrl"),
    })
    .where(eq(schema.memberships.id, v.membership.id));
  refresh();
}

export async function recentMemberPoints(userId: string, limit = 20) {
  return db.query.memberPoints.findMany({ where: eq(schema.memberPoints.userId, userId), orderBy: desc(schema.memberPoints.createdAt), limit });
}
