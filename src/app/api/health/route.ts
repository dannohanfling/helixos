import { NextResponse } from "next/server";
import { db, schema } from "@/db";

export const dynamic = "force-dynamic";

/** The one forced error (H-349 §2): with SENTRY_SMOKE=1 on a preview, the first health check after a deploy throws once, so Danno sees a known event in Sentry. Never on production. */
let smoked = false;

/**
 * Uptime (H-349 §3): 200 `{ ok: true }` when the database answers, 503 `{ ok: false }` when it does not, so a monitor on this
 * address catches an outage. Public, no body of anyone's, read by Vercel's cron every five minutes and by the uptime monitor.
 */
export async function GET() {
  if (process.env.SENTRY_SMOKE === "1" && process.env.VERCEL_ENV !== "production" && !smoked) {
    smoked = true;
    throw new Error("Sentry smoke test: a known error from /api/health, once per deploy");
  }
  try {
    const [row] = await db.select({ key: schema.pathwayStages.key }).from(schema.pathwayStages).limit(1);
    return NextResponse.json({ ok: true, seeded: Boolean(row) });
  } catch (e) {
    console.error("[health] database check failed", e instanceof Error ? e.name : "error");
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
