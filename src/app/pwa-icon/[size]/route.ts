const FILES: Record<string, string> = { "192": "icon-192.png", "512": "icon-512.png" };

/**
 * The old manifest icon addresses (before H-667). A home-screen app installed before the new icon may still ask for these
 * until its browser rereads the manifest, so they send it on to the medallion files in /public/app-icon.
 */
export async function GET(request: Request, { params }: RouteContext<"/pwa-icon/[size]">) {
  const { size } = await params;
  const file = FILES[size];
  if (!file) return new Response("Not found", { status: 404 });
  const maskable = new URL(request.url).searchParams.get("maskable") === "1";
  return Response.redirect(new URL(`/app-icon/${maskable ? file.replace("icon-", "icon-maskable-") : file}`, request.url), 308);
}
