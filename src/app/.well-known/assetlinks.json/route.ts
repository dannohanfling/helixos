import { androidAssetLinks } from "@/lib/engine/app-links";

/** App links for the Android app (H-877): Android checks this to open HelixOS addresses in the app without asking. */
export function GET() {
  const body = androidAssetLinks(process.env.HELIXOS_ANDROID_CERT_SHA256);
  if (!body) return new Response("Not found", { status: 404 });
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
