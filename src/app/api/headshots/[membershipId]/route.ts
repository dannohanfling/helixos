import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { readProofObject } from "@/lib/proof-storage";

/**
 * A member's profile photo (client headshots, Danno 8 Oct): the 512 square by default, ?size=original for the original. Only
 * the member themself, or a coach of the same workspace (not while switched into another client), may read it. A missing
 * photo, another member's and a membership that does not exist all read the same: one sentence, one status. Private, never
 * cached by a CDN, never a public address; a profile photo is not consent to publish it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const notHere = () => new NextResponse("No photo here.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  const v = await apiViewer();
  if (!v) return new NextResponse("Sign in first.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  const { membershipId } = await params;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, membershipId), eq(schema.memberships.workspaceId, v.workspace.id)), columns: { userId: true, headshotUrl: true, headshotDisplayUrl: true, headshotMime: true } });
  const allowed = m && (m.userId === v.user.id || (v.role === "coach" && !v.switchedInto));
  if (!m || !allowed) return notHere();
  const original = new URL(request.url).searchParams.get("size") === "original";
  const url = original ? m.headshotUrl : m.headshotDisplayUrl;
  if (!url) return notHere();
  const upstream = await readProofObject(url);
  if (!upstream.ok) return notHere();
  const headers = new Headers({ "content-type": original ? (m.headshotMime ?? "image/jpeg") : "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new NextResponse(upstream.body, { status: 200, headers });
}
