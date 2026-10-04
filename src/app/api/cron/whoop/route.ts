import { NextResponse } from "next/server";
import { catchUpWhoop } from "@/lib/body-whoop";
import { safeEqual } from "@/lib/crypto";

// One member at a time, each a few seconds; the run stops starting new ones well before this.
export const maxDuration = 300;

/**
 * Hourly cron (rev 473): GET /api/cron/whoop with `Authorization: Bearer $CRON_SECRET`. Every connected WHOOP whose last finished
 * sync is over 50 minutes old pulls from two days before it, so a workout whose webhook never came, or failed, is in within the
 * hour. The answer is counts only: no member, no data.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  // No secret configured means nobody may call this, not everybody.
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await catchUpWhoop(Date.now() + 240_000);
  return NextResponse.json({ ok: true, ...result });
}
