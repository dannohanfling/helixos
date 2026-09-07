import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { nowIso } from "@/lib/dates";
import { catalogue } from "@/lib/engine/rewards";
import { loadRewardsConfig } from "@/lib/rewards-config";
import prizes from "@/data/seed/prizes.json";
import rewards from "@/data/seed/rewards.json";

/**
 * The client's way to their booking link: records the first time they followed it (the coach's only "did they book"
 * signal), then sends them on. Only the claim's owner can use it.
 */
export async function GET(request: Request, { params }: RouteContext<"/rewards/book/[claimId]">) {
  const v = await getViewer();
  if (!v) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { claimId } = await params;
  const claim = await db.query.rewardClaims.findFirst({ where: and(eq(schema.rewardClaims.id, claimId), eq(schema.rewardClaims.workspaceId, v.workspace.id), eq(schema.rewardClaims.userId, v.user.id)) });
  const url = claim ? catalogue(rewards, prizes, loadRewardsConfig()).find((i) => i.name === claim.rewardName)?.bookingUrl : null;
  if (!claim || !url) return NextResponse.redirect(new URL("/rewards", request.url), 303);
  if (!claim.bookingOpenedAt) await db.update(schema.rewardClaims).set({ bookingOpenedAt: nowIso() }).where(eq(schema.rewardClaims.id, claim.id));
  return NextResponse.redirect(url, 303);
}
