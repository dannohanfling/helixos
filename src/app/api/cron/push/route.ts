import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { reportError } from "@/lib/report-error";
import { runDailyPushes } from "@/lib/push/daily";
import { runCallPushes } from "@/lib/push/calls";
import { runEventPushes } from "@/lib/push/events";
import { pruneSends } from "@/lib/push/send";

/**
 * Every 5 minutes (vercel.json): GET /api/cron/push with `Authorization: Bearer $CRON_SECRET`. Sends the pushes that are due
 * (H-877), so a call reminder 15 minutes before can land on time. Answers counts only: never a member, never the words.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const daily = await runDailyPushes(now).catch((e: unknown) => {
    reportError(e, { job: "cron:push" });
    return [];
  });
  const calls = await runCallPushes(now).catch((e: unknown) => {
    reportError(e, { job: "cron:push-calls" });
    return [];
  });
  const events = await runEventPushes(now).catch((e: unknown) => {
    reportError(e, { job: "cron:push-events" });
    return [];
  });
  await pruneSends(now).catch((e: unknown) => reportError(e, { job: "cron:push-prune" }));
  const counts: Record<string, { sent: number; held: number }> = {};
  for (const r of [...daily, ...events]) {
    const c = (counts[r.type] ??= { sent: 0, held: 0 });
    if (r.outcome.sent) c.sent++;
    else c.held++;
  }
  for (const r of calls) {
    const c = (counts[`call_${r.step}`] ??= { sent: 0, held: 0 });
    if (r.outcome.sent) c.sent++;
    else c.held++;
  }
  return NextResponse.json({ ok: true, counts });
}
