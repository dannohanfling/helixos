import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { staleScheduled, type StaleScheduled } from "@/lib/engine/ladder";

/** The ladder a content item was sent from, if any (scoped to its owner). */
export async function ladderForItem(itemId: string, userId: string) {
  return db.query.ladders.findFirst({ where: and(eq(schema.ladders.contentItemId, itemId), eq(schema.ladders.userId, userId)) });
}

/** Scheduled channel posts of this ladder's content item that still carry text older than the ladder's. */
export async function staleScheduledFor(l: schema.Ladder): Promise<StaleScheduled[]> {
  if (!l.contentItemId) return [];
  const variants = await db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.contentItemId, l.contentItemId), eq(schema.contentVariants.userId, l.userId)) });
  return staleScheduled(l, variants);
}
