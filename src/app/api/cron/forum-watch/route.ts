import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { watchAllForums } from "@/lib/forum-watch";

/**
 * Every five minutes (vercel.json): GET /api/cron/forum-watch with `Authorization: Bearer $CRON_SECRET`. The stall watch
 * (H-495): flags an agent that has stopped checking in, once per stall, and clears one that is back. The answer is counts only.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  // No secret configured means nobody may call this, not everybody.
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await watchAllForums(new Date());
  console.log(`forum-watch: ${r.forums} forums, ${r.flagged} flagged, ${r.cleared} cleared`);
  return NextResponse.json({ ok: true, ...r });
}
