import type { Slot } from "./deck";

/** A picture ready to place on a slide: a private-store URL the render reads back, with the type and size it was stored at. */
export type SlotImage = { url: string; mime: string; width: number; height: number; source: "library" | "proof" };

/**
 * What the resolver has already loaded for one slot: the coach's chosen library image (for a photo, screenshot, diagram, and
 * the like), and, for a testimonial, the bank proof behind it and that proof's first usable photo. The query loads these; the
 * decision below is pure over them, so the rule that a testimonial shows only an approved proof's own photo is testable without
 * a database.
 */
export type SlotInputs = {
  chosenImage?: SlotImage | null;
  proof?: { name: string; status: string } | null;
  proofPhoto?: SlotImage | null;
};

/**
 * The one picture a slot shows, or null and the reason it is empty. A testimonial is special: it never takes a library image,
 * only its own approved proof's photo, and a proof that is not approved (approval withdrawn) empties the slot with a reason the
 * Deck step shows. Every other slot takes the coach's chosen library image, or is quietly empty (the slide exports as text and
 * the count on the Deck step already says how many).
 */
export function pickSlotImage(slot: Slot, inputs: SlotInputs): { image: SlotImage | null; why: string | null } {
  if (slot.kind === "testimonial") {
    if (!slot.proofId) return { image: null, why: "A testimonial shows an approved proof from your bank with a photo; this one is a typed quote, so the slide stays text." };
    if (!inputs.proof) return { image: null, why: "The proof behind this testimonial is gone, so the slide stays text." };
    if (inputs.proof.status !== "approved") return { image: null, why: `“${inputs.proof.name}” is no longer approved, so its photo is off the slide and it exports as text.` };
    if (!inputs.proofPhoto) return { image: null, why: `“${inputs.proof.name}” is approved but carries no usable photo, so the testimonial exports as text.` };
    return { image: { ...inputs.proofPhoto, source: "proof" }, why: null };
  }
  return inputs.chosenImage ? { image: { ...inputs.chosenImage, source: "library" }, why: null } : { image: null, why: null };
}
