"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { refresh, str, opt } from "@/lib/action-helpers";
import { requireViewer } from "@/lib/auth";
import { nowFor } from "@/lib/engine/channel-outcome";
import { ladderBlockers } from "@/lib/queries/outcomes";
import { handOffLadder } from "@/lib/rung-drip";

/** Hands one post's comment ladder to Community Loyalty. Refused, with the reason on the page, when the gate says no. */
export async function handOffLadderAction(formData: FormData): Promise<void> {
  const v = await requireViewer();
  const id = str(formData, "contentId");
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, v.user.id)) });
  if (!item) return;
  const [variants, ladder] = await Promise.all([
    db.query.contentVariants.findMany({ where: eq(schema.contentVariants.contentItemId, id) }),
    db.query.ladders.findFirst({ where: and(eq(schema.ladders.contentItemId, id), eq(schema.ladders.userId, v.user.id)) }),
  ]);
  if (!ladder) return;
  const blockers = await ladderBlockers(ladder);
  const threadsAt = opt(formData, "threadsAt");
  const r = await handOffLadder({ workspaceId: v.workspace.id, user: v.user, membership: v.membership, tz: v.tz, today: v.today }, item, variants, ladder, blockers, nowFor(v), threadsAt ? new Date(threadsAt).toISOString() : null);
  refresh();
  if (!r.ok) redirect(`/content/${id}/repurpose?drip=${encodeURIComponent(r.reason)}`);
}
