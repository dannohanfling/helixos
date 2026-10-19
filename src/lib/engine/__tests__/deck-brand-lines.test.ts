import { describe, expect, it } from "vitest";
import { COVER_LOGO_BOX, COVER_LOGO_BOX_WITH_DESCRIPTOR, DESCRIPTOR_MAX, cleanDescriptor, coverDescriptor, coverLogoBoxFor, deckCompany, descriptorFrame, footerBrandLine, logoBadgeFrame, slideGeometry, slotFrame, type Frame, type TextBox } from "../deck";

/** H-811: the kit's legal name on the footer bar and as the file's company, and the descriptor line under the cover logo. */
const box = (role: TextBox["role"]): TextBox => ({ slide: 1, role, text: "x", size: 20, color: "111111", fill: null, face: "Arial", bold: false, italic: false, bullet: false, placeholder: false });
const coverTitleTop = (picture: boolean) => {
  const g = slideGeometry({ boxes: [box("cover-title"), box("cover-presenter")], layout: "content", imageFrame: picture ? slotFrame("cover") : null, placeholderSlot: null, pictureOnly: false });
  return g.boxes["cover-title"]!.y;
};
const overlaps = (a: Frame, b: Frame) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("the footer bar's brand line and the file's company (H-811)", () => {
  it("the legal name stands in for the kit's name; the webinar's own line still wins; nothing set leaves it to the owner", () => {
    expect(footerBrandLine({ webinar: null, legalName: "Rooted Rest Ltd", kitName: "Rooted Rest" })).toBe("Rooted Rest Ltd");
    expect(footerBrandLine({ webinar: "", legalName: "  ", kitName: "Rooted Rest" })).toBe("Rooted Rest");
    expect(footerBrandLine({ webinar: "Spring Intensive", legalName: "Rooted Rest Ltd", kitName: "Rooted Rest" })).toBe("Spring Intensive");
    // A kit that isn't applied gives no name: the route falls back to the owner's business name, as before.
    expect(footerBrandLine({ webinar: null, legalName: null, kitName: null })).toBeNull();
    expect(footerBrandLine({ webinar: null, legalName: "Rooted Rest Ltd", kitName: null })).toBe("Rooted Rest Ltd");
  });
  it("the file's company is the legal name when set, else the workspace's name", () => {
    expect(deckCompany("Rooted Rest Ltd", "Evolve Omega")).toBe("Rooted Rest Ltd");
    expect(deckCompany(null, "Evolve Omega")).toBe("Evolve Omega");
    expect(deckCompany("   ", "Evolve Omega")).toBe("Evolve Omega");
  });
});

describe("the descriptor under the cover logo (H-811)", () => {
  it("draws only when set and not held blank, as one line of at most DESCRIPTOR_MAX characters", () => {
    expect(coverDescriptor({ descriptor: "Sleep coaching for new parents", descriptorHidden: false })).toBe("Sleep coaching for new parents");
    expect(coverDescriptor({ descriptor: "Sleep coaching for new parents", descriptorHidden: true })).toBeNull();
    expect(coverDescriptor({ descriptor: "   ", descriptorHidden: false })).toBeNull();
    expect(coverDescriptor({ descriptor: null })).toBeNull();
    expect(coverDescriptor(null)).toBeNull();
    expect(cleanDescriptor("  Sleep\n coaching   for\tparents ")).toBe("Sleep coaching for parents");
    expect(cleanDescriptor("y".repeat(DESCRIPTOR_MAX + 20))).toHaveLength(DESCRIPTOR_MAX);
  });
  it("the logo keeps its full box without a descriptor, and a shorter one with it", () => {
    expect(coverLogoBoxFor(null)).toEqual(COVER_LOGO_BOX);
    expect(coverLogoBoxFor("Sleep coaching")).toEqual(COVER_LOGO_BOX_WITH_DESCRIPTOR);
    expect(COVER_LOGO_BOX_WITH_DESCRIPTOR.h).toBeLessThan(COVER_LOGO_BOX.h);
    expect(COVER_LOGO_BOX_WITH_DESCRIPTOR.w).toBe(COVER_LOGO_BOX.w);
  });
  it("sits under the drawn logo, its badge and the placeholder, and always ends above the cover title and clear of the picture", () => {
    const B = COVER_LOGO_BOX_WITH_DESCRIPTOR;
    // A square logo fills the box's height; a wide wordmark is short and centred in it; and no logo at all.
    const tall: Frame = { x: B.x, y: B.y, w: B.h, h: B.h };
    const wide: Frame = { x: B.x, y: B.y + 0.2, w: B.w, h: 0.25 };
    for (const [logo, badge] of [[tall, false], [tall, true], [wide, false], [wide, true], [null, false]] as const) {
      const d = descriptorFrame(logo, badge);
      expect(d.x).toBe(B.x);
      const under = logo ? (badge ? logoBadgeFrame(logo) : logo) : B;
      expect(d.y).toBeGreaterThanOrEqual(under.y + under.h - 1e-9);
      expect(d.y + d.h).toBeLessThanOrEqual(Math.min(coverTitleTop(false), coverTitleTop(true)));
      expect(overlaps(d, slotFrame("cover"))).toBe(false);
      expect(d.x + d.w).toBeLessThanOrEqual(10);
    }
    // Tight under a short wordmark rather than at the box's foot.
    expect(descriptorFrame(wide, false).y).toBeCloseTo(wide.y + wide.h + 0.05);
  });
});
