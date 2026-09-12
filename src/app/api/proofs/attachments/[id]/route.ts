import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { readProofObject } from "@/lib/proof-storage";
import { contentDisposition } from "@/lib/engine/proof-attachments";

/**
 * The only way to see a proof attachment: signed in, a member of the attachment's workspace (checked here, in the handler,
 * never in middleware), and the bytes are streamed from the private store with its token. A Range request is passed through
 * so video seeks. Never cached by a CDN: private, no-store. Every read records the bytes served, per workspace and
 * attachment, because a private object is streamed on every view and transfer is the number that bites.
 *
 * ?display=1 serves a HEIC's JPEG rendition; ?download=1 asks the browser to save it under its original name.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v) return new NextResponse("Sign in first.", { status: 401, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  const { id } = await params;
  const att = await db.query.proofAttachments.findFirst({ where: eq(schema.proofAttachments.id, id) });
  if (!att || att.workspaceId !== v.workspace.id) return new NextResponse("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  // The proof bank is per client inside the workspace: the file is the proof owner's to see, and the coach's, and nobody else's.
  const proof = await db.query.proofs.findFirst({ where: eq(schema.proofs.id, att.proofId), columns: { userId: true, workspaceId: true } });
  if (!proof || proof.workspaceId !== v.workspace.id || (proof.userId !== v.user.id && v.role !== "coach")) return new NextResponse("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  const url = new URL(request.url);
  const display = url.searchParams.get("display") === "1" && att.displayKey;
  const objectUrl = display && att.displayUrl ? att.displayUrl : att.blobUrl;
  const upstream = await readProofObject(objectUrl, request.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) {
    console.error("[proof-storage] read failed", JSON.stringify({ attachmentId: att.id, status: upstream.status }));
    const gone = upstream.status === 404;
    return new NextResponse(gone ? "This file is no longer in storage. Delete the attachment and upload it again." : "That file couldn't be read right now. Try again in a minute.", { status: gone ? 410 : 502, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  }
  // Bytes are counted as they are delivered, not as offered: a viewer who stops a video after a megabyte is a megabyte.
  let served = 0;
  const record = () => {
    if (served > 0) db.insert(schema.proofAttachmentReads).values({ id: newId(), workspaceId: att.workspaceId, attachmentId: att.id, bytes: served }).catch((e) => console.error("[proof-storage] could not record bytes served", JSON.stringify({ attachmentId: att.id, message: e instanceof Error ? e.message.slice(0, 300) : String(e) })));
  };
  const counted = upstream.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform: (chunk, ctl) => { served += chunk.byteLength; ctl.enqueue(chunk); }, flush: record })) ?? null;
  const headers = new Headers({ "content-type": display ? "image/jpeg" : att.mime, "cache-control": "private, no-store", "accept-ranges": "bytes", "x-content-type-options": "nosniff" });
  for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(h);
    if (value) headers.set(h, value);
  }
  headers.set("content-disposition", contentDisposition(att.originalFilename, url.searchParams.get("download") === "1"));
  return new NextResponse(counted, { status: upstream.status, headers });
}
