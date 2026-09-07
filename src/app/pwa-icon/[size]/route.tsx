import { brandIcon } from "@/lib/brand-icon";

const SIZES = new Set([192, 512]);

/** Manifest icons at a stable URL (/pwa-icon/192, /pwa-icon/512); `?maskable=1` keeps the mark in the safe zone. */
export async function GET(request: Request, { params }: RouteContext<"/pwa-icon/[size]">) {
  const { size } = await params;
  const n = Number(size);
  if (!SIZES.has(n)) return new Response("Not found", { status: 404 });
  const maskable = new URL(request.url).searchParams.get("maskable") === "1";
  const res = brandIcon(n, { maskable });
  res.headers.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
  return res;
}
