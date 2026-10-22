import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { HAS_APP_DAYS } from "@/lib/app-links";

/**
 * Whether this member has the HelixOS app (H-655): the platform of their phone that opened it most recently, within the last
 * 30 days, or null. One indexed read (push_devices_member). The store app records each open through /api/app/device.
 */
export async function hasAppFor(membershipId: string, now = new Date()): Promise<"ios" | "android" | null> {
  // The app records each open as an ISO time (nowIso), so the cut-off is one too.
  const since = new Date(now.getTime() - HAS_APP_DAYS * 86_400_000).toISOString();
  const row = await db
    .select({ platform: schema.pushDevices.platform })
    .from(schema.pushDevices)
    .where(and(eq(schema.pushDevices.membershipId, membershipId), gte(schema.pushDevices.lastSeenAt, since)))
    .orderBy(desc(schema.pushDevices.lastSeenAt))
    .limit(1);
  return row[0]?.platform ?? null;
}
