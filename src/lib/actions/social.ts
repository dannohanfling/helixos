"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCoach } from "@/lib/auth";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { connectionFor, getPost, refreshAccounts, upsertConnection } from "@/lib/ghl";
import { PUBLISHABLE } from "@/lib/engine/ghl-map";
import { ctx, opt, refresh, str } from "./common";

/** Who the change is for: the signed-in member, or (coach only) a member picked on the Integrations page. */
async function target(formData: FormData) {
  const c = await ctx();
  const forUser = opt(formData, "forUserId");
  if (forUser && forUser !== c.userId) {
    const coach = await requireCoach();
    const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, coach.workspace.id), eq(schema.memberships.userId, forUser)) });
    if (!m) throw new Error("Member not found");
    return { workspaceId: coach.workspace.id, userId: forUser, byCoach: true };
  }
  return { workspaceId: c.workspaceId, userId: c.userId, byCoach: c.v.role === "coach" };
}

/** Saves the sub-account details and pulls its connected accounts. Members can't bind themselves to a sub-account they don't hold a token for. */
export async function connectGhlAction(formData: FormData): Promise<void> {
  const t = await target(formData);
  const locationId = str(formData, "locationId");
  if (!locationId) return;
  const r = await upsertConnection({ ...t, locationId, ghlUserId: opt(formData, "ghlUserId"), manualToken: opt(formData, "manualToken") });
  if (!r.ok) {
    const existing = await connectionFor(t.userId);
    if (existing) await db.update(schema.socialConnections).set({ lastError: r.error }).where(eq(schema.socialConnections.id, existing.id));
    else await db.insert(schema.socialConnections).values({ id: newId(), workspaceId: t.workspaceId, userId: t.userId, provider: "gohighlevel", locationId, coachAssigned: false, ghlUserId: opt(formData, "ghlUserId"), lastError: r.error });
    refresh();
    return;
  }
  await refreshAccounts(r.data);
  refresh();
}

export async function refreshGhlAccountsAction(formData: FormData): Promise<void> {
  const t = await target(formData);
  const conn = await connectionFor(t.userId);
  if (conn) await refreshAccounts(conn);
  refresh();
}

/** Channel → account choices from the mapping form. Empty means "don't auto-publish this channel". */
export async function setGhlMappingAction(formData: FormData): Promise<void> {
  const t = await target(formData);
  const conn = await connectionFor(t.userId);
  if (!conn) return;
  const mapping: Record<string, string> = {};
  for (const ch of Object.keys(PUBLISHABLE)) {
    const v = str(formData, `map_${ch}`);
    if (v && conn.accounts.some((a) => a.id === v)) mapping[ch] = v;
  }
  await db.update(schema.socialConnections).set({ mapping }).where(eq(schema.socialConnections.id, conn.id));
  refresh();
}

export async function disconnectGhlAction(formData: FormData): Promise<void> {
  const t = await target(formData);
  await db.delete(schema.socialConnections).where(and(eq(schema.socialConnections.userId, t.userId), eq(schema.socialConnections.provider, "gohighlevel")));
  refresh();
}

/** Asks GHL what happened to a scheduled post and stores the answer on the variant. */
export async function syncPostStatusAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const id = str(formData, "variantId") || str(formData, "id");
  const variant = await db.query.contentVariants.findFirst({ where: and(eq(schema.contentVariants.id, id), eq(schema.contentVariants.userId, userId)) });
  if (!variant?.externalId) return;
  const conn = await connectionFor(userId);
  if (!conn) return;
  const r = await getPost(conn, variant.externalId);
  if (!r.ok) {
    await db.update(schema.contentVariants).set({ externalError: r.error, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, id));
  } else {
    const published = r.data.status === "published";
    await db
      .update(schema.contentVariants)
      .set({ externalStatus: r.data.status, externalError: r.data.error, externalSyncedAt: nowIso(), ...(published ? { status: "posted", postedAt: variant.postedAt ?? r.data.publishedAt ?? nowIso() } : {}) })
      .where(eq(schema.contentVariants.id, id));
  }
  refresh();
}
