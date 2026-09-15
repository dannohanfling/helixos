"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { explainPlatformError } from "@/lib/engine/ghl-errors";
import { redactSecrets } from "@/lib/engine/redact";
import { nowIso } from "@/lib/dates";
import { connectionFor, getPost, refreshAccounts, upsertConnection } from "@/lib/ghl";
import { PUBLISHABLE, platformName } from "@/lib/engine/ghl-map";
import { ctx, opt, refresh, str } from "@/lib/action-helpers";
import { requireCoach } from "@/lib/auth";
import { logSync, pushContact } from "@/lib/integrations";
import { replayCandidates } from "@/lib/queries/contact-sync";
import { redirect } from "next/navigation";

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
  // "Don't auto-publish" is kept as an explicit "" so the next account check does not fill the channel back in.
  const mapping: Record<string, string> = {};
  for (const ch of Object.keys(PUBLISHABLE) as (keyof typeof PUBLISHABLE)[]) {
    if (!PUBLISHABLE[ch].via) continue;
    const v = str(formData, `map_${ch}`);
    mapping[ch] = v && conn.accounts.some((a) => a.id === v) ? v : "";
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
  await recordReadback(variant, conn);
  refresh();
}

/** Every version of one post that the planner holds, read back in one click. */
export async function checkAllPostStatusAction(formData: FormData): Promise<void> {
  const { userId } = await ctx();
  const contentId = str(formData, "contentId");
  const conn = await connectionFor(userId);
  if (!conn) return;
  const variants = await db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.contentItemId, contentId), eq(schema.contentVariants.userId, userId)) });
  for (const variant of variants) if (variant.externalId) await recordReadback(variant, conn);
  refresh();
}

/**
 * Stores what the planner said about one post. The platform's error text is classified into a client sentence
 * (explainPlatformError) and never stored as the vendor wrote it; the raw words go to the server log under [ghl].
 */
async function recordReadback(variant: schema.ContentVariant, conn: NonNullable<Awaited<ReturnType<typeof connectionFor>>>): Promise<void> {
  if (!variant.externalId) return;
  const r = await getPost(conn, variant.externalId);
  if (!r.ok) {
    await db.update(schema.contentVariants).set({ externalError: r.error, externalSyncedAt: nowIso() }).where(eq(schema.contentVariants.id, variant.id));
    return;
  }
  const published = r.data.status === "published";
  if (r.data.error) console.error("[ghl] readback error", JSON.stringify({ variantId: variant.id, postId: variant.externalId, status: r.data.status, error: redactSecrets(String(r.data.error)).slice(0, 300) }));
  await db
    .update(schema.contentVariants)
    .set({ externalStatus: r.data.status, externalError: explainPlatformError(r.data.error, platformName(variant.channel)), externalSyncedAt: nowIso(), ...(published ? { status: "posted", postedAt: variant.postedAt ?? r.data.publishedAt ?? nowIso() } : {}) })
    .where(eq(schema.contentVariants.id, variant.id));
}

/** The coach removes a client's connection: HelixOS's copy of the token goes; the sync log says who did it. The token itself lives on in GoHighLevel. */
export async function coachDisconnectGhlAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const userId = str(formData, "userId");
  const conn = await db.query.socialConnections.findFirst({ where: and(eq(schema.socialConnections.userId, userId), eq(schema.socialConnections.workspaceId, coach.workspace.id), eq(schema.socialConnections.provider, "gohighlevel")) });
  if (!conn) return;
  await db.delete(schema.socialConnections).where(eq(schema.socialConnections.id, conn.id));
  await logSync({ workspaceId: coach.workspace.id, userId, provider: "gohighlevel", direction: "out", event: "connection.removed", payload: { locationId: conn.locationId }, status: "sent", note: `Connection removed by the coach (${coach.user.name}); the token must also be deleted in GoHighLevel` });
  refresh();
}

/**
 * The coach replays the pushes that never happened, for one client: one record first, then the rest on a second click. Each
 * push goes through the same rule as a live one and stores the id GoHighLevel returns, so the replay is also what establishes
 * the join for every record created before the id existed. Never automatic.
 */
export async function replayContactSyncAction(formData: FormData): Promise<void> {
  const coach = await requireCoach();
  const userId = str(formData, "userId");
  const mode = str(formData, "mode") === "all" ? "all" : "one";
  const { ready } = await replayCandidates(coach.workspace.id, userId);
  const batch = mode === "all" ? ready : ready.slice(0, 1);
  let sent = 0;
  let failed = 0;
  const notes: string[] = [];
  for (const person of batch) {
    const r = await pushContact({ workspaceId: coach.workspace.id, userId }, person);
    if (r.ok) sent++;
    else failed++;
    if (notes.length < 3) notes.push(`${person.name}: ${r.note}`);
  }
  refresh();
  redirect(`/integrations?replay=${encodeURIComponent(JSON.stringify({ userId, mode, sent, failed, notes }))}#contact-sync`);
}
