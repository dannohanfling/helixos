import { NextResponse } from "next/server";
import { publicUrl } from "@/lib/storage";

/**
 * The app's stable address for a public object: it resolves to the bucket's CDN URL and sends the reader there. Public
 * objects only: the key's prefix and the recorded flag are both checked, and anything else is 404, including a well-formed
 * key under the private prefix. A private attachment has no URL here, or anywhere.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const url = await publicUrl(key.join("/"));
  if (!url) return new NextResponse("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "public, max-age=300" } });
}
