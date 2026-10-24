import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { readProofObject } from "@/lib/proof-storage";
import { NOT_YOURS, contentDisposition } from "@/lib/engine/proof-attachments";

const text = (body: string, status: number) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * Reel to Post, PR B: the only way to see a member's reel video. Signed in, the video's own member or their coach in the same
 * workspace (checked here, never in middleware), streamed from the private store with its token. A Range request is passed
 * through so the player seeks. Never cached by a CDN.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await apiViewer();
  if (!v) return text("Sign in first.", 401);
  const { id } = await params;
  const video = await db.query.mediaVideos.findFirst({ where: eq(schema.mediaVideos.id, id) });
  if (!video || video.workspaceId !== v.workspace.id || (video.userId !== v.user.id && v.role !== "coach")) return text(NOT_YOURS, 404);
  const upstream = await readProofObject(video.blobUrl, request.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) {
    console.error("[reel-videos] read failed", JSON.stringify({ videoId: video.id, status: upstream.status }));
    return upstream.status === 404 ? text("This video is no longer in storage. Remove it from the post and attach it again.", 410) : text("That video couldn't be read right now. Try again in a minute.", 502);
  }
  const headers = new Headers({ "content-type": video.mime, "cache-control": "private, no-store", "accept-ranges": "bytes", "x-content-type-options": "nosniff" });
  for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(h);
    if (value) headers.set(h, value);
  }
  headers.set("content-disposition", contentDisposition(video.originalFilename, new URL(request.url).searchParams.get("download") === "1"));
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
