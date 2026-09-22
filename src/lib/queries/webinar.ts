import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { actPresence, buildChecks, type BuildResult, type KnownRefs } from "@/lib/engine/webinar";
import { resolveSections, type WebinarContext } from "@/lib/engine/webinar-context";
import { deckPace, deckSlides } from "@/lib/engine/deck";
import { subjectFor } from "@/lib/queries/subject";

/** Every id that still resolves for the workspace owner: the subject's known set, for callers with no viewer in hand. */
export async function knownFor(userId: string, workspaceId: string): Promise<KnownRefs> {
  return (await subjectFor({ userId, workspaceId, name: "" })).known;
}

/** Who presents this webinar: the presenter field, else the subject's own name. */
export const presenterOf = (w: { presenter: string | null }, subjectName: string): string => w.presenter?.trim() || subjectName;

export type DerivedInput = { proofs: number; stories: number; offer: { linked: boolean; components: number; mapped: number; price: number } };

export async function buildFor(w: schema.Webinar): Promise<{ build: BuildResult; review: schema.ReadinessReview | null; derived: DerivedInput }> {
  const [sections, beliefs, components, review, owner] = await Promise.all([
    db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id), orderBy: asc(schema.webinarSections.order) }),
    db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) }),
    w.offerId ? db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, w.offerId), orderBy: asc(schema.offerComponents.order) }) : Promise.resolve([]),
    db.query.readinessReviews.findFirst({ where: and(eq(schema.readinessReviews.webinarId, w.id)), orderBy: desc(schema.readinessReviews.createdAt) }),
    db.query.users.findFirst({ where: eq(schema.users.id, w.userId), columns: { name: true } }),
  ]);
  const subject = await subjectFor({ userId: w.userId, workspaceId: w.workspaceId, name: owner?.name ?? "" });
  const offer = w.offerId ? subject.offers.find((o) => o.id === w.offerId) : undefined;
  const presence = actPresence(beliefs, subject.known);
  const count = (key: "proofs" | "stories") => 3 - (presence.find((p) => p.key === key)?.missing.length ?? 3);
  const derived: DerivedInput = { proofs: count("proofs"), stories: count("stories"), offer: { linked: Boolean(offer), components: components.length, mapped: components.filter((c) => c.beliefBreak !== "none").length, price: offer?.price ?? 0 } };
  // The deck the export would make, so the twelfth check reads the same slides the Deck step shows.
  const presenter = presenterOf(w, subject.name);
  const context = resolveSections({ webinar: w, presenter, sections, beliefs, proofs: subject.proofs, assets: subject.assets, essenceStories: subject.essenceStories, citable: subject.citable, offer: offer ? { offer, components } : null });
  const deck = deckSlides(context, subject.brandKit);
  return { build: buildChecks({ webinar: w, sections, beliefs, components, known: subject.known, presenter, presenterAliases: subject.brandKit?.aliases ?? [], deck: { refused: deck.refused.length, rate: deckPace(context, deck).rate }, review: review ?? null }), review: review ?? null, derived };
}

/**
 * Everything wired to every section of one webinar, in running order: the run sheet, the deck and the grades read this. Resolved
 * against the webinar's **owner**, never whoever is signed in (22 Sep: the cover said "Danno" on Lindsey's webinar): its proofs,
 * stories, citations and offer are the owner's, and with the Presenter field empty the presenter is the owner's name.
 */
export async function contextFor(w: schema.Webinar): Promise<WebinarContext> {
  const [sections, beliefs, owner] = await Promise.all([
    db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id), orderBy: asc(schema.webinarSections.order) }),
    db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, w.id) }),
    db.query.users.findFirst({ where: eq(schema.users.id, w.userId), columns: { name: true } }),
  ]);
  const subject = await subjectFor({ userId: w.userId, workspaceId: w.workspaceId, name: owner?.name ?? "" });
  const offer = w.offerId ? subject.offers.find((o) => o.id === w.offerId) : undefined;
  const components = offer ? await db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, offer.id), orderBy: asc(schema.offerComponents.order) }) : [];
  // The presenter field, else the subject's own name: never a name from outside the subject.
  return resolveSections({ webinar: w, presenter: presenterOf(w, subject.name), sections, beliefs, proofs: subject.proofs, assets: subject.assets, essenceStories: subject.essenceStories, citable: subject.citable, offer: offer ? { offer, components } : null });
}
