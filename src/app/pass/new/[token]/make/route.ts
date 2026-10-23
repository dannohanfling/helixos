import { NextResponse } from "next/server";
import { makeNewPass } from "@/lib/pass-move";

/**
 * The member's press on their private link (H-1861): make their new pass once and carry their points, then back to the page
 * with the outcome. No session: the link's token is the key. A plain POST, so opening or previewing the link never makes one.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const code = await makeNewPass(token);
  return NextResponse.redirect(new URL(`/pass/new/${encodeURIComponent(token)}?r=${code}`, req.url), 303);
}
