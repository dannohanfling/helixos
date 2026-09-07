"use server";

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { totalPoints } from "@/lib/queries/points";
import { ctx, refresh, str } from "@/lib/action-helpers";
import { catalogue, claimability } from "@/lib/engine/rewards";
import { tierFor } from "@/lib/engine/tiers";
import { loadRewardsConfig } from "@/lib/rewards-config";
import { claimDatesByName } from "@/lib/queries/rewards";
import prizes from "@/data/seed/prizes.json";
import rewards from "@/data/seed/rewards.json";

export type ClaimState = { error?: string; ok?: string } | undefined;

/**
 * An instant unlock: every rule is checked here, against the catalogue and the whole workspace's claims, before a point
 * moves. The cost comes from the catalogue, never from the form. A refused claim says why; a granted one deducts the
 * points and reveals that reward's own booking link.
 */
export async function claimRewardAction(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const { v, workspaceId, userId } = await ctx();
  const name = str(formData, "name");
  const config = loadRewardsConfig();
  const item = catalogue(rewards, prizes, config).find((i) => i.name === name);
  if (!item) return { error: "That reward isn't in the catalogue." };
  const [points, mine, dates] = await Promise.all([
    totalPoints(workspaceId, userId),
    db.query.rewardClaims.findMany({ where: and(eq(schema.rewardClaims.workspaceId, workspaceId), eq(schema.rewardClaims.userId, userId)) }),
    claimDatesByName(workspaceId, v.tz),
  ]);
  const verdict = claimability(item, { points, tierLevel: tierFor(points).level, claimed: new Set(mine.map((c) => c.rewardName)), claimDates: dates.get(item.name) ?? [], today: v.today, mode: config.perMonth });
  if (!verdict.ok) return { error: verdict.message };
  await db.insert(schema.rewardClaims).values({ id: newId(), workspaceId, userId, rewardName: item.name, pointsSpent: item.cost });
  if (item.cost > 0) {
    await db.insert(schema.pointsLedger).values({ id: newId(), workspaceId, userId, type: "redeem", points: -item.cost, reason: `Claimed: ${item.name}` });
  }
  refresh();
  return { ok: item.cost ? `Claimed. ${item.cost.toLocaleString()} points spent. Your booking link is ready.` : "Claimed. Your booking link is ready." };
}
