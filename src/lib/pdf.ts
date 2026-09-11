/**
 * A typeset lead magnet as a PDF: title over a brand-gold band, the promise, the sections, the client's name at the foot. A
 * document, not imagery: type and layout only. Gold is a fill behind dark text, never a text colour. Returns the bytes.
 */
import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MagnetContent, MagnetType } from "@/db/schema";
import { BRAND } from "@/lib/brand";

const INK = "#1a1a1a";
const MUTED = "#5a5a5a";

export async function renderMagnetPdf(m: { title: string; promise: string; audience: string; content: MagnetContent; type: MagnetType; byline: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 64, bottom: 64, left: 64, right: 64 }, info: { Title: m.title, Author: m.byline } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const width = doc.page.width - 128;

  // Cover band
  doc.rect(0, 0, doc.page.width, 14).fill(BRAND.gold);
  try {
    doc.image(readFileSync(join(process.cwd(), "public", "email", "logo-120.png")), 64, 40, { width: 40 });
  } catch {
    /* no logo file on this host: the document stands without it */
  }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(26).text(m.title, 64, 100, { width });
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(14).fillColor(MUTED).text(m.promise, { width });
  if (m.audience) {
    doc.moveDown(0.3);
    doc.fontSize(11).text(`For ${m.audience}`, { width });
  }
  doc.moveDown(1);
  if (m.content.intro) {
    doc.fillColor(INK).fontSize(12).text(m.content.intro, { width, lineGap: 3 });
    doc.moveDown(0.8);
  }
  const tick = m.type === "checklist" || m.type === "audit";
  for (const s of m.content.sections) {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.rect(64, doc.y, 4, 18).fill(BRAND.deepGold);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(s.heading, 76, doc.y, { width: width - 12 });
    doc.font("Helvetica").fontSize(12);
    if (s.why) doc.fillColor(MUTED).text(`Why: ${s.why}`, 64, doc.y + 4, { width, lineGap: 2 });
    if (s.how) doc.fillColor(MUTED).text(`How: ${s.how}`, 64, doc.y + 2, { width, lineGap: 2 });
    doc.fillColor(INK);
    for (const item of s.items) {
      if (doc.y > doc.page.height - 100) doc.addPage();
      const y = doc.y + 6;
      if (tick) {
        doc.rect(66, y + 1, 11, 11).lineWidth(1).stroke(INK);
        doc.text(item, 86, y, { width: width - 22, lineGap: 2 });
      } else {
        doc.circle(70, y + 6, 2).fill(BRAND.deepGold);
        doc.fillColor(INK).text(item, 82, y, { width: width - 18, lineGap: 2 });
      }
    }
    doc.moveDown(0.9);
  }
  if (m.content.closing) {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.rect(64, doc.y, width, 1).fill("#e8e5dd");
    doc.moveDown(0.6);
    doc.fillColor(INK).font("Helvetica").fontSize(12).text(m.content.closing, 64, doc.y, { width, lineGap: 3 });
  }
  doc.fontSize(9).fillColor(MUTED).text(m.byline, 64, doc.page.height - 48, { width, align: "left" });
  doc.end();
  return done;
}
