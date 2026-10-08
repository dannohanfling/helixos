import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { isGraphicToken } from "@/lib/engine/ship";
import { readProofObject } from "@/lib/proof-storage";

/**
 * A shipped ladder graphic at its public address (Ship, rev 583 #1): the one place a member's picture is reachable with no
 * session, because the Social Planner fetches it from here to post it. The address is an unguessable token minted at Ship,
 * carries no workspace, member or record id, and goes dead the moment the member revokes it on the ladder page. A token that
 * is not live, not a token at all, or whose graphic is gone reads the same: one sentence, one status. The bytes are the
 * stored master, read from the private store here and never linked directly.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.png$/i, "");
  const gone = () => new NextResponse("No graphic here.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=60" } });
  if (!isGraphicToken(token)) return gone();
  const ladder = await db.query.ladders.findFirst({ where: and(eq(schema.ladders.graphicPublicToken, token), isNotNull(schema.ladders.graphicImageId)), columns: { graphicImageId: true, workspaceId: true, userId: true } });
  if (!ladder?.graphicImageId) return gone();
  const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, ladder.graphicImageId), eq(schema.deckImages.workspaceId, ladder.workspaceId), eq(schema.deckImages.userId, ladder.userId)) });
  if (!img) return gone();
  const upstream = await readProofObject(img.blobUrl);
  if (!upstream.ok) return gone();
  const headers = new Headers({ "content-type": img.mime, "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new NextResponse(upstream.body, { status: 200, headers });
}
