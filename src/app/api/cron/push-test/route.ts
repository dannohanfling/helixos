import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { reportError } from "@/lib/report-error";
import { runTestSeries } from "@/lib/push/test-series";

/**
 * Every minute (vercel.json): GET /api/cron/push-test with `Authorization: Bearer $CRON_SECRET`. Sends a coach's test series
 * (H-1967) as each one falls due. With nothing queued it is one small read. Answers counts only.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await runTestSeries(new Date()).catch((e: unknown) => {
    reportError(e, { job: "cron:push-test" });
    return { sent: 0, held: 0 };
  });
  return NextResponse.json(r);
}
