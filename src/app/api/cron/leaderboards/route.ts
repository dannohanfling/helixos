import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { refreshFeeds } from "@/lib/leaderboard";

/**
 * Every five minutes (vercel.json): GET /api/cron/leaderboards with `Authorization: Bearer $CRON_SECRET`. The one place that
 * reads a client's eLoyalty program after Connect and check (H-29): a visitor to a feed or a hosted page never does. One feed
 * at a time; a feed whose last check failed is skipped, and one that answered 429 waits a minute. The answer names outcomes by
 * feed address only, never a member or a key.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  // No secret configured means nobody may call this, not everybody.
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await refreshFeeds(new Date());
  return NextResponse.json({ ok: true, count: results.length, results });
}
