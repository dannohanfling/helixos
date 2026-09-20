import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildChecks, type BuildResult } from "@/lib/engine/webinar";

/** The build check for one webinar, read off the record: sections, beliefs, the linked offer's stack and the latest review. */
export async function buildFor(w: schema.Webinar): Promise<{ build: BuildResult; review: schema.ReadinessReview | null }> {
  const [sections, beliefs, components, review, approved] = await Promise.all([
    db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id), orderBy: asc(schema.webinarSections.order) }),
    db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) }),
    w.offerId ? db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, w.offerId) }) : Promise.resolve([]),
    db.query.readinessReviews.findFirst({ where: and(eq(schema.readinessReviews.webinarId, w.id)), orderBy: desc(schema.readinessReviews.createdAt) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, w.userId), eq(schema.proofs.status, "approved")), columns: { id: true } }),
  ]);
  return { build: buildChecks({ webinar: w, sections, beliefs, components, approvedProofIds: approved.map((p) => p.id), review: review ?? null }), review: review ?? null };
}
