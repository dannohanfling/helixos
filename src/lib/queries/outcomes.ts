/**
 * One post's outcome rows for a page: the channel rows from the one rule, plus the comment ladder's handoff row when the
 * member's Community Loyalty drip is set up. Every surface (card, composer, Distribute) reads this and nothing else.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { handoffOutcome, outcomesFor, type ChannelOutcome, type Now } from "@/lib/engine/channel-outcome";
import { checklist, publishBlockers } from "@/lib/engine/ladder";
import { dripSetup, handoffGate, handoffRowFor } from "@/lib/rung-drip";

type Viewer = { user: { id: string }; membership: schema.Membership; tz: string; today: string; workspace: { id: string } };

export async function ladderBlockers(l: schema.Ladder): Promise<number> {
  const [profile, proofs] = await Promise.all([
    db.query.ladderProfiles.findFirst({ where: and(eq(schema.ladderProfiles.workspaceId, l.workspaceId), eq(schema.ladderProfiles.userId, l.userId)) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.workspaceId, l.workspaceId), eq(schema.proofs.userId, l.userId), eq(schema.proofs.status, "approved")) }),
  ]);
  return publishBlockers(checklist(l, profile ?? null, proofs)).length;
}

/** The handoff row for one item: handed, not handed (with reasons), or null when the drip is not set up. */
export async function handoffRow(v: Viewer, item: schema.ContentItem, variants: schema.ContentVariant[], now: Now): Promise<{ row: ChannelOutcome | null; reasons: string[]; ladder: schema.Ladder | null; blockers: number }> {
  if (!dripSetup(v.membership).on) return { row: null, reasons: [], ladder: null, blockers: 0 };
  const handed = await handoffRowFor(v.user.id, item.id);
  const ladder = (await db.query.ladders.findFirst({ where: and(eq(schema.ladders.contentItemId, item.id), eq(schema.ladders.userId, v.user.id)) })) ?? null;
  const blockers = ladder ? await ladderBlockers(ladder) : 0;
  const { reasons } = await handoffGate(v, item, variants, ladder, blockers, now);
  return { row: handoffOutcome(handed, handed ? null : reasons, now), reasons, ladder, blockers };
}

export async function outcomesForItem(v: Viewer, item: schema.ContentItem, variants: schema.ContentVariant[], now: Now): Promise<ChannelOutcome[]> {
  const rows = variants.filter((x) => x.contentItemId === item.id);
  const { row } = await handoffRow(v, item, rows, now);
  return outcomesFor(rows, now, [row]);
}
