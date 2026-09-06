import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { deckOutline } from "@/lib/engine/webinar";

export const dynamic = "force-dynamic";

const ACT_LABEL: Record<string, string> = { opening: "Opening frame", vehicle: "Vehicle", internal: "Internal", external: "External", closing: "Closing frame" };

/**
 * GET /api/webinars/{id}/deck?format=pptx|txt
 * The deck outline the wizard already generates, as a real file: a .pptx with one slide per idea (headline, up to three body
 * lines, art direction in the speaker notes) or a plain-text outline. The member owns the webinar or gets a 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const { id } = await params;
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.userId, v.user.id)) });
  if (!w) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sections = await db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, id), orderBy: asc(schema.webinarSections.order) });
  const slides = deckOutline(sections);
  const format = new URL(request.url).searchParams.get("format") === "pptx" ? "pptx" : "txt";
  const slug = w.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "webinar";

  if (format === "txt") {
    const text = [`${w.title}`, `Deck outline · ${slides.length} slides`, "", ...slides.flatMap((s) => [`${s.n}. ${s.headline}`, `   Section: ${s.section} (${ACT_LABEL[s.act] ?? s.act})`, ...s.body.split("\n").filter(Boolean).map((b) => `   - ${b}`), `   Visual: ${s.visual}`, ""])].join("\n");
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${slug}-deck-outline.txt"`, "cache-control": "no-store" } });
  }

  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = w.title;
  pptx.author = v.user.name;
  const cover = pptx.addSlide();
  cover.background = { color: "0D0D0D" };
  cover.addText(w.title, { x: 0.5, y: 1.6, w: 9, h: 1.4, fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Arial", align: "center" });
  cover.addText(v.user.name, { x: 0.5, y: 3.2, w: 9, h: 0.6, fontSize: 18, color: "DDA338", fontFace: "Arial", align: "center" });
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(`${s.n} · ${s.section} · ${ACT_LABEL[s.act] ?? s.act}`, { x: 0.5, y: 0.25, w: 9, h: 0.4, fontSize: 11, color: "888888", fontFace: "Arial" });
    slide.addText(s.headline, { x: 0.5, y: 0.8, w: 9, h: 1.4, fontSize: 30, bold: true, color: "0D0D0D", fontFace: "Arial", valign: "top" });
    const lines = s.body.split("\n").filter(Boolean);
    if (lines.length) slide.addText(lines.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), { x: 0.7, y: 2.3, w: 8.6, h: 2.4, fontSize: 18, color: "333333", fontFace: "Arial", valign: "top" });
    slide.addText(`Visual: ${s.visual}`, { x: 0.5, y: 4.9, w: 9, h: 0.4, fontSize: 11, italic: true, color: "DDA338", fontFace: "Arial" });
    slide.addNotes(`Section: ${s.section}\nVisual direction: ${s.visual}${lines.length ? `\n\nBody:\n${lines.join("\n")}` : ""}`);
  }
  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "content-disposition": `attachment; filename="${slug}-deck.pptx"`, "cache-control": "no-store" },
  });
}
