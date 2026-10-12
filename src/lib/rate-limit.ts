/** Fixed-window rate limit backed by the database, so it holds across serverless instances. */
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";

/** Returns true when the call is allowed. Counts the attempt either way. */
export async function allow(key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await db.query.rateLimits.findFirst({ where: eq(schema.rateLimits.key, key) });
  if (!row || now - Number(row.windowStart) >= windowMs) {
    await db.insert(schema.rateLimits).values({ key, count: 1, windowStart: now }).onConflictDoUpdate({ target: schema.rateLimits.key, set: { count: 1, windowStart: now } });
    return true;
  }
  await db.update(schema.rateLimits).set({ count: row.count + 1 }).where(eq(schema.rateLimits.key, key));
  return row.count + 1 <= max;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/**
 * A limit that counts only what the caller counts (rev 843: sign-in counts wrong passwords, never successful ones). `peek`
 * says whether the key is over its limit and for how much longer, without counting; `bump` counts one; `clearLimit` resets it.
 */
export async function peekLimit(key: string, max: number, windowMs: number): Promise<{ blocked: boolean; retryInMs: number }> {
  const row = await db.query.rateLimits.findFirst({ where: eq(schema.rateLimits.key, key) });
  const now = Date.now();
  if (!row || now - Number(row.windowStart) >= windowMs) return { blocked: false, retryInMs: 0 };
  return { blocked: row.count >= max, retryInMs: Number(row.windowStart) + windowMs - now };
}
export async function bumpLimit(key: string, windowMs: number): Promise<void> {
  const now = Date.now();
  const row = await db.query.rateLimits.findFirst({ where: eq(schema.rateLimits.key, key) });
  if (!row || now - Number(row.windowStart) >= windowMs) {
    await db.insert(schema.rateLimits).values({ key, count: 1, windowStart: now }).onConflictDoUpdate({ target: schema.rateLimits.key, set: { count: 1, windowStart: now } });
    return;
  }
  await db.update(schema.rateLimits).set({ count: row.count + 1 }).where(eq(schema.rateLimits.key, key));
}
export async function clearLimit(key: string): Promise<void> {
  await db.delete(schema.rateLimits).where(eq(schema.rateLimits.key, key));
}
