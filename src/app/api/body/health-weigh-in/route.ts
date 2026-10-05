import { allow, clientIp } from "@/lib/rate-limit";
import { ingestHealthPost, keyFor } from "@/lib/body-health";

/**
 * POST /api/body/health-weigh-in with `Authorization: Bearer <the member's Apple Health key>` and the Shortcut's JSON (rev 508
 * §4; src/lib/engine/body-health-ingest.ts has its shape). Answers in plain text the Shortcut can show. Nothing of the post is
 * logged: not the key, not the numbers. A wrong key is counted per address, a right one per key, so a loop can't flood.
 */
const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1] ?? "";
  const found = key ? await keyFor(key) : null;
  if (!found) {
    if (!(await allow(`health-ingest-ip:${await clientIp()}`, 30, 60 * 60 * 1000))) return text(429, "Too many tries. Wait an hour.");
    return text(401, "That key isn't one HelixOS knows, or it was revoked. Make a new one in HumanOS settings → Devices and paste it into the Shortcut.");
  }
  if (!(await allow(`health-ingest:${found.id}`, 24, 60 * 60 * 1000))) return text(429, "More than 24 posts this hour from this key. Wait an hour.");
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return text(400, "The Shortcut's post wasn't JSON. Set Get Contents of URL's Request Body to JSON.");
  }
  const r = await ingestHealthPost(found, body);
  return text(r.status, r.text);
}
