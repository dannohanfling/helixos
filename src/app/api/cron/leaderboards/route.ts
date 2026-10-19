import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { refreshFeeds } from "@/lib/leaderboard";
import { drainAll } from "@/lib/points-outbox";
import { syncAll } from "@/lib/points-sync";

/**
 * Every five minutes (vercel.json): GET /api/cron/leaderboards with `Authorization: Bearer $CRON_SECRET`. The one place that
 * reads a client's eLoyalty program after Connect and check (H-29), and sends the points outbox's moves that are due (H-493):
 * a visitor to a feed or a hosted page never does either. One feed
 * at a time; a feed whose last check failed is skipped, and one that answered 429 waits a minute. The answer names outcomes by
 * feed address only, never a member or a key.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  // No secret configured means nobody may call this, not everybody.
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // The points outbox first (H-493): moves due are sent, or settled from the events, before the boards are read again.
  // The points sync on the coach's own program (H-867): new moves are queued first, so this run sends them; off by default.
  const sync = await syncAll(new Date());
  const moves = await drainAll(new Date());
  const results = await refreshFeeds(new Date());
  return NextResponse.json({ ok: true, count: results.length, results, moves, sync });
}
