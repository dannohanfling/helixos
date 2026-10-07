/**
 * One file control everywhere (Danno, 7 Oct): a bare browser file input reads as plain text and, on a phone, looks like
 * take-a-photo only. Every file input in the app is the shared FilePicker's, read off the source; the one exception is
 * Body's photo form, which Body is replacing with the same component on the Log page.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e) && !full.includes("__tests__")) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(root, f).replaceAll("\\", "/");

describe("the shared file control", () => {
  it("is the only file input in the app, bar Body's photo form (theirs to switch)", () => {
    const withInput = walk(path.join(root, "src")).filter((f) => /type="file"/.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(withInput).toEqual(["src/components/body/photo-form.tsx", "src/components/file-picker.tsx"]);
  });
  it("offers the camera and the library apart for an image, one upload button for a file, full width on a phone, and a clear", () => {
    const src = readFileSync(path.join(root, "src/components/file-picker.tsx"), "utf8");
    const inputs = src.match(/<input[^>]*type="file"[^>]*\/>/g) ?? [];
    expect(inputs).toHaveLength(2);
    const camera = inputs.find((i) => i.includes('capture="environment"'))!;
    const library = inputs.find((i) => !i.includes("capture="))!;
    expect(camera).toContain("data-testid={`${testId}-capture`}");
    expect(library).toContain("data-testid={testId}");
    expect(src).toMatch(/Take photo/);
    expect(src).toMatch(/"Upload photo" : "Upload file"/);
    expect(src).toMatch(/btn btn-soft btn-sm w-full cursor-pointer sm:w-auto/);
    expect(src).toMatch(/data-testid=\{`\$\{testId\}-clear`\}/);
    expect(src).toMatch(/data-testid=\{`\$\{testId\}-thumb`\}/);
    // The camera button exists only for an image.
    expect(src).toMatch(/\{kind === "image" \? \(\s*<label/);
  });
  it("every caller keeps its submit held until a file is chosen", () => {
    const magnet = readFileSync(path.join(root, "src/components/magnet-upload.tsx"), "utf8");
    expect(magnet).toMatch(/disabled=\{pending \|\| !file\}/);
    const scale = readFileSync(path.join(root, "src/components/body/scale-import.tsx"), "utf8");
    expect(scale).toMatch(/disabled=\{!parsed\?\.readings\.length\}/);
    const proof = readFileSync(path.join(root, "src/components/proof-upload.tsx"), "utf8");
    expect(proof).toMatch(/\{file && sniffed \? \(/);
  });
});
