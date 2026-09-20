import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildChecks, type BuildResult, type KnownRefs } from "@/lib/engine/webinar";
import { assetsFor } from "@/lib/queries/library";
import { citableEvidence } from "@/lib/queries/evidence";
import { essenceFor } from "@/lib/queries/essence";

/**
 * The ids a belief may point at and still count: approved proofs, story assets in scope plus the Essence's own stories (the
 * picker's "essence:<n>" values, indexed the way the picker indexes them), and citable studies ("shared:<id>" for the shelf).
 */
export async function knownFor(userId: string, workspaceId: string): Promise<KnownRefs> {
  const [proofs, stories, citable, essence] = await Promise.all([
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, userId), eq(schema.proofs.status, "approved")), columns: { id: true } }),
    assetsFor(workspaceId, userId, "story"),
    citableEvidence(userId),
    essenceFor(workspaceId, userId),
  ]);
  const own = ((essence.representative_stories?.stories as { name?: string; summary?: string }[] | undefined) ?? []).filter((st) => st.name || st.summary);
  return {
    proofIds: proofs.map((p) => p.id),
    storyIds: [...stories.map((s) => s.id), ...own.map((_, i) => `essence:${i}`)],
    evidenceIds: citable.map((e) => (e.source === "shared" ? `shared:${e.id}` : e.id)),
  };
}

/** The build check for one webinar, read off the record: sections, beliefs, the linked offer's stack, what is still wired, and the latest review. */
export async function buildFor(w: schema.Webinar): Promise<{ build: BuildResult; review: schema.ReadinessReview | null }> {
  const [sections, beliefs, components, review, known] = await Promise.all([
    db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id), orderBy: asc(schema.webinarSections.order) }),
    db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) }),
    w.offerId ? db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, w.offerId) }) : Promise.resolve([]),
    db.query.readinessReviews.findFirst({ where: and(eq(schema.readinessReviews.webinarId, w.id)), orderBy: desc(schema.readinessReviews.createdAt) }),
    knownFor(w.userId, w.workspaceId),
  ]);
  return { build: buildChecks({ webinar: w, sections, beliefs, components, known, review: review ?? null }), review: review ?? null };
}
