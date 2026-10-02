import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import type PptxGenJS from "pptxgenjs";
import { PLACEHOLDER_TEXT_SIZE, TEXT_LEFT_ZONE, deckSlides, outlineText, renderPlan, slotFrame, type Frame, type PlaceholderSlot, type SlidePlan } from "@/lib/engine/deck";
import { dedupeDeckMedia, prepareDeckImage, type PreparedImage } from "@/lib/deck-media";
import { placeImage } from "@/lib/engine/deck-fit";
import { contextFor } from "@/lib/queries/webinar";
import { filledSlides, resolveDeckSlots } from "@/lib/queries/deck-slots";
import { readProofObject } from "@/lib/proof-storage";
import { sameItems, sectionGate } from "@/lib/engine/provenance";
import { confirmFor } from "@/lib/provenance";

export const dynamic = "force-dynamic";

/** The private object's bytes, or null when they can't be read (the slide then shows the slot's red placeholder). */
async function readBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await readProofObject(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
/** The footer bar's logo box, right of the band; and the cover's, top left (§4). */
const LOGO_BOX = { x: 9.0, y: 5.35, w: 0.9, h: 0.24 };
const COVER_LOGO_BOX = { x: 0.5, y: 0.35, w: 1.8, h: 0.55 };

/**
 * GET /api/webinars/{id}/deck?format=pptx|txt
 * The deck as the resolver finds it, in the workspace's brand kit: a .pptx with one slide per idea, the coach's own pictures
 * cropped into their frames where a slot is filled and the text laid out around them, and the plain text where a slot is empty.
 * The same `deckSlides` the Deck step reads decides whether the file can go: a refusal is a 409 with the reasons. The member owns
 * the webinar or gets a 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { id } = await params;
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.userId, v.user.id)) });
  if (!w) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [context, kit] = await Promise.all([contextFor(w), db.query.brandKits.findFirst({ where: eq(schema.brandKits.workspaceId, w.workspaceId) })]);
  const deck = deckSlides(context, kit ?? null);
  if (deck.refused.length) return NextResponse.json({ error: "not exported", refused: deck.refused }, { status: 409 });
  // The provenance gate, on the export: a webinar carrying AI-drafted sections nobody reviewed leaves only under a confirm the
  // Deck step logged for this user and this webinar (Continue anyway), naming exactly these drafts. The step shows the same line.
  const url = new URL(request.url);
  const gate = sectionGate(await db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, w.id) }));
  const confirm = gate ? await confirmFor(url.searchParams.get("confirmed"), v.user.id, "deck_export", w.id) : null;
  // A confirm covers the drafts it named and no others: one made before a later draft does not carry that draft out.
  if (gate && !(confirm && sameItems(confirm.items, gate.items))) return NextResponse.json({ error: "not exported", unreviewed: gate.items, line: gate.line }, { status: 409 });
  const format = url.searchParams.get("format") === "pptx" ? "pptx" : "txt";
  const slug = w.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "webinar";

  if (format === "txt") {
    return new Response(outlineText(w.title, deck), { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${slug}-deck-outline.txt"`, "cache-control": "no-store" } });
  }

  // The coach's pictures for the filled slots, each read once, made ready for its frame (turned upright, downscaled, re-encoded,
  // placed by its kind: a photo covers, evidence is contained whole; src/lib/engine/deck-fit.ts); an empty slot has no entry and
  // its slide shows the red placeholder (§2). The owner's pictures, the same owner the deck's words resolve against.
  const resolved = await resolveDeckSlots(w.id, deck, { workspaceId: w.workspaceId, userId: w.userId });
  const filled = filledSlides(resolved);
  const kindOf = new Map(deck.slides.map((s) => [s.n, s.kind]));
  const bySlide = new Map<number, PreparedImage>();
  const bytesByUrl = new Map<string, Promise<Buffer | null>>();
  const readOnce = (url: string) => bytesByUrl.get(url) ?? bytesByUrl.set(url, readBytes(url)).get(url)!;
  await Promise.all(resolved.filter((r) => r.image).map(async (r) => {
    const bytes = await readOnce(r.image!.url);
    const prepared = bytes ? await prepareDeckImage(bytes, r.image!.kind, slotFrame(kindOf.get(r.slide) ?? "section")) : null;
    if (prepared) bySlide.set(r.slide, prepared);
    else filled.delete(r.slide); // The bytes wouldn't read back or decode: the slide shows the slot's placeholder, never a broken picture.
  }));
  // The logo (§4): the kit's pick first; failing that, the newest logo in the owner's own library. On the cover, and in the footer
  // bar when the bar is on, each contained whole in its box. No logo means the brand line set as type.
  const logoRow =
    (kit?.logoImageId ? await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.id, kit.logoImageId), eq(schema.deckImages.workspaceId, w.workspaceId)) }) : null) ??
    (await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.workspaceId, w.workspaceId), eq(schema.deckImages.userId, w.userId), eq(schema.deckImages.kind, "logo")), orderBy: [desc(schema.deckImages.createdAt)] })) ??
    null;
  const logoBytes = logoRow ? await readOnce(logoRow.blobUrl) : null;
  const logo = logoBytes && deck.footerBar ? await prepareDeckImage(logoBytes, "logo", LOGO_BOX) : null;
  const coverLogo = logoBytes ? await prepareDeckImage(logoBytes, "logo", COVER_LOGO_BOX) : null;
  // The footer's brand line (§4): this webinar's own, else the kit's name, else the workspace's when no kit is applied.
  const brand = w.footerBrand?.trim() || (deck.kitApplied ? deck.kit.name : v.workspace.name);

  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  // The file says whose it is: the presenter as author, the workspace as company, the webinar as subject. Never the generator.
  pptx.title = w.title;
  pptx.subject = w.title;
  pptx.author = context.presenter;
  pptx.company = v.workspace.name;
  // The theme fonts are the kit's fallback face (§4): the format has no second typeface on a run, so a reader without a brand
  // face falls to their app's substitute, but every box a reader adds in PowerPoint takes this face, not Calibri.
  pptx.theme = { headFontFace: deck.kit.fontFallback, bodyFontFace: deck.kit.fontFallback };
  const chrome = { footerBar: deck.footerBar, ctaBar: deck.ctaBar, ctaFooter: deck.ctaFooter, company: brand, muted: normalise(deck.kit.muted), surface: normalise(deck.kit.surface), accent: normalise(deck.kit.accent), body: deck.kit.bodyFont, logo, coverLogo };
  for (const plan of renderPlan(deck, filled)) draw(pptx, plan, bySlide.get(plan.n) ?? null, chrome);
  // The same picture on several slides (and the logo on every content slide) is one media file in the finished zip.
  const { file: buffer } = await dedupeDeckMedia((await pptx.write({ outputType: "nodebuffer" })) as Buffer);
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "content-disposition": `attachment; filename="${slug}-deck.pptx"`, "cache-control": "no-store" },
  });
}

const normalise = (v: string): string => (v ?? "").replace(/^#/, "").toUpperCase();

type Chrome = { footerBar: boolean; ctaBar: boolean; ctaFooter: string | null; company: string; muted: string; surface: string; accent: string; body: string; logo: PreparedImage | null; coverLogo: PreparedImage | null };

/**
 * One slide from its plan: a mapping, nothing decided here. Every colour and face is the plan's. A filled slot's picture is
 * cropped to its frame (cover: it fills the frame and any overflow is cropped, never stretched), and the text moves to the left
 * column so it never overlaps the picture. The optional footer and CTA bars sit at the very bottom, off by default.
 */
function draw(pptx: PptxGenJS, plan: SlidePlan, image: PreparedImage | null, chrome: Chrome) {
  const slide = pptx.addSlide();
  slide.background = { color: plan.background };
  // A slide that carries only the picture of the slide before it (§4): the picture, or its placeholder, and nothing else.
  if (plan.pictureOnly) {
    if (image && plan.imageFrame) drawImage(pptx, slide, image, plan.imageFrame, plan.background);
    else if (plan.placeholderSlot) drawPlaceholder(pptx, slide, plan.placeholderSlot, chrome.body);
    drawBars(pptx, slide, chrome, false);
    slide.addNotes(plan.notes);
    return;
  }
  // A filled slot's frame, or the empty slot's: the text keeps the picture-slide layout either way (§2).
  const frame = plan.imageFrame ?? plan.placeholderSlot?.frame ?? null;
  const cover = plan.boxes.some((b) => b.role === "cover-title");
  // With a picture, the text lives in the left column; without one, it keeps the full-width geometry.
  const zone = frame ? TEXT_LEFT_ZONE : { x: 0.5, w: 9 };
  const bodyZone = frame ? { x: TEXT_LEFT_ZONE.x + 0.2, w: TEXT_LEFT_ZONE.w - 0.2 } : { x: 0.7, w: 8.6 };

  if (cover) {
    // The logo on the cover (§4), top left, contained whole in its box.
    if (chrome.coverLogo) slide.addImage({ data: chrome.coverLogo.data, x: chrome.coverLogo.placement.box.x, y: chrome.coverLogo.placement.box.y, w: chrome.coverLogo.placement.box.w, h: chrome.coverLogo.placement.box.h });
    const title = plan.boxes.find((b) => b.role === "cover-title");
    const presenter = plan.boxes.find((b) => b.role === "cover-presenter");
    if (title) slide.addText(title.text, frame ? { x: zone.x, y: 1.6, w: zone.w, h: 1.8, fontSize: title.size, bold: title.bold, color: title.color, fontFace: title.face, align: "left", valign: "middle" } : { x: 0.5, y: 1.5, w: 9, h: 1.6, fontSize: title.size, bold: title.bold, color: title.color, fontFace: title.face, align: "center", valign: "middle" });
    if (presenter) slide.addText(presenter.text, frame ? { x: zone.x, y: 3.5, w: zone.w, h: 0.6, fontSize: presenter.size, color: presenter.color, fontFace: presenter.face, align: "left" } : { x: 0.5, y: 3.3, w: 9, h: 0.6, fontSize: presenter.size, color: presenter.color, fontFace: presenter.face, align: "center" });
  } else {
    const eyebrow = plan.boxes.find((b) => b.role === "eyebrow");
    const headline = plan.boxes.find((b) => b.role === "headline");
    const lines = plan.boxes.filter((b) => b.role === "body" || b.role === "attribution");
    const footer = plan.boxes.find((b) => b.role === "footer");
    if (eyebrow) slide.addText(eyebrow.text, { x: zone.x, y: 0.25, w: zone.w, h: 0.4, fontSize: eyebrow.size, color: eyebrow.color, fontFace: eyebrow.face });
    // A statement (§4: one line, no body) sits vertically centred and large; a content headline sits at the top of its box.
    if (headline && plan.layout === "statement") slide.addText(headline.text, { x: zone.x, y: 1.0, w: zone.w, h: 3.4, fontSize: headline.size, bold: headline.bold, italic: headline.italic, color: headline.color, fontFace: headline.face, valign: "middle", ...(headline.fill ? { fill: { color: headline.fill } } : {}) });
    else if (headline) slide.addText(headline.text, { x: zone.x, y: 0.8, w: zone.w, h: 1.5, fontSize: headline.size, bold: headline.bold, italic: headline.italic, color: headline.color, fontFace: headline.face, valign: "top", ...(headline.fill ? { fill: { color: headline.fill } } : {}) });
    if (lines.length) {
      slide.addText(
        lines.map((b) => ({ text: b.text, options: { bullet: b.bullet, breakLine: true, fontSize: b.size, color: b.color, fontFace: b.face, ...(b.fill ? { highlight: b.fill } : {}) } })),
        { x: bodyZone.x, y: 2.4, w: bodyZone.w, h: 2.4, valign: "top" },
      );
    }
    if (footer) slide.addText(footer.text, { x: 0.5, y: 5.0, w: 9, h: 0.3, fontSize: footer.size, color: footer.color, fontFace: footer.face, align: "center", ...(footer.fill ? { fill: { color: footer.fill } } : {}) });
  }
  // The picture in its frame: a photo cropped to fill it, evidence kept whole inside it; never stretched out of shape.
  if (image && plan.imageFrame) drawImage(pptx, slide, image, plan.imageFrame, plan.background);
  else if (plan.placeholderSlot) drawPlaceholder(pptx, slide, plan.placeholderSlot, chrome.body);
  for (const r of plan.rules) slide.addShape(pptx.ShapeType.line, { x: 0.5, y: r.y, w: frame ? zone.w : 9, h: 0, line: { color: r.color, width: 1.5 } });
  drawBars(pptx, slide, chrome, cover);
  if (plan.notes) slide.addNotes(plan.notes);
}

/**
 * An empty picture slot (§2, Danno's decision): the frame the picture would take, a 1pt dashed outline and red text inside
 * saying what to add, in the fixed placeholder red, never the brand accent. Filling the slot later puts the picture in this
 * same frame and nothing else on the slide moves.
 */
function drawPlaceholder(pptx: PptxGenJS, slide: PptxGenJS.Slide, ph: PlaceholderSlot, face: string) {
  const { frame } = ph;
  slide.addShape(pptx.ShapeType.rect, { x: frame.x, y: frame.y, w: frame.w, h: frame.h, fill: { type: "none" }, line: { color: ph.color, width: 1, dashType: "dash" } });
  slide.addText(ph.text, { x: frame.x + 0.25, y: frame.y + 0.25, w: frame.w - 0.5, h: frame.h - 0.5, fontSize: PLACEHOLDER_TEXT_SIZE, color: ph.color, fontFace: face, align: "center", valign: "middle" });
}

/**
 * A picture in its frame, as the fit engine placed it. Cover: the box is the frame and the file carries a srcRect that crops
 * the excess equally both sides (pptxgenjs computes it from the image's own ratio, given as w/h, against the frame given as
 * the sizing box). Contain: the box is the picture's own ratio, centred, with the slide's ground behind the bare part of the
 * frame, no crop. The ratio of what is drawn always equals the ratio of what is shown, which the walk reads back from the XML.
 */
function drawImage(pptx: PptxGenJS, slide: PptxGenJS.Slide, image: PreparedImage, frame: Frame, ground: string) {
  // Placed for the frame it is drawn in (a picture may take the next slide's bigger frame, §4), by the same fit engine.
  const placement = placeImage(frame, { w: image.width, h: image.height }, image.mode);
  if (placement.mode === "cover" && placement.crop) {
    const w = frame.w;
    const h = (frame.w * image.height) / image.width;
    slide.addImage({ data: image.data, x: frame.x, y: frame.y, w, h, sizing: { type: "cover", w: frame.w, h: frame.h } });
    return;
  }
  if (placement.pads) slide.addShape(pptx.ShapeType.rect, { x: frame.x, y: frame.y, w: frame.w, h: frame.h, fill: { color: ground }, line: { color: ground, width: 0 } });
  slide.addImage({ data: image.data, x: placement.box.x, y: placement.box.y, w: placement.box.w, h: placement.box.h });
}

/**
 * The optional bottom chrome, both off by default: a footer bar (a thin surface band with the workspace name and, if the coach
 * has one, their logo) and a CTA bar (the offer's one line). They live in the bottom strip only, so they never cross the body.
 */
function drawBars(pptx: PptxGenJS, slide: PptxGenJS.Slide, chrome: Chrome, cover: boolean) {
  if (cover) return; // The cover carries neither bar: it is the title moment.
  const bandY = 5.32;
  if (chrome.footerBar) {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: bandY, w: 10, h: 0.3, fill: { color: chrome.surface } });
    // The boxes never collide (§4): the brand line to 3.9 in, the CTA from 4.0 to 8.8, the logo from 9.0.
    slide.addText(chrome.company, { x: 0.4, y: bandY, w: 3.5, h: 0.3, fontSize: 9, color: chrome.muted, fontFace: chrome.body, valign: "middle" });
    // The logo whole at its own ratio inside its box, never stretched; a small one at its own size.
    if (chrome.logo) slide.addImage({ data: chrome.logo.data, x: chrome.logo.placement.box.x, y: chrome.logo.placement.box.y, w: chrome.logo.placement.box.w, h: chrome.logo.placement.box.h });
  }
  if (chrome.ctaBar && chrome.ctaFooter) {
    // Footer text is muted (§4: the accent at 10pt failed contrast on the surface); the accent stays on the rule.
    slide.addText(chrome.ctaFooter, { x: 4.0, y: bandY, w: 4.8, h: 0.3, fontSize: 10, bold: true, color: chrome.muted, fontFace: chrome.body, align: "center", valign: "middle" });
  }
}
