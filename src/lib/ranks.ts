/**
 * The kept rank (H-1088): the highest rank a member has ever held. The thresholds rose on 19 Oct; everyone kept the rank they
 * had, backfilled by migration 0222. From then on, when points take a member past their kept rank, it climbs with them, once,
 * on their own open, so a later correction to their points never takes a rank back. A coach switched in and a team member
 * write nothing.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Viewer } from "@/lib/auth";
import { tierFor } from "@/lib/engine/tiers";

export async function keepRank(v: Viewer, points: number): Promise<void> {
  if (v.switchedInto || v.team) return;
  const earned = tierFor(points).level;
  if (earned <= (v.membership.rankKeptLevel ?? 0)) return;
  await db.update(schema.memberships).set({ rankKeptLevel: earned }).where(eq(schema.memberships.id, v.membership.id));
  v.membership.rankKeptLevel = earned;
}
