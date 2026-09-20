import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { actPresence, buildChecks, type BuildResult, type KnownRefs } from "@/lib/engine/webinar";
import { resolveSections, type WebinarContext } from "@/lib/engine/webinar-context";
import type { Viewer } from "@/lib/auth";
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
export type DerivedInput = { proofs: number; stories: number; offer: { linked: boolean; components: number; mapped: number; price: number } };

export async function buildFor(w: schema.Webinar): Promise<{ build: BuildResult; review: schema.ReadinessReview | null; derived: DerivedInput }> {
  const [sections, beliefs, components, review, known, offer] = await Promise.all([
    db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id), orderBy: asc(schema.webinarSections.order) }),
    db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) }),
    w.offerId ? db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, w.offerId) }) : Promise.resolve([]),
    db.query.readinessReviews.findFirst({ where: and(eq(schema.readinessReviews.webinarId, w.id)), orderBy: desc(schema.readinessReviews.createdAt) }),
    knownFor(w.userId, w.workspaceId),
    w.offerId ? db.query.offers.findFirst({ where: and(eq(schema.offers.id, w.offerId), eq(schema.offers.userId, w.userId)) }) : Promise.resolve(undefined),
  ]);
  const presence = actPresence(beliefs, known);
  const count = (key: "proofs" | "stories") => 3 - (presence.find((p) => p.key === key)?.missing.length ?? 3);
  const derived: DerivedInput = { proofs: count("proofs"), stories: count("stories"), offer: { linked: Boolean(offer), components: components.length, mapped: components.filter((c) => c.beliefBreak !== "none").length, price: offer?.price ?? 0 } };
  return { build: buildChecks({ webinar: w, sections, beliefs, components, known, review: review ?? null }), review: review ?? null, derived };
}

/** Everything wired to every section of one webinar, in running order: the run sheet, the deck and the grades read this. */
export async function contextFor(v: Viewer, w: schema.Webinar): Promise<WebinarContext> {
  const [sections, beliefs, proofs, assets, citable, essence, offer] = await Promise.all([
    db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id), orderBy: asc(schema.webinarSections.order) }),
    db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) }),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
    assetsFor(v.workspace.id, v.user.id),
    citableEvidence(v.user.id),
    essenceFor(v.workspace.id, v.user.id),
    w.offerId ? db.query.offers.findFirst({ where: and(eq(schema.offers.id, w.offerId), eq(schema.offers.userId, v.user.id)) }) : Promise.resolve(undefined),
  ]);
  const components = offer ? await db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, offer.id), orderBy: asc(schema.offerComponents.order) }) : [];
  const essenceStories = ((essence.representative_stories?.stories as { name: string; summary: string; when_to_use?: string }[] | undefined) ?? []).filter((st) => st.name || st.summary);
  // The presenter is the workspace owner until the presenter field lands (C): the subject's default, never someone else's name.
  return resolveSections({ webinar: w, presenter: v.user.name, sections, beliefs, proofs, assets, essenceStories, citable, offer: offer ? { offer, components } : null });
}
