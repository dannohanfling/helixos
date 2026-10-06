import { describe, expect, it } from "vitest";
import { schemeMap, slideXmlThemed, themeXmlFor } from "@/lib/deck-theme";
import { masterFor, masterGeometry, slideGeometry } from "../deck";

const kit = { ground: "FAF8F5", ink: "6E6256", accent: "DD2727", muted: "4B5563", surface: "ECE9E5", inverseGround: "6E6256", inverseInk: "FAF8F5", placeholder: "FFF3A3", displayFont: "Red Hat Display", bodyFont: "Helvetica Now Display" };

describe("§6.6: the kit as the file's theme", () => {
  it("maps the kit's colours to scheme slots, first role winning a shared hex, and fills the slots a kit leaves empty", () => {
    const { slots, byHex } = schemeMap(kit);
    expect(slots).toEqual({ dk1: "6E6256", lt1: "FAF8F5", dk2: "4B5563", lt2: "ECE9E5", accent1: "DD2727", accent2: "6E6256", accent3: "FAF8F5", accent4: "FFF3A3" });
    expect(byHex.get("6E6256")).toBe("dk1"); // ink before inverseGround
    expect(byHex.get("FAF8F5")).toBe("lt1");
    const bare = schemeMap({ ...kit, inverseGround: null, inverseInk: null, placeholder: null });
    expect(bare.slots.accent2).toBe("DD2727");
    expect(bare.slots.accent3).toBe("6E6256");
    expect(bare.slots.accent4).toBe("ECE9E5");
    expect(schemeMap({ ...kit, accent: "D92D20" }).byHex.has("D92D20")).toBe(false); // the fixed placeholder red is never a theme colour
  });

  it("writes the scheme and the faces into the theme XML", () => {
    const theme = '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>';
    const out = themeXmlFor(theme, kit);
    expect(out).toContain('<a:dk1><a:srgbClr val="6E6256"/></a:dk1>');
    expect(out).toContain('<a:accent1><a:srgbClr val="DD2727"/></a:accent1>');
    expect(out).toContain('<a:majorFont><a:latin typeface="Red Hat Display"/>');
    expect(out).toContain('<a:minorFont><a:latin typeface="Helvetica Now Display"/>');
  });

  it("turns a slide's literal colours and faces into the theme's, and leaves the placeholder red alone", () => {
    const xml = '<a:ln><a:solidFill><a:srgbClr val="DD2727"/></a:solidFill></a:ln><a:rPr><a:solidFill><a:srgbClr val="6E6256"/></a:solidFill><a:latin typeface="Red Hat Display" pitchFamily="34"/></a:rPr><a:srgbClr val="D92D20"/><a:latin typeface="Helvetica Now Display"/>';
    const out = slideXmlThemed(xml, kit);
    expect(out).toContain('<a:schemeClr val="accent1"/>');
    expect(out).toContain('<a:schemeClr val="dk1"/>');
    expect(out).toContain('<a:latin typeface="+mj-lt" pitchFamily="34"/>');
    expect(out).toContain('<a:latin typeface="+mn-lt"/>');
    expect(out).toContain('<a:srgbClr val="D92D20"/>');
    expect(out).not.toContain("DD2727");
  });

  it("each plan sits on the layout of its family, and the layouts' placeholders are where slideGeometry puts the boxes", () => {
    const box = (role: "cover-title" | "headline" | "body") => ({ slide: 1, role, text: "x", size: 20, color: "111111", fill: null, face: "Arial", bold: false, italic: false, bullet: false, placeholder: false });
    expect(masterFor({ boxes: [box("cover-title")], layout: "cover", imageFrame: null, placeholderSlot: null, pictureOnly: false })).toBe("COVER");
    expect(masterFor({ boxes: [box("cover-title")], layout: "cover", imageFrame: { x: 5.2, y: 0.9, w: 4.3, h: 3.85 }, placeholderSlot: null, pictureOnly: false })).toBe("COVER_PICTURE");
    expect(masterFor({ boxes: [box("headline"), box("body")], layout: "content", imageFrame: null, placeholderSlot: { frame: { x: 5.35, y: 1.05, w: 4.15, h: 3.5 }, text: "", color: "D92D20" }, pictureOnly: false })).toBe("CONTENT_PICTURE");
    expect(masterFor({ boxes: [box("headline")], layout: "statement", imageFrame: null, placeholderSlot: null, pictureOnly: false })).toBe("STATEMENT");
    expect(masterFor({ boxes: [], layout: "content", imageFrame: { x: 1.5, y: 0.6, w: 7, h: 4.4 }, placeholderSlot: null, pictureOnly: true })).toBe("PICTURE_ONLY");
    const plan = { boxes: [box("headline"), box("body")], layout: "content" as const, imageFrame: { x: 5.35, y: 1.05, w: 4.15, h: 3.5 }, placeholderSlot: null, pictureOnly: false };
    expect(masterGeometry("CONTENT_PICTURE").boxes.headline).toEqual(slideGeometry(plan).boxes.headline);
    expect(masterGeometry("CONTENT_PICTURE").body).toEqual(slideGeometry(plan).body);
    expect(masterGeometry("COVER").boxes["cover-title"]).toEqual({ x: 0.5, y: 1.35, w: 9, h: 1.6, align: "center", valign: "middle" });
  });
});
