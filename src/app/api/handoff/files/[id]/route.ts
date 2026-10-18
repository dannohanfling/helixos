import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiViewer } from "@/lib/auth";
import { fileSigOk } from "@/lib/handoff";
import { headProofObject, readProofObject } from "@/lib/proof-storage";

/**
 * One Handoff inbox file (rev 769), streamed from the private store with its token: on a link handoff_file signed for 15
 * minutes (for an agent, which has no session), or for the inbox's owner signed in. Anything else, a missing file included,
 * reads the same. Never cached, always a download.
 */
export const dynamic = "force-dynamic";
const plain = (status: number, text: string) => new NextResponse(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const f = await db.query.handoffFiles.findFirst({ where: eq(schema.handoffFiles.id, id) });
  let allowed = !!f && f.status === "ready" && fileSigOk(id, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (!allowed && f && f.status === "ready" && !url.searchParams.has("sig")) {
    const v = await apiViewer();
    // The inbox's owner, any role (H-727), in their own HelixOS: never switched into it, never a team member (apiViewer).
    allowed = !!v && !v.switchedInto && v.workspace.id === f.workspaceId && v.user.id === f.userId;
  }
  if (!f || !allowed) return plain(404, "That file isn't here, or the link has run out. Ask for a new one with handoff_file.");
  const stored = await headProofObject(f.key).catch(() => null);
  if (!stored) return plain(410, "This file is no longer in storage.");
  const upstream = await readProofObject(stored.url, request.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) return plain(502, "That file couldn't be read right now. Try again in a minute.");
  const headers = new Headers({ "content-type": f.contentType, "cache-control": "private, no-store", "content-disposition": `attachment; filename="${f.name.replace(/[^A-Za-z0-9._ -]/g, "_")}"`, "x-content-type-options": "nosniff" });
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(h);
    if (value) headers.set(h, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
