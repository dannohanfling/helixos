import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { utcDay } from "@/lib/engine/evidence";
import { hitSource, primaryTarget } from "@/lib/engine/lead-magnet";
import { publicUrlFor } from "@/lib/engine/storage-policy";
import { newId } from "@/lib/ids";

/**
 * The tracked link: /g/<slug>?src=chatbot counts one hit for the magnet under a source from a closed list, then sends the
 * reader on to the format the client nominated. Public, no session. Nothing about the reader is read or kept: the count is
 * how many, per source, per day. Who came is Community Loyalty's answer, on the business page, never this link's.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(request.url);
  const m = await db.query.leadMagnets.findFirst({ where: eq(schema.leadMagnets.slug, slug) });
  const target = m ? primaryTarget(m, publicUrlFor) : null;
  if (!m || !target) return new NextResponse("Nothing here yet.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  await db.insert(schema.leadMagnetHits).values({ id: newId(), magnetId: m.id, src: hitSource(url.searchParams.get("src")), day: utcDay() });
  return NextResponse.redirect(new URL(target, request.url), 302);
}
