import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { askState, recordAnswer } from "@/lib/push/prefs";

export const dynamic = "force-dynamic";

/**
 * The HelixOS permission card in the app (H-767). GET: whether to show it now, and the member's lock-in hour for its picker.
 * POST { answer: "yes" | "not_now", hour? }: records the answer; "yes" also saves the hour the card showed. The phone's own
 * permission prompt only ever follows a "yes" (the app asks it, src/components/pwa/native-bridge.tsx).
 */
export async function GET() {
  const v = await apiViewer();
  if (!v || v.switchedInto || v.team) return NextResponse.json({ ask: false });
  const { ask } = await askState({ id: v.membership.id, workspaceId: v.workspace.id, userId: v.user.id, role: v.role });
  return NextResponse.json({ ask, hour: v.membership.reminderHour });
}

export async function POST(request: Request) {
  const v = await apiViewer();
  if (!v) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  if (v.switchedInto || v.team) return NextResponse.json({ error: "Only the member answers this." }, { status: 403 });
  const b = (await request.json().catch(() => null)) as { answer?: unknown; hour?: unknown } | null;
  const answer = b?.answer === "yes" || b?.answer === "not_now" ? b.answer : null;
  if (!answer) return NextResponse.json({ error: "answer is yes or not_now" }, { status: 400 });
  await recordAnswer({ id: v.membership.id, workspaceId: v.workspace.id, userId: v.user.id }, answer);
  const hour = typeof b?.hour === "number" && Number.isInteger(b.hour) && b.hour >= 0 && b.hour <= 23 ? b.hour : null;
  if (answer === "yes" && hour !== null) await db.update(schema.memberships).set({ reminderHour: hour }).where(eq(schema.memberships.id, v.membership.id));
  return NextResponse.json({ ok: true });
}
