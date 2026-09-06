import { NextResponse } from "next/server";
import { runReminders } from "@/lib/reminders";
import { safeEqual } from "@/lib/crypto";

/**
 * Hourly cron: GET /api/cron/reminders with `Authorization: Bearer $CRON_SECRET`.
 * Optional `?force=morning|evening` sends regardless of the hour (useful for testing).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  // No secret configured means nobody may call this, not everybody.
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const force = url.searchParams.get("force");
  const results = await runReminders(new Date(), force === "morning" || force === "evening" ? force : undefined);
  return NextResponse.json({ ok: true, count: results.length, results: results.map((r) => ({ kind: r.kind, delivery: r.delivery, email: r.email.replace(/(.).+(@.*)/, "$1***$2"), ...(r.error ? { error: r.error.slice(0, 300) } : {}) })) });
}
