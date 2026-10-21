import { appleAssociation } from "@/lib/engine/app-links";

/** Universal links for the iPhone app (H-877): Apple fetches this to let HelixOS addresses open in the app. */
export function GET() {
  const body = appleAssociation(process.env.HELIXOS_APPLE_TEAM_ID);
  if (!body) return new Response("Not found", { status: 404 });
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
