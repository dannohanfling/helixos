/**
 * The deck's pictures, server side (deck visuals brief §1): the bytes of a coach's image made ready for a slide, and the file
 * itself tidied after it is written. Nothing here chooses what goes on a slide; that is the engine's (src/lib/engine/deck-fit.ts).
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import JSZip from "jszip";
import type { DeckImageKind } from "@/db/schema";
import { encodePlan, fitModeFor, placeImage, type Box, type FitMode, type Placement } from "@/lib/engine/deck-fit";

export type PreparedImage = { data: string; mime: string; width: number; height: number; hash: string; mode: FitMode; placement: Placement; bytes: number };

/**
 * One picture made ready for its frame: turned the right way up (a phone photo carries its rotation in EXIF), downscaled to
 * twice the frame's 96 dpi size (never enlarged), re-encoded as JPEG for a photo or PNG for anything else, and placed. The
 * hash is of the bytes that go in the file, so the same picture on two slides is one media file.
 */
export async function prepareDeckImage(bytes: Buffer, kind: DeckImageKind | "proof", frame: Box): Promise<PreparedImage | null> {
  const mode = fitModeFor(kind);
  const plan = encodePlan(frame, mode, kind);
  try {
    let img = sharp(bytes, { animated: false }).rotate().resize({ width: plan.width, height: plan.height, fit: plan.fit, withoutEnlargement: true });
    img = plan.format === "jpeg" ? img.flatten({ background: "#ffffff" }).jpeg({ quality: plan.quality, mozjpeg: true }) : img.png({ compressionLevel: 9, palette: false });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    const mime = plan.format === "jpeg" ? "image/jpeg" : "image/png";
    return { data: `data:${mime};base64,${data.toString("base64")}`, mime, width: info.width, height: info.height, hash: createHash("sha256").update(data).digest("hex"), mode, placement: placeImage(frame, { w: info.width, h: info.height }, mode), bytes: data.length };
  } catch {
    return null;
  }
}

/**
 * pptxgenjs writes one media file per picture placed, even when the same bytes sit on several slides (it matches by file path,
 * which a data: image never has). After the file is written, identical media are folded into one: each slide's relationships
 * are pointed at the first copy and the rest are dropped. The slides' XML never changes, only their .rels.
 */
export async function dedupeDeckMedia(pptx: Buffer): Promise<{ file: Buffer; media: number; removed: number }> {
  const zip = await JSZip.loadAsync(pptx);
  const names = Object.keys(zip.files).filter((f) => /^ppt\/media\/[^/]+$/.test(f) && !zip.files[f].dir);
  const keep = new Map<string, string>(); // hash → the kept file name
  const alias = new Map<string, string>(); // a dropped file name → the kept one
  for (const name of names) {
    const hash = createHash("sha256").update(await zip.file(name)!.async("nodebuffer")).digest("hex");
    const kept = keep.get(hash);
    if (kept) alias.set(name, kept);
    else keep.set(hash, name);
  }
  if (!alias.size) return { file: pptx, media: names.length, removed: 0 };
  const rels = Object.keys(zip.files).filter((f) => /^ppt\/(slides|slideLayouts|slideMasters)\/_rels\/[^/]+\.rels$/.test(f));
  for (const rel of rels) {
    let xml = await zip.file(rel)!.async("string");
    let changed = false;
    for (const [dropped, kept] of alias) {
      const from = `../media/${dropped.slice("ppt/media/".length)}`;
      const to = `../media/${kept.slice("ppt/media/".length)}`;
      if (xml.includes(`Target="${from}"`)) {
        xml = xml.split(`Target="${from}"`).join(`Target="${to}"`);
        changed = true;
      }
    }
    if (changed) zip.file(rel, xml);
  }
  for (const dropped of alias.keys()) zip.remove(dropped);
  const file = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { file, media: names.length - alias.size, removed: alias.size };
}
