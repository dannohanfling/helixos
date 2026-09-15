"use server";

import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { nowFor, outcomesFor, type ChannelOutcome } from "@/lib/engine/channel-outcome";

/** One post's per-channel outcomes, for the viewer's own post. The composer polls this after scheduling. */
export async function channelOutcomesAction(contentId: string): Promise<ChannelOutcome[]> {
  const v = await requireViewer();
  const rows = await db.query.contentVariants.findMany({ where: and(eq(schema.contentVariants.contentItemId, contentId), eq(schema.contentVariants.userId, v.user.id)), orderBy: [asc(schema.contentVariants.createdAt)] });
  return outcomesFor(rows, nowFor(v));
}
