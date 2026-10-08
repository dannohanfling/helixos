import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { readProofObject } from "@/lib/proof-storage";

/**
 * The only way to see a deck image: signed in, and the image is the reader's own (workspace and user checked here, in the
 * handler). The bytes stream from the private store with its token; never CDN-cached. A missing image and one that is not the
 * reader's read the same — one sentence, one status — so an id cannot be probed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await apiViewer({ team: "allow" });
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
  const url = new URL(_request.url);
  const headers = new Headers({ "content-type": img.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  // A download asks the browser to save it under a plain name; a graphic may be asked for at 1080 wide (rev 514): the one
  // stored master, downscaled on request with a Lanczos filter, still PNG, never a second file.
  const size = url.searchParams.get("size") === "1080" && img.kind === "graphic" ? 1080 : null;
  const name = `${(img.caption ?? img.kind).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || img.kind}${size ? "-1080x1350" : ""}.${img.mime === "image/png" ? "png" : img.mime === "image/jpeg" ? "jpg" : "img"}`;
  if (url.searchParams.get("download") === "1") headers.set("content-disposition", `attachment; filename="${name}"`);
  if (size) {
    const { downscaleGraphic } = await import("@/lib/graphic-render");
    const small = await downscaleGraphic(Buffer.from(await upstream.arrayBuffer()), size);
    headers.set("content-type", "image/png");
    headers.set("content-length", String(small.length));
    return new NextResponse(new Uint8Array(small), { status: 200, headers });
  }
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  return new NextResponse(upstream.body, { status: 200, headers });
}
