import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { readProofObject } from "@/lib/proof-storage";

/**
 * The only way to see a deck image: signed in, and the image is the reader's own (workspace and user checked here, in the
 * handler). The bytes stream from the private store with its token; never CDN-cached. A missing image and one that is not the
 * reader's read the same — one sentence, one status — so an id cannot be probed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v) return new NextResponse("Sign in first.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  const { id } = await params;
  const img = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, id), eq(schema.deckImages.workspaceId, v.workspace.id), eq(schema.deckImages.userId, v.user.id)) });
  const notYours = () => new NextResponse("That image isn't yours, or it doesn't exist.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  if (!img) return notYours();
  const upstream = await readProofObject(img.blobUrl);
  if (!upstream.ok) {
    console.error("[deck-image] read failed", JSON.stringify({ imageId: img.id, status: upstream.status }));
    const gone = upstream.status === 404;
    return new NextResponse(gone ? "This image is no longer in storage. Delete it and upload again." : "That image couldn't be read right now. Try again in a minute.", { status: gone ? 410 : 502, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  }
  const headers = new Headers({ "content-type": img.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new NextResponse(upstream.body, { status: 200, headers });
}
