import { handleInbound } from "@/lib/webhooks";

/** POST /api/webhooks/community-loyalty with header `x-helix-secret` (or ?secret=). Events: pass.installed, points.earned. */
export async function POST(request: Request) {
  return handleInbound("community_loyalty", request);
}
