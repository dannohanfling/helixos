import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { knownReferences } from "@/lib/engine/subject";
import type { KnownRefs } from "@/lib/engine/webinar";
import { assetsFor } from "@/lib/queries/library";
import { citableEvidence, type Citable } from "@/lib/queries/evidence";
import { essenceFor } from "@/lib/queries/essence";

export type EssenceStory = { name: string; summary: string; when_to_use?: string };
export type Subject = {
  kind: "workspace";
  ref: null;
  /** The subject's own name: the presenter's default, the deck's author, the script's first person. */
  name: string;
  essenceStories: EssenceStory[];
  proofs: schema.Proof[];
  assets: schema.LibraryAsset[];
  citable: Citable[];
  offers: schema.Offer[];
  brandKit: schema.BrandKit | null;
  /** Every id that still resolves for this subject: the one set every check reads. */
  known: KnownRefs;
};

/**
 * Everything generated content resolves against, for one subject. The workspace owner is the default and, today, the only
 * subject; a later toggle passes a client record's reference here instead. Nothing reads Essence, proofs, stories, offers,
 * evidence or the brand kit for generated content except through this.
 */
export async function subjectFor(who: { userId: string; workspaceId: string; name: string }): Promise<Subject> {
  const { userId, workspaceId } = who;
  const [essence, proofs, assets, citable, offers, brandKit] = await Promise.all([
    essenceFor(workspaceId, userId),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, userId), eq(schema.proofs.status, "approved")) }),
    assetsFor(workspaceId, userId),
    citableEvidence(userId),
    db.query.offers.findMany({ where: eq(schema.offers.userId, userId) }),
    db.query.brandKits.findFirst({ where: eq(schema.brandKits.workspaceId, workspaceId) }),
  ]);
  const essenceStories = ((essence.representative_stories?.stories as EssenceStory[] | undefined) ?? []).filter((st) => st.name || st.summary);
  return {
    kind: "workspace",
    ref: null,
    name: who.name,
    essenceStories,
    proofs,
    assets,
    citable,
    offers,
    brandKit: brandKit ?? null,
    known: knownReferences({ proofs, stories: assets.filter((a) => a.type === "story"), essenceStories, citable, offers }),
  };
}
