import { NextResponse } from "next/server";
import { runReminders } from "@/lib/reminders";
import { runCommunity } from "@/lib/community";
import { safeEqual } from "@/lib/crypto";

/**
 * Hourly cron: GET /api/cron/reminders with `Authorization: Bearer $CRON_SECRET`.
 * Optional `?force=morning|evening` sends regardless of the hour (useful for testing). The same run posts each workspace's
 * Monday community post at the coach's time, and reads back the ones on their way (src/lib/community.ts).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  // No secret configured means nobody may call this, not everybody.
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const force = url.searchParams.get("force");
  const results = await runReminders(new Date(), force === "morning" || force === "evening" ? force : undefined);
  // A community failure never stops the reminders, and the reverse: each has its own result.
  const community = await runCommunity(new Date()).catch((e: unknown) => {
    console.error("[community] run failed", e instanceof Error ? e.name : "error");
    return [{ workspaceId: "", action: "error", ok: false, note: "The community run failed; the reason is in the server log." }];
  });
  return NextResponse.json({ ok: true, community, count: results.length, results: results.map((r) => ({ kind: r.kind, delivery: r.delivery, email: r.email.replace(/(.).+(@.*)/, "$1***$2"), ...(r.error ? { error: r.error.slice(0, 300) } : {}) })) });
}
