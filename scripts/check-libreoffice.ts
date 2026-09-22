/**
 * The deck-images walk renders a real .pptx in LibreOffice, which needs the Impress module (libreoffice-impress) — the core
 * package alone cannot load a presentation. This preflight proves LibreOffice can render a .pptx before any walk starts, so a
 * missing module fails here with one plain line and the install command, not somewhere mid-walk. No production path on Vercel
 * needs LibreOffice: the .pptx export route builds the file with pptxgenjs and never shells out. Only this walk needs it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALL = "sudo apt-get update && sudo apt-get install -y libreoffice-impress";

function fail(msg: string): never {
  console.error(`libreoffice check: ${msg}`);
  console.error(`  install it: ${INSTALL}`);
  process.exit(1);
}

async function main() {
  const version = spawnSync("soffice", ["--version"], { encoding: "utf8" });
  if (version.status !== 0) fail("LibreOffice (soffice) is not installed or not on PATH.");
  const dir = mkdtempSync(join(tmpdir(), "lo-check-"));
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.addSlide().addText("probe", { x: 1, y: 1, w: 5, h: 1 });
  writeFileSync(join(dir, "probe.pptx"), (await pptx.write({ outputType: "nodebuffer" })) as Buffer);
  spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, join(dir, "probe.pptx")], { encoding: "utf8", env: { ...process.env, HOME: dir }, timeout: 120000 });
  if (!readdirSync(dir).some((f) => f.endsWith(".pdf"))) fail("LibreOffice can't render a .pptx — the Impress module (libreoffice-impress) is missing.");
  console.log("✓ libreoffice check: Impress renders a .pptx");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
