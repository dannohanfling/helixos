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
