"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { connectionFor, getPost, refreshAccounts, upsertConnection } from "@/lib/ghl";
import { PUBLISHABLE } from "@/lib/engine/ghl-map";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";

/** Saves the member's own sub-account and validates the token against GoHighLevel right away. Errors carry the real reason. */
export async function connectGhlAction(formData: FormData): Promise<void> {
  const { workspaceId, userId } = await ctx();
  const locationId = str(formData, "locationId");
  const ghlUserId = opt(formData, "ghlUserId");
  if (!locationId) return;
  const r = await upsertConnection({ workspaceId, userId, locationId, ghlUserId, manualToken: opt(formData, "manualToken") });
  if (!r.ok) {
    const existing = await connectionFor(userId);
    if (existing) await db.update(schema.socialConnections).set({ lastError: r.error }).where(eq(schema.socialConnections.id, existing.id));
    else await db.insert(schema.socialConnections).values({ id: crypto.randomUUID(), workspaceId, userId, provider: "gohighlevel", locationId, ghlUserId, lastError: r.error });
    refresh();
    return;
  }
  await refreshAccounts(r.data);
  refresh();
}

export async function refreshGhlAccountsAction(): Promise<void> {
  const { userId } = await ctx();
  const conn = await connectionFor(userId);
  if (conn) await refreshAccounts(conn);
  refresh();
}

/** Channel → account choices from the mapping form. Empty means "don't auto-publish this channel". */
export async function setGhlMappingAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const conn = await connectionFor(userId);
  if (!conn) return;
  const mapping: Record<string, string> = {};
  for (const ch of Object.keys(PUBLISHABLE)) {
    const v = str(formData, `map_${ch}`);
    if (v && conn.accounts.some((a) => a.id === v)) mapping[ch] = v;
  }
  await db.update(schema.socialConnections).set({ mapping }).where(eq(schema.socialConnections.id, conn.id));
  refresh();
}

export async function disconnectGhlAction(): Promise<void> {
  const { userId } = await ctx();
  await db.delete(schema.socialConnections).where(and(eq(schema.socialConnections.userId, userId), eq(schema.socialConnections.provider, "gohighlevel")));
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
