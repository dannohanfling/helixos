import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { markSeen, visibleRecording } from "@/lib/recordings";
import { isFathomUrl } from "@/lib/engine/recording-members";

/**
 * Watch in Fathom (rev 498): HelixOS can't see playback inside Fathom, so the tap is what marks a recording seen for the member,
 * then they are sent on to the call. Only a recording they may see, only ever to a fathom.video address, and a coach switched
 * into the member marks nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { id } = await params;
  const r = await visibleRecording(v.workspace.id, id, { userId: v.user.id, programTier: v.membership.programTier, role: v.role });
  if (!r) return NextResponse.redirect(new URL("/recordings", request.url), 303);
  const to = r.shareUrl || r.url;
  if (!isFathomUrl(to)) return NextResponse.redirect(new URL(`/recordings/${r.id}`, request.url), 303);
  if (v.role === "client" && !v.switchedInto) await markSeen(v.workspace.id, v.user.id, r.id);
  return NextResponse.redirect(to, 303);
}
