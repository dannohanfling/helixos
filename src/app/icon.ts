import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const size = { width: 48, height: 48 };
export const contentType = "image/png";

/** The browser tab icon (H-667): the medallion on its own, on transparent. Read once when the site is built. */
export default async function Icon() {
  return new Response(await readFile(join(process.cwd(), "public/app-icon/favicon-48.png")), { headers: { "Content-Type": contentType } });
}
