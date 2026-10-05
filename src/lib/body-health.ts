/**
 * Apple Health weigh-ins (rev 508 §4): the member's key for the iOS Shortcut, and what the endpoint does with a post. The key
 * is made here, shown once to the member who made it, and stored only as its hash; revoking ends it. A post saves through the
 * one weigh-in helper (src/lib/body-readings.ts), so a reading the scale's export or a typed entry already has is one row.
 * Nothing of a body's numbers, and never the key, is logged.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { saveReadings } from "@/lib/body-readings";
import { parseHealthPost, savedLine } from "@/lib/engine/body-health-ingest";
import { bodySettingsFor } from "@/lib/queries/body";
import { nowIso, todayInTz } from "@/lib/dates";
import { newId } from "@/lib/ids";

type Member = { workspaceId: string; userId: string };
const PREFIX = "hxh_";
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const mine = (m: Member) => and(eq(schema.bodyIngestTokens.workspaceId, m.workspaceId), eq(schema.bodyIngestTokens.userId, m.userId));

/** A new key for the member, replacing any they had: the old one stops working at once. Returned once, never stored. */
export async function makeHealthKey(m: Member): Promise<string> {
  const key = `${PREFIX}${randomBytes(24).toString("base64url")}`;
  await db.update(schema.bodyIngestTokens).set({ revokedAt: nowIso() }).where(and(mine(m), isNull(schema.bodyIngestTokens.revokedAt)));
  await db.insert(schema.bodyIngestTokens).values({ id: newId(), ...m, tokenHash: hashKey(key) });
  return key;
}

export async function revokeHealthKey(m: Member): Promise<void> {
  await db.update(schema.bodyIngestTokens).set({ revokedAt: nowIso() }).where(and(mine(m), isNull(schema.bodyIngestTokens.revokedAt)));
}

/** Whether the member has a live key, when it was made and when a post last used it. Never the key or its hash. */
export async function healthKeyStatus(m: Member): Promise<{ createdAt: string; lastUsedAt: string | null } | null> {
  const row = await db.query.bodyIngestTokens.findFirst({ where: and(mine(m), isNull(schema.bodyIngestTokens.revokedAt)), orderBy: desc(schema.bodyIngestTokens.createdAt), columns: { createdAt: true, lastUsedAt: true } });
  return row ?? null;
}

/** The live key a post carries, or null. Only a key of the right shape is looked up. */
export async function keyFor(key: string): Promise<{ id: string; workspaceId: string; userId: string } | null> {
  if (!key.startsWith(PREFIX) || key.length < 20 || key.length > 100) return null;
  const row = await db.query.bodyIngestTokens.findFirst({ where: and(eq(schema.bodyIngestTokens.tokenHash, hashKey(key)), isNull(schema.bodyIngestTokens.revokedAt)), columns: { id: true, workspaceId: true, userId: true } });
  return row ?? null;
}

/**
 * One post from the Shortcut, for the key's member: refused while HumanOS is off for them or they've left; otherwise parsed
 * and saved as Apple Health's, and the key's last use noted. The answer is what the Shortcut shows.
 */
export async function ingestHealthPost(key: { id: string; workspaceId: string; userId: string }, body: unknown): Promise<{ status: number; text: string }> {
  const [mem, ws] = await Promise.all([
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, key.workspaceId), eq(schema.memberships.userId, key.userId)), columns: { bodyEnabled: true, removedAt: true, timezone: true } }),
    db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, key.workspaceId), columns: { timezone: true } }),
  ]);
  if (!mem || mem.removedAt) return { status: 403, text: "This key's account isn't active any more." };
  if (!mem.bodyEnabled) return { status: 403, text: "HumanOS is off for this account, so nothing was saved." };
  const today = todayInTz(mem.timezone ?? ws?.timezone ?? "UTC");
  const parsed = parseHealthPost(body, today);
  if ("error" in parsed) return { status: 422, text: parsed.error };
  const saved = await saveReadings(key.workspaceId, key.userId, parsed.readings, "health");
  await db.update(schema.bodyIngestTokens).set({ lastUsedAt: nowIso() }).where(eq(schema.bodyIngestTokens.id, key.id));
  const unit = (await bodySettingsFor(key.workspaceId, key.userId))?.weightUnit ?? "lb";
  const line = savedLine(parsed.readings, saved.map((s) => s.outcome), unit);
  return { status: 200, text: parsed.skipped.length ? `${line} Left out: ${parsed.skipped.join("; ")}.` : line };
}
