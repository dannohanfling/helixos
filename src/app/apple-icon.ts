import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * The iPhone home-screen tile (H-667): the medallion, square and opaque; iOS rounds the corners itself. Served at the same
 * /apple-icon address as before, so a home screen saved earlier keeps finding it. Read once when the site is built.
 */
export default async function AppleIcon() {
  return new Response(await readFile(join(process.cwd(), "public/app-icon/apple-touch-icon-180.png")), { headers: { "Content-Type": contentType } });
}
