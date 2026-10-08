import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SlideChoice, SlideLayout } from "@/lib/engine/deck";

/** The coach's choices on a webinar's slides (deck layouts 10), keyed by the slide's stable key: what renderPlan reads. */
export async function slideChoicesFor(webinarId: string): Promise<Map<string, SlideChoice>> {
  const rows = await db.query.deckSlideChoices.findMany({ where: eq(schema.deckSlideChoices.webinarId, webinarId) });
  return new Map(rows.map((r) => [r.slideKey, { layout: (r.layout as SlideLayout | null) ?? null, accentPhrase: r.accentPhrase, accentOff: r.accentOff }]));
}
