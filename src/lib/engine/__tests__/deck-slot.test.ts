import { describe, expect, it } from "vitest";
import { pickSlotImage } from "../deck-slot";
import { SLOT_WHAT, type Slot } from "../deck";

const photoSlot: Slot = { key: "s1:photo", kind: "photo", what: SLOT_WHAT.photo };
const testimonial = (proofId?: string): Slot => ({ key: "s1:testimonial", kind: "testimonial", what: SLOT_WHAT.testimonial, proofId });
const img = { url: "u", mime: "image/png", width: 10, height: 8, source: "library" as const };
const proofPhoto = { url: "p", mime: "image/jpeg", width: 20, height: 16, source: "proof" as const };

describe("pickSlotImage: the rule for what a slot shows", () => {
  it("a library slot shows the coach's chosen image, or is quietly empty", () => {
    expect(pickSlotImage(photoSlot, { chosenImage: img }).image?.source).toBe("library");
    expect(pickSlotImage(photoSlot, { chosenImage: null })).toEqual({ image: null, why: null });
  });

  it("a testimonial on a typed quote (no bank proof) stays text, and says so", () => {
    const r = pickSlotImage(testimonial(undefined), {});
    expect(r.image).toBeNull();
    expect(r.why).toMatch(/approved proof from your bank/);
  });

  it("a testimonial shows its approved proof's own photo, never a library image", () => {
    const r = pickSlotImage(testimonial("p1"), { proof: { name: "Kate A.", status: "approved" }, proofPhoto });
    expect(r.image).toEqual({ ...proofPhoto, source: "proof" });
  });

  it("a testimonial whose proof's approval is withdrawn empties, with the reason the Deck step shows", () => {
    const r = pickSlotImage(testimonial("p1"), { proof: { name: "Kate A.", status: "draft" }, proofPhoto });
    expect(r.image).toBeNull();
    expect(r.why).toMatch(/no longer approved/);
  });

  it("an approved proof with no usable photo stays text, and says why", () => {
    const r = pickSlotImage(testimonial("p1"), { proof: { name: "Kate A.", status: "approved" }, proofPhoto: null });
    expect(r.image).toBeNull();
    expect(r.why).toMatch(/no usable photo/);
  });

  it("a testimonial whose proof is gone stays text", () => {
    const r = pickSlotImage(testimonial("p1"), { proof: null });
    expect(r.image).toBeNull();
    expect(r.why).toMatch(/is gone/);
  });
});
