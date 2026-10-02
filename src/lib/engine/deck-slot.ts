import type { DeckImageKind } from "@/db/schema";
import type { Slot } from "./deck";

/** A picture ready to place on a slide: a private-store URL the render reads back, with the type, size and kind it was stored as. The kind decides its fit (a photo covers its frame; a screenshot, proof, logo, graphic or diagram is contained whole). */
export type SlotImage = { url: string; mime: string; width: number; height: number; source: "library" | "proof"; kind: DeckImageKind | "proof"; /** The coach's caption, the picture's alt text in the file (§6.8). */ caption?: string | null; /** The library row, so the Deck step's thumbnail can show the picture through the app's own route (§6.4). */ id?: string };

/** The kind an upload straight into a slot starts as (§6.2): what the slot asks for, which the coach may still change. */
export function slotDefaultKind(kind: Slot["kind"]): DeckImageKind {
  if (kind === "screenshot" || kind === "screenshot_callout") return "screenshot";
  if (kind === "proof_wall") return "proof";
  if (kind === "diagram") return "diagram";
  return "photo";
}

/** A picture's alt text in the file (§6.8): the coach's caption, else the slot's own instruction; never a file name. */
export const pictureAltText = (caption: string | null | undefined, what: string): string => caption?.trim() || what;

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
 * Deck step shows. Every other slot takes the coach's chosen library image, or is quietly empty (the slide exports with a red
 * placeholder in the picture's frame, §2, and the count on the Deck step says how many).
 */
export function pickSlotImage(slot: Slot, inputs: SlotInputs): { image: SlotImage | null; why: string | null } {
  if (slot.kind === "testimonial") {
    if (!slot.proofId) return { image: null, why: "A testimonial shows an approved proof from your bank with a photo; this one is a typed quote, so its frame shows a red placeholder." };
    if (!inputs.proof) return { image: null, why: "The proof behind this testimonial is gone, so its frame shows a red placeholder." };
    if (inputs.proof.status !== "approved") return { image: null, why: `“${inputs.proof.name}” is no longer approved, so its photo is off the slide and its frame shows a red placeholder.` };
    if (!inputs.proofPhoto) return { image: null, why: `“${inputs.proof.name}” is approved but carries no usable photo, so its frame shows a red placeholder.` };
    return { image: { ...inputs.proofPhoto, source: "proof" }, why: null };
  }
  return inputs.chosenImage ? { image: { ...inputs.chosenImage, source: "library" }, why: null } : { image: null, why: null };
}
