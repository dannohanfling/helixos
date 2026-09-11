import { NextResponse } from "next/server";
import { readPublic } from "@/lib/storage";

/**
 * Public objects only: the read path checks the key's prefix and the recorded flag, both, and answers 404 for anything else,
 * including a well-formed key under the private prefix. A private attachment has no URL here, or anywhere.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const obj = await readPublic(key.join("/"));
  if (!obj) return new NextResponse("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const name = key[key.length - 1].replace(/^[^-]+-/, "");
  return new NextResponse(new Uint8Array(obj.bytes), { status: 200, headers: { "content-type": obj.contentType, "content-length": String(obj.bytes.length), "content-disposition": `inline; filename="${name}"`, "cache-control": "public, max-age=300" } });
}
