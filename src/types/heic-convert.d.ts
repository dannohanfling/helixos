declare module "heic-convert" {
  /** Decodes a HEIC/HEIF image (libheif in WASM) and re-encodes the primary image as JPEG or PNG. */
  export default function convert(options: { buffer: Buffer | Uint8Array; format: "JPEG" | "PNG"; quality?: number }): Promise<Buffer>;
}
