/**
 * How I feel (rev 653): one row a day, saved again to update only what was said. Energy, mood and sleep feel 1 to 5, soreness and
 * where. The member's own; the numbers follow coach sharing like sleep, the note is never shown to a coach. No advice is given.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/dates";

export type FeelingIn = { energy?: number | null; mood?: number | null; soreness?: (typeof schema.FEEL_SORENESS)[number] | null; sorenessArea?: string | null; sleepFeel?: number | null; note?: string | null };

const scale = (n: number | null | undefined) => (n == null ? undefined : Math.min(5, Math.max(1, Math.round(n))));

/** Save the day's feelings: what's given replaces, what's left out stays. */
export async function saveFeeling(workspaceId: string, userId: string, date: string, f: FeelingIn): Promise<schema.BodyFeeling> {
  const values = {
    ...(scale(f.energy) !== undefined ? { energy: scale(f.energy)! } : {}),
    ...(scale(f.mood) !== undefined ? { mood: scale(f.mood)! } : {}),
    ...(scale(f.sleepFeel) !== undefined ? { sleepFeel: scale(f.sleepFeel)! } : {}),
    ...(f.soreness ? { soreness: f.soreness, sorenessArea: f.soreness === "none" ? null : f.sorenessArea?.trim().slice(0, 60) || null } : {}),
    ...(f.note != null ? { note: f.note.trim().slice(0, 500) || null } : {}),
  };
  const where = and(eq(schema.bodyFeelings.workspaceId, workspaceId), eq(schema.bodyFeelings.userId, userId), eq(schema.bodyFeelings.date, date));
  const have = await db.query.bodyFeelings.findFirst({ where });
  if (have) await db.update(schema.bodyFeelings).set({ ...values, updatedAt: nowIso() }).where(where);
  else await db.insert(schema.bodyFeelings).values({ id: newId(), workspaceId, userId, date, ...values });
  return (await db.query.bodyFeelings.findFirst({ where }))!;
}

/** The days' feelings between two dates, by date. */
export async function feelingsIn(workspaceId: string, userId: string, from: string, to: string): Promise<schema.BodyFeeling[]> {
  return db.query.bodyFeelings.findMany({ where: and(eq(schema.bodyFeelings.workspaceId, workspaceId), eq(schema.bodyFeelings.userId, userId), gte(schema.bodyFeelings.date, from), lte(schema.bodyFeelings.date, to)) });
}
