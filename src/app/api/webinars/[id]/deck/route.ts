import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import type PptxGenJS from "pptxgenjs";
import { boxAt, COVER_LOGO_BOX, COVER_LOGO_PLACEHOLDER, LOGO_BOX, PLACEHOLDER_RED, PLACEHOLDER_TEXT_SIZE, logoBadgeFrame, SLIDE_MASTERS, deckSlides, masterFor, masterGeometry, outlineText, renderPlan, slideGeometry, slotFrame, type BoxGeometry, type Frame, type PlaceholderSlot, type SlidePlan } from "@/lib/engine/deck";
import { applyKitTheme } from "@/lib/deck-theme";
import { dedupeDeckMedia, prepareDeckImage, type PreparedImage } from "@/lib/deck-media";
import { pictureAltText } from "@/lib/engine/deck-slot";
import { placeImage } from "@/lib/engine/deck-fit";
import { contextFor, ownerBrandName } from "@/lib/queries/webinar";
import { droppedSlides, filledSlides, resolveDeckSlots } from "@/lib/queries/deck-slots";
import { deckLogos, readDeckBytes } from "@/lib/deck-logo";
import { sameItems, sectionGate } from "@/lib/engine/provenance";
import { confirmFor } from "@/lib/provenance";

export const dynamic = "force-dynamic";


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
  const bySlide = new Map<number, PreparedImage & { alt: string }>();
  const bytesByUrl = new Map<string, Promise<Buffer | null>>();
  const readOnce = (url: string) => bytesByUrl.get(url) ?? bytesByUrl.set(url, readDeckBytes(url)).get(url)!;
  await Promise.all(resolved.filter((r) => r.image).map(async (r) => {
    const bytes = await readOnce(r.image!.url);
    const prepared = bytes ? await prepareDeckImage(bytes, r.image!.kind, slotFrame(kindOf.get(r.slide) ?? "section")) : null;
    if (prepared) bySlide.set(r.slide, { ...prepared, alt: pictureAltText(r.image!.caption, r.slot.what) });
    else filled.delete(r.slide); // The bytes wouldn't read back or decode: the slide shows the slot's placeholder, never a broken picture.
  }));
  const plans = renderPlan(deck, filled, droppedSlides(resolved));
  // The logos (§4, first-deck §3): the kit's pick, else the newest logo in the owner's own library. On the cover, contained whole
  // in its box: the kit's dark logo on a dark cover, or the one logo on a ground badge when it would not read there; in the footer
  // bar, when the bar is on, the one logo. No logo at all: a red "Your logo here" on the cover, and the brand line as type.
  const coverPlan = plans.find((p) => p.boxes.some((b) => b.role === "cover-title"));
  const logos = await deckLogos({ workspaceId: w.workspaceId, userId: w.userId }, kit ?? null, { background: coverPlan?.background ?? deck.kit.ground, ground: deck.kit.ground }, readOnce);
  const logoBytes = logos.logo ? await readOnce(logos.logo.blobUrl) : null;
  const coverBytes = logos.cover ? await readOnce(logos.cover.blobUrl) : null;
  const logo = logoBytes && deck.footerBar ? await prepareDeckImage(logoBytes, "logo", LOGO_BOX) : null;
  const coverLogo = coverBytes ? await prepareDeckImage(coverBytes, "logo", COVER_LOGO_BOX) : null;
  // The footer's brand line (§4): this webinar's own, else the kit's name, else the workspace's when no kit is applied.
  const brand = w.footerBrand?.trim() || (deck.kitApplied ? deck.kit.name : await ownerBrandName(w, v.workspace.name));

  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  // The file says whose it is: the presenter as author, the workspace as company, the webinar as subject. Never the generator.
  pptx.title = w.title;
  pptx.subject = w.title;
  pptx.author = context.presenter;
  pptx.company = v.workspace.name;
  // The theme fonts are the kit's own faces (§6.6; §4 had the fallback here): headings in the display face, body in the body
  // face, so a box a reader adds takes the brand face, and a reader without it falls to their app's substitute (the fallback
  // the kit names has no slot in the format; §4.3 says so to the client). The runs are rewritten to the theme faces after the
  // file is written (applyKitTheme), so a theme font change follows everywhere.
  pptx.theme = { headFontFace: deck.kit.displayFont, bodyFontFace: deck.kit.bodyFont };
  // One master, a layout per slide family (§6.6), with real title, body and footer placeholders where the geometry puts them.
  // The placeholders carry no size or colour of their own, so each slide's plan (tiers, fits, the kit's hex) is what is written.
  for (const name of SLIDE_MASTERS) {
    const g = masterGeometry(name);
    const ph = (phName: string, type: "title" | "body", b: BoxGeometry | undefined) => (b ? [{ placeholder: { options: { name: phName, type, x: b.x, y: b.y, w: b.w, h: b.h, align: b.align, valign: b.valign }, text: "" } }] : []);
    pptx.defineSlideMaster({
      title: name,
      background: { color: normalise(deck.kit.ground) },
      objects: [...ph("title", "title", g.boxes["cover-title"] ?? g.boxes.headline), ...ph("presenter", "body", g.boxes["cover-presenter"]), ...ph("eyebrow", "body", g.boxes.eyebrow), ...ph("body", "body", g.body ?? undefined), ...ph("footer", "body", g.boxes.footer)],
    });
  }
  const chrome = { footerBar: deck.footerBar, ctaBar: deck.ctaBar, ctaFooter: deck.ctaFooter, company: brand, muted: normalise(deck.kit.muted), surface: normalise(deck.kit.surface), accent: normalise(deck.kit.accent), body: deck.kit.bodyFont, logo, coverLogo, coverBadge: logos.badge, noLogo: !logos.logo && !logos.dark };
  for (const plan of plans) draw(pptx, plan, bySlide.get(plan.n) ?? null, chrome);
  // The same picture on several slides (and the logo on every content slide) is one media file in the finished zip.
  const written = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const themed = await applyKitTheme(written, { ground: deck.kit.ground, ink: deck.kit.ink, accent: deck.kit.accent, muted: deck.kit.muted, surface: deck.kit.surface, inverseGround: deck.kit.inverseGround, inverseInk: deck.kit.inverseInk, placeholder: deck.kit.placeholder, displayFont: deck.kit.displayFont, bodyFont: deck.kit.bodyFont });
  const { file: buffer } = await dedupeDeckMedia(themed);
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "content-disposition": `attachment; filename="${slug}-deck.pptx"`, "cache-control": "no-store" },
  });
}

const normalise = (v: string): string => (v ?? "").replace(/^#/, "").toUpperCase();

type Chrome = { footerBar: boolean; ctaBar: boolean; ctaFooter: string | null; company: string; muted: string; surface: string; accent: string; body: string; logo: PreparedImage | null; coverLogo: PreparedImage | null; /** The kit's ground behind a cover logo that would not read on the dark cover (§3). */ coverBadge: string | null; noLogo: boolean };

/**
 * One slide from its plan: a mapping, nothing decided here. Every colour and face is the plan's. A filled slot's picture is
 * cropped to its frame (cover: it fills the frame and any overflow is cropped, never stretched), and the text moves to the left
 * column so it never overlaps the picture. The optional footer and CTA bars sit at the very bottom, off by default.
 */
function draw(pptx: PptxGenJS, plan: SlidePlan, image: PreparedImage | null, chrome: Chrome) {
  const slide = pptx.addSlide({ masterName: masterFor(plan) });
  slide.background = { color: plan.background };
  // A slide that carries only the picture of the slide before it (§4): the picture, or its placeholder, and nothing else.
  if (plan.pictureOnly) {
    if (image && plan.imageFrame) drawImage(pptx, slide, image, plan.imageFrame, plan.background);
    else if (plan.placeholderSlot) drawPlaceholder(pptx, slide, plan.placeholderSlot, chrome.body);
    drawBars(pptx, slide, chrome, false, null);
    slide.addNotes(plan.notes);
    return;
  }
  // Every box's place comes from the plan's geometry (§6.4), the same the Deck step's thumbnail draws; nothing is placed here.
  const g = slideGeometry(plan);
  const cover = plan.boxes.some((b) => b.role === "cover-title");
  const at = (b: BoxGeometry) => ({ x: b.x, y: b.y, w: b.w, h: b.h, align: b.align, valign: b.valign });
  if (cover) {
    // The logo on the cover (§4, first-deck §3), top left, contained whole in its box: on its ground badge when it needs one,
    // and with none at all, the red dashed "Your logo here" in the same box.
    if (chrome.coverLogo && chrome.coverBadge) {
      const b = logoBadgeFrame(chrome.coverLogo.placement.box);
      slide.addShape(pptx.ShapeType.roundRect, { x: b.x, y: b.y, w: b.w, h: b.h, rectRadius: 0.08, fill: { color: chrome.coverBadge }, line: { color: chrome.coverBadge, width: 0 } });
    }
    if (!chrome.coverLogo && chrome.noLogo) drawPlaceholder(pptx, slide, { frame: COVER_LOGO_BOX, text: COVER_LOGO_PLACEHOLDER, color: PLACEHOLDER_RED }, chrome.body);
    if (chrome.coverLogo) slide.addImage({ data: chrome.coverLogo.data, x: chrome.coverLogo.placement.box.x, y: chrome.coverLogo.placement.box.y, w: chrome.coverLogo.placement.box.w, h: chrome.coverLogo.placement.box.h, altText: `${chrome.company} logo` });
    const title = plan.boxes.find((b) => b.role === "cover-title");
    const presenter = plan.boxes.find((b) => b.role === "cover-presenter");
    if (title && g.boxes["cover-title"]) slide.addText(title.text, { placeholder: "title", ...at(g.boxes["cover-title"]), fontSize: title.size, bold: title.bold, color: title.color, fontFace: title.face });
    if (presenter && g.boxes["cover-presenter"]) slide.addText(presenter.text, { placeholder: "presenter", ...at(g.boxes["cover-presenter"]), fontSize: presenter.size, color: presenter.color, fontFace: presenter.face });
    const date = plan.boxes.find((b) => b.role === "cover-date");
    if (date && g.boxes["cover-date"]) slide.addText(date.text, { ...at(g.boxes["cover-date"]), fontSize: date.size, color: date.color, fontFace: date.face });
  } else if (plan.layout === "figure" || plan.layout === "bignum" || plan.layout === "shift" || plan.layout === "cards") {
    // The laid-out slides (first-deck §5's figure; deck layouts 1, 3, 11): the cards' surface panels first, then every box where
    // the plan's geometry puts it, in its column when it sits in a row. Nothing is placed here that the thumbnail doesn't place.
    for (const p of plan.panels ?? []) slide.addShape(pptx.ShapeType.roundRect, { x: p.frame.x, y: p.frame.y, w: p.frame.w, h: p.frame.h, rectRadius: 0.08, fill: { color: p.color }, line: { color: p.color, width: 0 } });
    for (const b of plan.boxes) {
      const at_ = boxAt(g, b);
      if (!at_) continue;
      const ph = b.role === "headline" ? { placeholder: "title" } : b.role === "footer" ? { placeholder: "footer" } : {};
      slide.addText(b.text, { ...ph, ...at(at_), fontSize: b.size, bold: b.bold, italic: b.italic, color: b.color, fontFace: b.face, ...(b.fill ? { fill: { color: b.fill } } : {}), ...(b.strike ? { strike: "sngStrike" as const } : {}) });
    }
  } else {
    const eyebrow = plan.boxes.find((b) => b.role === "eyebrow");
    const headline = plan.boxes.find((b) => b.role === "headline");
    const lines = plan.boxes.filter((b) => b.role === "body" || b.role === "attribution");
    const footer = plan.boxes.find((b) => b.role === "footer");
    if (eyebrow && g.boxes.eyebrow) slide.addText(eyebrow.text, { placeholder: "eyebrow", ...at(g.boxes.eyebrow), fontSize: eyebrow.size, color: eyebrow.color, fontFace: eyebrow.face });
    // A statement (§4: one line, no body) sits vertically centred and large; a content headline sits at the top of its box.
    if (headline && g.boxes.headline) slide.addText(headline.text, { placeholder: "title", ...at(g.boxes.headline), fontSize: headline.size, bold: headline.bold, italic: headline.italic, color: headline.color, fontFace: headline.face, ...(headline.fill ? { fill: { color: headline.fill } } : {}) });
    if (lines.length && g.body) {
      slide.addText(
        lines.map((b) => ({ text: b.text, options: { bullet: b.bullet, breakLine: true, fontSize: b.size, color: b.color, fontFace: b.face, ...(b.fill ? { highlight: b.fill } : {}) } })),
        { placeholder: "body", ...at(g.body) },
      );
    }
    if (footer && g.boxes.footer) slide.addText(footer.text, { placeholder: "footer", ...at(g.boxes.footer), fontSize: footer.size, color: footer.color, fontFace: footer.face, ...(footer.fill ? { fill: { color: footer.fill } } : {}) });
  }
  // The picture in its frame: a photo cropped to fill it, evidence kept whole inside it; never stretched out of shape.
  if (image && plan.imageFrame) drawImage(pptx, slide, image, plan.imageFrame, plan.background);
  else if (plan.placeholderSlot) drawPlaceholder(pptx, slide, plan.placeholderSlot, chrome.body);
  for (const r of plan.rules) slide.addShape(pptx.ShapeType.line, { x: g.rules.x, y: r.y, w: g.rules.w, h: 0, line: { color: r.color, width: 1.5 } });
  drawBars(pptx, slide, chrome, cover, plan.ctaBar ?? null);
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
function drawImage(pptx: PptxGenJS, slide: PptxGenJS.Slide, image: PreparedImage & { alt?: string }, frame: Frame, ground: string) {
  // Placed for the frame it is drawn in (a picture may take the next slide's bigger frame, §4), by the same fit engine.
  const placement = placeImage(frame, { w: image.width, h: image.height }, image.mode);
  if (placement.mode === "cover" && placement.crop) {
    const w = frame.w;
    const h = (frame.w * image.height) / image.width;
    slide.addImage({ data: image.data, x: frame.x, y: frame.y, w, h, sizing: { type: "cover", w: frame.w, h: frame.h }, altText: image.alt });
    return;
  }
  if (placement.pads) slide.addShape(pptx.ShapeType.rect, { x: frame.x, y: frame.y, w: frame.w, h: frame.h, fill: { color: ground }, line: { color: ground, width: 0 } });
  slide.addImage({ data: image.data, x: placement.box.x, y: placement.box.y, w: placement.box.w, h: placement.box.h, altText: image.alt });
}

/**
 * The optional bottom chrome, both off by default: a footer bar (a thin surface band with the workspace name and, if the coach
 * has one, their logo) and a CTA bar (the offer's one line). They live in the bottom strip only, so they never cross the body.
 */
function drawBars(pptx: PptxGenJS, slide: PptxGenJS.Slide, chrome: Chrome, cover: boolean, cta: string | null) {
  if (cover) return; // The cover carries neither bar: it is the title moment.
  const bandY = 5.32;
  if (chrome.footerBar) {
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: bandY, w: 10, h: 0.3, fill: { color: chrome.surface } });
    // The boxes never collide (§4): the brand line to 3.9 in, the CTA from 4.0 to 8.8, the logo from 9.0. With a logo the brand
    // line goes (first-deck §3): the footer said the brand twice.
    if (!chrome.logo) slide.addText(chrome.company, { x: 0.4, y: bandY, w: 3.5, h: 0.3, fontSize: 9, color: chrome.muted, fontFace: chrome.body, valign: "middle" });
    // The logo whole at its own ratio inside its box, never stretched; a small one at its own size.
    if (chrome.logo) slide.addImage({ data: chrome.logo.data, x: chrome.logo.placement.box.x, y: chrome.logo.placement.box.y, w: chrome.logo.placement.box.w, h: chrome.logo.placement.box.h, altText: `${chrome.company} logo` });
  }
  if (cta) {
    // Only on the offer and Q&A slides and the close (first-deck §5), where it replaces the footer's CTA line. Footer text is
    // muted (§4: the accent at 10pt failed contrast on the surface); the accent stays on the rule.
    slide.addText(cta, { x: 4.0, y: bandY, w: 4.8, h: 0.3, fontSize: 10, bold: true, color: chrome.muted, fontFace: chrome.body, align: "center", valign: "middle" });
  }
}
