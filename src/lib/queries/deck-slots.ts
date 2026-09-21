import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DeckResult, Slot } from "@/lib/engine/deck";
import { pickSlotImage, type SlotImage } from "@/lib/engine/deck-slot";

/**
 * A picture on a slide, resolved from the record: a library image the coach attached to the slot, or, for a testimonial slot,
 * the approved proof's own photo. `url` is a private-store URL the render reads back with the proof token. Nothing here is
 * generated or fetched from the web; every image is the coach's own upload or an attachment on their approved proof.
 */
export type ResolvedSlot = {
  slide: number;
  section: string;
  slot: Slot;
  image: SlotImage | null;
  /** When the slot is empty for a reason worth naming on the Deck step (an approval withdrawn, a testimonial with no photo). */
  why: string | null;
};

/**
 * Every suggested slot for a webinar's deck, each resolved to its picture or to why it is empty. The coach's library choices
 * come from deck_slots (their own images only); a testimonial resolves to its bank proof's first image attachment, and only
 * while that proof is still approved — a withdrawn approval empties the slot and the reason says so. An empty slot is never a
 * box on a face: the render draws the slide as text and the Deck step lists what fell back.
 */
export async function resolveDeckSlots(webinarId: string, deck: DeckResult, owner: { workspaceId: string; userId: string }): Promise<ResolvedSlot[]> {
  const suggested = deck.slides.filter((s) => s.slot).map((s) => ({ slide: s.n, section: s.section || s.eyebrow || "cover", slot: s.slot! }));
  if (!suggested.length) return [];

  // The coach's choices for this webinar, keyed by slot, and the images they point at — the coach's own images only.
  const slotRows = await db.query.deckSlots.findMany({ where: eq(schema.deckSlots.webinarId, webinarId) });
  const chosen = new Map(slotRows.filter((r) => r.imageId).map((r) => [r.slotKey, r.imageId!]));
  const imageIds = [...new Set(chosen.values())];
  const images = imageIds.length ? await db.query.deckImages.findMany({ where: and(inArray(schema.deckImages.id, imageIds), eq(schema.deckImages.workspaceId, owner.workspaceId), eq(schema.deckImages.userId, owner.userId)) }) : [];
  const imageById = new Map(images.map((i) => [i.id, i]));

  // The proofs behind the testimonial slots, and their image attachments, in two reads.
  const proofIds = [...new Set(suggested.map((x) => x.slot.proofId).filter((v): v is string => Boolean(v)))];
  const proofs = proofIds.length ? await db.query.proofs.findMany({ where: and(inArray(schema.proofs.id, proofIds), eq(schema.proofs.workspaceId, owner.workspaceId), eq(schema.proofs.userId, owner.userId)) }) : [];
  const proofById = new Map(proofs.map((p) => [p.id, p]));
  const atts = proofIds.length ? await db.query.proofAttachments.findMany({ where: and(inArray(schema.proofAttachments.proofId, proofIds), eq(schema.proofAttachments.workspaceId, owner.workspaceId)), orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.createdAt)] }) : [];

  return suggested.map(({ slide, section, slot }) => {
    const id = chosen.get(slot.key);
    const img = id ? imageById.get(id) : undefined;
    const proof = slot.proofId ? proofById.get(slot.proofId) : undefined;
    const photo = proof ? atts.find((a) => a.proofId === proof.id && a.kind === "image" && (!a.showsAPerson || a.consentRecordedAt)) : undefined;
    const { image, why } = pickSlotImage(slot, {
      chosenImage: img ? { url: img.blobUrl, mime: img.mime, width: img.width, height: img.height, source: "library" } : null,
      proof: proof ? { name: proof.name, status: proof.status } : (slot.proofId ? null : undefined),
      proofPhoto: photo ? { url: photo.displayUrl ?? photo.blobUrl, mime: "image/jpeg", width: photo.width ?? 0, height: photo.height ?? 0, source: "proof" } : null,
    });
    return { slide, section, slot, image, why };
  });
}

/** The slides that have a picture, for the render to narrow their text and place the image. */
export const filledSlides = (resolved: ResolvedSlot[]): Set<number> => new Set(resolved.filter((r) => r.image).map((r) => r.slide));

/** What the Deck step tells the coach fell back: the count of empty slots, and the ones with a reason worth a sentence. */
export function slotFallbacks(resolved: ResolvedSlot[]): { emptyCount: number; reasons: { slide: number; section: string; why: string }[] } {
  const empty = resolved.filter((r) => !r.image);
  return { emptyCount: empty.length, reasons: empty.filter((r) => r.why).map((r) => ({ slide: r.slide, section: r.section, why: r.why! })) };
}
