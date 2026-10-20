import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { allow } from "@/lib/rate-limit";
import { leadWorkspace, recordLead } from "@/lib/partner-lead";
import { reportError } from "@/lib/report-error";

/**
 * POST /api/webhooks/partner-lead (H-1361 PR B): the Community Loyalty PARTNER bot's lead, with header `x-helix-secret` set
 * to PARTNER_LEAD_KEY (Danno sets both; the key never appears in code, chat or a log). Body: business, type, city,
 * google_reviews_bucket, pain, demo_time, source. Never in the query string: URLs end up in logs.
 */
export async function POST(request: Request) {
  const key = (process.env.PARTNER_LEAD_KEY ?? "").trim();
  if (!key) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const given = request.headers.get("x-helix-secret") ?? "";
  if (!given || !safeEqual(given, key)) return NextResponse.json({ error: "unknown secret" }, { status: 401 });
  if (!(await allow("webhook:partner-lead", 120, 60_000))) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "a JSON body is required" }, { status: 400 });
    const workspaceId = await leadWorkspace();
    if (!workspaceId) return NextResponse.json({ error: "no workspace for leads (set PARTNER_LEAD_WORKSPACE)" }, { status: 503 });
    const r = await recordLead(workspaceId, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, restaurantId: r.restaurantId, created: r.created, stage: r.stage });
  } catch (e) {
    reportError(e, { job: "webhook:partner-lead" });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
