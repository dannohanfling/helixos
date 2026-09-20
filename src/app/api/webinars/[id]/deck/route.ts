import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import type PptxGenJS from "pptxgenjs";
import { deckSlides, outlineText, renderPlan, type SlidePlan } from "@/lib/engine/deck";
import { contextFor } from "@/lib/queries/webinar";

export const dynamic = "force-dynamic";

/**
 * GET /api/webinars/{id}/deck?format=pptx|txt
 * The deck as the resolver finds it, in the workspace's brand kit: a .pptx with one slide per idea (the eyebrow, the headline at
 * its tier, up to three body lines, the art direction and the delivery note in the speaker notes and nowhere on the face) or the
 * plain-text outline. The same `deckSlides` the Deck step reads decides whether the file can go: a refusal is a 409 with the
 * reasons, the ones the step already showed before the click. The member owns the webinar or gets a 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { id } = await params;
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.userId, v.user.id)) });
  if (!w) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [context, kit] = await Promise.all([contextFor(v, w), db.query.brandKits.findFirst({ where: eq(schema.brandKits.workspaceId, v.workspace.id) })]);
  const deck = deckSlides(context, kit ?? null);
  if (deck.refused.length) return NextResponse.json({ error: "not exported", refused: deck.refused }, { status: 409 });
  const format = new URL(request.url).searchParams.get("format") === "pptx" ? "pptx" : "txt";
  const slug = w.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "webinar";

  if (format === "txt") {
    return new Response(outlineText(w.title, deck), { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${slug}-deck-outline.txt"`, "cache-control": "no-store" } });
  }

  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  // The file says whose it is: the presenter as author, the workspace as company, the webinar as subject. Never the generator.
  pptx.title = w.title;
  pptx.subject = w.title;
  pptx.author = context.presenter;
  pptx.company = v.workspace.name;
  for (const plan of renderPlan(deck)) draw(pptx, plan);
  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "content-disposition": `attachment; filename="${slug}-deck.pptx"`, "cache-control": "no-store" },
  });
}

/**
 * One slide from its plan: a mapping, nothing decided here. Every colour and face is the plan's, written as given; a box with a
 * fill is an unfilled slot drawn in the kit's placeholder colour. pptxgenjs names one face per run and has no per-run fallback,
 * so the fallback face lives in the cover slide's notes and in the kit, not in the file's font table.
 */
function draw(pptx: PptxGenJS, plan: SlidePlan) {
  const slide = pptx.addSlide();
  slide.background = { color: plan.background };
  const cover = plan.boxes.some((b) => b.role === "cover-title");
  if (cover) {
    for (const b of plan.boxes) {
      if (b.role === "cover-title") slide.addText(b.text, { x: 0.5, y: 1.5, w: 9, h: 1.6, fontSize: b.size, bold: b.bold, color: b.color, fontFace: b.face, align: "center", valign: "middle" });
      else slide.addText(b.text, { x: 0.5, y: 3.3, w: 9, h: 0.6, fontSize: b.size, color: b.color, fontFace: b.face, align: "center" });
    }
  } else {
    const eyebrow = plan.boxes.find((b) => b.role === "eyebrow");
    const headline = plan.boxes.find((b) => b.role === "headline");
    const lines = plan.boxes.filter((b) => b.role === "body" || b.role === "attribution");
    const footer = plan.boxes.find((b) => b.role === "footer");
    if (eyebrow) slide.addText(eyebrow.text, { x: 0.5, y: 0.25, w: 9, h: 0.4, fontSize: eyebrow.size, color: eyebrow.color, fontFace: eyebrow.face });
    if (headline) slide.addText(headline.text, { x: 0.5, y: 0.8, w: 9, h: 1.5, fontSize: headline.size, bold: headline.bold, italic: headline.italic, color: headline.color, fontFace: headline.face, valign: "top", ...(headline.fill ? { fill: { color: headline.fill } } : {}) });
    if (lines.length) {
      slide.addText(
        lines.map((b) => ({ text: b.text, options: { bullet: b.bullet, breakLine: true, fontSize: b.size, color: b.color, fontFace: b.face, ...(b.fill ? { highlight: b.fill } : {}) } })),
        { x: 0.7, y: 2.4, w: 8.6, h: 2.6, valign: "top" },
      );
    }
    if (footer) slide.addText(footer.text, { x: 0.5, y: 5.05, w: 9, h: 0.35, fontSize: footer.size, color: footer.color, fontFace: footer.face, align: "center", ...(footer.fill ? { fill: { color: footer.fill } } : {}) });
  }
  for (const r of plan.rules) slide.addShape(pptx.ShapeType.line, { x: 0.5, y: r.y, w: 9, h: 0, line: { color: r.color, width: 1.5 } });
  if (plan.notes) slide.addNotes(plan.notes);
}
