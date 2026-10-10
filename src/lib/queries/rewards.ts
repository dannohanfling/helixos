import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { todayInTz } from "@/lib/dates";

/**
 * Every claim in the workspace, grouped by reward name as YYYY-MM-DD dates in the given timezone, so a claim made this
 * evening counts against this month even when UTC has already rolled over. The caps count all clients together.
 */
export async function claimDatesByName(workspaceId: string, tz: string): Promise<Map<string, string[]>> {
  const rows = await db.select({ name: schema.rewardClaims.rewardName, createdAt: schema.rewardClaims.createdAt }).from(schema.rewardClaims).where(eq(schema.rewardClaims.workspaceId, workspaceId));
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const iso = r.createdAt.includes("T") ? r.createdAt : r.createdAt.replace(" ", "T") + "Z";
    out.set(r.name, [...(out.get(r.name) ?? []), todayInTz(tz, new Date(iso))]);
  }
  return out;
}

/** Claims the coach hasn't marked done yet: the count on the Coach menu item and on the coach's Today. */
export async function openClaims(workspaceId: string): Promise<number> {
  const rows = await db.select({ id: schema.rewardClaims.id }).from(schema.rewardClaims).where(and(eq(schema.rewardClaims.workspaceId, workspaceId), eq(schema.rewardClaims.status, "requested")));
  return rows.length;
}
