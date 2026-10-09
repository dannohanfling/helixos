import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { readProofObject } from "@/lib/proof-storage";

/** A headshot waiting in the coach's review list (client headshots): the coach of that workspace only, the 512 square, private. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notHere = () => new NextResponse("No photo here.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  const v = await apiViewer();
  if (!v || v.role !== "coach" || v.switchedInto) return notHere();
  const { id } = await params;
  const r = await db.query.headshotReviews.findFirst({ where: and(eq(schema.headshotReviews.id, id), eq(schema.headshotReviews.workspaceId, v.workspace.id)), columns: { displayUrl: true } });
  if (!r?.displayUrl) return notHere();
  const upstream = await readProofObject(r.displayUrl);
  if (!upstream.ok) return notHere();
  return new NextResponse(upstream.body, { status: 200, headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
