import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { nextRateLimit } from "@/lib/engine/loyalty-health";

/** Count one 429 from eLoyalty on this program, in its 24-hour window. Never throws: a failed count must not stop the caller. */
export async function recordRateLimit(feedId: string, now = new Date()): Promise<void> {
  try {
    const feed = await db.query.leaderboardFeeds.findFirst({ where: eq(schema.leaderboardFeeds.id, feedId), columns: { rateLimitedCount: true, rateLimitedAt: true } });
    if (!feed) return;
    const next = nextRateLimit(feed.rateLimitedCount, feed.rateLimitedAt, now);
    await db.update(schema.leaderboardFeeds).set({ rateLimitedCount: next.count, rateLimitedAt: next.at }).where(eq(schema.leaderboardFeeds.id, feedId));
  } catch (e) {
    console.log(`[loyalty-health] could not count a 429: ${e instanceof Error ? e.name : "error"}`);
  }
}
