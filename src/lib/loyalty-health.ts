import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { nowIso } from "@/lib/dates";
import { heldBoard } from "@/lib/leaderboard";
import { type OutboxCounts, outboxCounts } from "@/lib/engine/loyalty-health";

/**
 * The loyalty health view (H-622 §2): one row per program on the coach's workspace, read from HelixOS only. Nothing here calls
 * eLoyalty; "Check all now" (in the actions) runs the existing read-only check.
 */

export type HealthRow = {
  feed: schema.LeaderboardFeed;
  name: string;
  own: boolean;
  onBoard: number | null;
  outbox: OutboxCounts;
};

/** Every program on this workspace, the coach's own first, then the clients' by name. */
export async function healthRows(workspaceId: string, coachMembershipId: string, now = new Date()): Promise<HealthRow[]> {
  const feeds = await db.query.leaderboardFeeds.findMany({ where: and(eq(schema.leaderboardFeeds.workspaceId, workspaceId), isNotNull(schema.leaderboardFeeds.keyEncrypted)) });
  if (!feeds.length) return [];
  const ids = feeds.map((f) => f.id);
  const [members, moves] = await Promise.all([
    db.query.memberships.findMany({ where: inArray(schema.memberships.id, feeds.map((f) => f.membershipId)), columns: { id: true, userId: true, businessName: true } }),
    db.query.loyaltyPointsMoves.findMany({ where: inArray(schema.loyaltyPointsMoves.feedId, ids), columns: { feedId: true, status: true, createdAt: true, sentAt: true, lastNote: true } }),
  ]);
  const users = await db.query.users.findMany({ where: inArray(schema.users.id, members.map((m) => m.userId)), columns: { id: true, name: true } });
  const nameOf = (membershipId: string) => {
    const m = members.find((x) => x.id === membershipId);
    return m?.businessName || users.find((u) => u.id === m?.userId)?.name || "Program";
  };
  const rows = feeds.map((feed) => ({
    feed,
    name: nameOf(feed.membershipId),
    own: feed.membershipId === coachMembershipId,
    onBoard: heldBoard(feed)?.rows.length ?? null,
    outbox: outboxCounts(moves.filter((m) => m.feedId === feed.id), now),
  }));
  return rows.sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
}

/** Save a program's Pass Type ID and certificate expiry, on this workspace only. */
export async function saveCert(feedId: string, workspaceId: string, passTypeId: string | null, certExpiresAt: string | null): Promise<boolean> {
  const done = await db
    .update(schema.leaderboardFeeds)
    .set({ passTypeId, certExpiresAt, updatedAt: nowIso() })
    .where(and(eq(schema.leaderboardFeeds.id, feedId), eq(schema.leaderboardFeeds.workspaceId, workspaceId)))
    .returning({ id: schema.leaderboardFeeds.id });
  return done.length > 0;
}
