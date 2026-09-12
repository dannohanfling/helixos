import sharp from "sharp";
import heicConvert from "heic-convert";

/**
 * The one conversion the feature does: a HEIC (the iPhone camera's default) gets a JPEG rendition so browsers can show it.
 * The original is kept and served on download. Nothing else is edited, cropped, filtered, transcoded or described.
 * The end-to-end path is exercised by a real fixture (src/lib/engine/__tests__/fixtures/tiny.heic) in the unit suite and the proofs walk.
 */
export async function heicToJpeg(heic: Buffer): Promise<Buffer> {
  return Buffer.from(await heicConvert({ buffer: heic, format: "JPEG", quality: 0.9 }));
}

/** Width and height read from the bytes of a browser-decodable image; null when they cannot be read. */
export async function imageDimensions(bytes: Buffer): Promise<{ width: number | null; height: number | null }> {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width ?? null, height: meta.height ?? null };
}
