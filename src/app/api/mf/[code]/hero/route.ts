import { allow, clientIp } from "@/lib/rate-limit";
import { isMfCode } from "@/lib/engine/magic-funnel";
import { heroFor } from "@/lib/mf/data";
import { readProofObject } from "@/lib/proof-storage";

/**
 * The hero picture of one Magic funnel page (Magic funnel C): the one picture the page's pitch chose from the member's own
 * Images tagged for that prospect's industry, read from the private store and sent as bytes. The code is the only key (an
 * <img> sends no origin); nothing else of the member's library can be reached here. Rate limited per address, never indexed.
 */
export const dynamic = "force-dynamic";

const nothing = () => new Response(null, { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await allow(`mf:hero:${await clientIp()}`, 120, 60_000))) return new Response(null, { status: 429 });
  if (!isMfCode(code)) return nothing();
  const hero = await heroFor(code);
  if (!hero) return nothing();
  const res = await readProofObject(hero.url);
  if (!res.ok || !res.body) return nothing();
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": hero.mime,
      "cache-control": "private, max-age=600",
      "x-robots-tag": "noindex, nofollow",
      "x-content-type-options": "nosniff",
      // Shown on the member's own GoHighLevel page, another site: the picture may be embedded there.
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
