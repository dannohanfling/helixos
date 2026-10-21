import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/ids";

export const dynamic = "force-dynamic";

/**
 * POST /api/app/device: the HelixOS app records the phone it runs on (H-877), on every open, with the member's own session.
 * Body: { installId, platform: "ios" | "android", token?, appVersion? }. The token is Apple's or Google's push address,
 * sent once the member said yes to notifications. Only the member's own phone: never a coach switched in, never a team member.
 */
export async function POST(request: Request) {
  const v = await apiViewer();
  if (!v) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  if (v.switchedInto || v.team) return NextResponse.json({ ok: true, skipped: "not your own HelixOS" });
  const b = (await request.json().catch(() => null)) as { installId?: unknown; platform?: unknown; token?: unknown; appVersion?: unknown } | null;
  const installId = typeof b?.installId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(b.installId) ? b.installId : null;
  const platform = b?.platform === "ios" || b?.platform === "android" ? b.platform : null;
  if (!installId || !platform) return NextResponse.json({ error: "installId and platform are required" }, { status: 400 });
  const token = typeof b?.token === "string" && /^[A-Za-z0-9:_\-.]{16,4096}$/.test(b.token) ? b.token : undefined;
  const appVersion = typeof b?.appVersion === "string" ? b.appVersion.slice(0, 40) : undefined;
  const now = nowIso();
  const where = and(eq(schema.pushDevices.membershipId, v.membership.id), eq(schema.pushDevices.installId, installId));
  const existing = await db.query.pushDevices.findFirst({ where });
  if (existing) {
    await db
      .update(schema.pushDevices)
      .set({ platform, lastSeenAt: now, ...(appVersion ? { appVersion } : {}), ...(token ? { token, disabledAt: null } : {}) })
      .where(eq(schema.pushDevices.id, existing.id));
  } else {
    await db.insert(schema.pushDevices).values({ id: newId(), workspaceId: v.workspace.id, membershipId: v.membership.id, userId: v.user.id, platform, installId, token: token ?? null, appVersion: appVersion ?? null, lastSeenAt: now });
  }
  return NextResponse.json({ ok: true });
}
