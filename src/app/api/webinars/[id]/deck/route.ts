import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import type PptxGenJS from "pptxgenjs";
import { TEXT_LEFT_ZONE, deckSlides, outlineText, renderPlan, type Frame, type SlidePlan } from "@/lib/engine/deck";
import { contextFor } from "@/lib/queries/webinar";
import { filledSlides, resolveDeckSlots } from "@/lib/queries/deck-slots";
import { readProofObject } from "@/lib/proof-storage";
import { sameItems, sectionGate } from "@/lib/engine/provenance";
import { confirmFor } from "@/lib/provenance";

export const dynamic = "force-dynamic";

/** The private object as a data URL the .pptx can embed, or null when the bytes can't be read (the slide then stays text). */
async function dataUrl(url: string, mime: string): Promise<string | null> {
  try {
    const res = await readProofObject(url);
    if (!res.ok) return null;
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

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

  // The coach's pictures for the filled slots, fetched once each as data URLs; an empty slot has no entry and its slide stays text.
  // The owner's pictures, the same owner the deck's words resolve against.
  const resolved = await resolveDeckSlots(w.id, deck, { workspaceId: w.workspaceId, userId: w.userId });
  const filled = filledSlides(resolved);
  const bySlide = new Map<number, string>();
  await Promise.all(resolved.filter((r) => r.image).map(async (r) => {
    const src = await dataUrl(r.image!.url, r.image!.mime);
    if (src) bySlide.set(r.slide, src);
    else filled.delete(r.slide); // The bytes wouldn't read back: draw the slide as text, not an empty frame.
  }));
  // The footer bar's logo, if the coach turned the bar on and has a logo in their library: their newest one.
  let logoUrl: string | null = null;
  if (deck.footerBar) {
    const logo = await db.query.deckImages.findFirst({ where: and(eq(schema.deckImages.workspaceId, w.workspaceId), eq(schema.deckImages.userId, w.userId), eq(schema.deckImages.kind, "logo")), orderBy: [desc(schema.deckImages.createdAt)] });
    if (logo) logoUrl = await dataUrl(logo.blobUrl, logo.mime);
  }

  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  // The file says whose it is: the presenter as author, the workspace as company, the webinar as subject. Never the generator.
  pptx.title = w.title;
  pptx.subject = w.title;
  pptx.author = context.presenter;
  pptx.company = v.workspace.name;
  const chrome = { footerBar: deck.footerBar, ctaBar: deck.ctaBar, ctaFooter: deck.ctaFooter, company: v.workspace.name, muted: normalise(deck.kit.muted), surface: normalise(deck.kit.surface), accent: normalise(deck.kit.accent), body: deck.kit.bodyFont, logoUrl };
  for (const plan of renderPlan(deck, filled)) draw(pptx, plan, bySlide.get(plan.n) ?? null, chrome);
  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "content-disposition": `attachment; filename="${slug}-deck.pptx"`, "cache-control": "no-store" },
  });
}

const normalise = (v: string): string => (v ?? "").replace(/^#/, "").toUpperCase();

type Chrome = { footerBar: boolean; ctaBar: boolean; ctaFooter: string | null; company: string; muted: string; surface: string; accent: string; body: string; logoUrl: string | null };

/**
 * One slide from its plan: a mapping, nothing decided here. Every colour and face is the plan's. A filled slot's picture is
 * cropped to its frame (cover: it fills the frame and any overflow is cropped, never stretched), and the text moves to the left
 * column so it never overlaps the picture. The optional footer and CTA bars sit at the very bottom, off by default.
 */
function draw(pptx: PptxGenJS, plan: SlidePlan, image: string | null, chrome: Chrome) {
  const slide = pptx.addSlide();
  slide.background = { color: plan.background };
  const frame = plan.imageFrame;
  const cover = plan.boxes.some((b) => b.role === "cover-title");
  // With a picture, the text lives in the left column; without one, it keeps the full-width geometry.
  const zone = frame ? TEXT_LEFT_ZONE : { x: 0.5, w: 9 };
  const bodyZone = frame ? { x: TEXT_LEFT_ZONE.x + 0.2, w: TEXT_LEFT_ZONE.w - 0.2 } : { x: 0.7, w: 8.6 };

  if (cover) {
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
    if (headline) slide.addText(headline.text, { x: zone.x, y: 0.8, w: zone.w, h: 1.5, fontSize: headline.size, bold: headline.bold, italic: headline.italic, color: headline.color, fontFace: headline.face, valign: "top", ...(headline.fill ? { fill: { color: headline.fill } } : {}) });
    if (lines.length) {
      slide.addText(
        lines.map((b) => ({ text: b.text, options: { bullet: b.bullet, breakLine: true, fontSize: b.size, color: b.color, fontFace: b.face, ...(b.fill ? { highlight: b.fill } : {}) } })),
        { x: bodyZone.x, y: 2.4, w: bodyZone.w, h: 2.4, valign: "top" },
      );
    }
    if (footer) slide.addText(footer.text, { x: 0.5, y: 5.0, w: 9, h: 0.3, fontSize: footer.size, color: footer.color, fontFace: footer.face, align: "center", ...(footer.fill ? { fill: { color: footer.fill } } : {}) });
  }
  // The picture, cropped to fill its frame: it never leaves the frame and it is never stretched out of shape.
  if (image && frame) drawImage(slide, image, frame);
  for (const r of plan.rules) slide.addShape(pptx.ShapeType.line, { x: 0.5, y: r.y, w: frame ? zone.w : 9, h: 0, line: { color: r.color, width: 1.5 } });
  drawBars(pptx, slide, chrome, cover);
  if (plan.notes) slide.addNotes(plan.notes);
}

/** A picture in its frame, filled and cropped (cover) so it sits inside the frame at the image's own aspect, never squashed. */
function drawImage(slide: PptxGenJS.Slide, data: string, frame: Frame) {
  slide.addImage({ data, x: frame.x, y: frame.y, w: frame.w, h: frame.h, sizing: { type: "cover", w: frame.w, h: frame.h } });
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
    slide.addText(chrome.company, { x: 0.4, y: bandY, w: 5, h: 0.3, fontSize: 9, color: chrome.muted, fontFace: chrome.body, valign: "middle" });
    if (chrome.logoUrl) slide.addImage({ data: chrome.logoUrl, x: 9.0, y: bandY + 0.03, w: 0.9, h: 0.24, sizing: { type: "contain", w: 0.9, h: 0.24 } });
  }
  if (chrome.ctaBar && chrome.ctaFooter) {
    slide.addText(chrome.ctaFooter, { x: 2.5, y: bandY, w: 5, h: 0.3, fontSize: 10, bold: true, color: chrome.accent, fontFace: chrome.body, align: "center", valign: "middle" });
  }
}
