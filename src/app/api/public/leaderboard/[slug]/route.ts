import { servedFeed } from "@/lib/leaderboard";

/**
 * A client's loyalty-pass leaderboard feed (rev 639): no session, any page may read it (the client's own landing page reads it
 * from its data-feed attribute). First names and initials, points and tiers only. Nothing to serve answers 503, and the page
 * falls back to its pasted copy by itself.
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" };

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const feed = /^[a-z0-9-]{3,60}$/.test(slug) ? await servedFeed(slug) : null;
  if (!feed) return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });
  return new Response(JSON.stringify(feed), { status: 200, headers: { ...CORS, "content-type": "application/json", "cache-control": "public, max-age=60" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
