"use server";

import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { nowFor, type ChannelOutcome } from "@/lib/engine/channel-outcome";
import { refreshStale } from "@/lib/planner-status";
import { outcomesForItem } from "@/lib/queries/outcomes";

/** One post's per-channel outcomes, for the viewer's own post. The composer polls this after scheduling. */
export async function channelOutcomesAction(contentId: string): Promise<ChannelOutcome[]> {
  const v = await requireViewer();
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, contentId), eq(schema.contentItems.userId, v.user.id)) });
  if (!item) return [];
  const rows = await db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.contentItemId, contentId), eq(schema.contentVariants.userId, v.user.id)), orderBy: [asc(schema.contentVariants.createdAt)] });
  // An accepted row with no id is looked up in the planner's list here too, so the panel resolves it without a click.
  const fresh = await refreshStale(v.user.id, rows, 4);
  return outcomesForItem(v, item, fresh, nowFor(v));
}
