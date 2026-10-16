import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_FOOTER, LEGAL_NAV, LEGAL_SLUGS, anchorLinksIn, idsIn, legalFromHtml, legalMetadata } from "../legal";
import { LEGAL_PAGES } from "@/content/legal";
import { renderLegalModule } from "../../../../scripts/legal-pages";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("the six public pages (H-331)", () => {
  it("src/content/legal.ts is exactly what docs/legal/*.html generate: the copy is Scriba's, word for word", () => {
    expect(readFileSync(join(ROOT, "src/content/legal.ts"), "utf8")).toBe(renderLegalModule(ROOT));
  });
  it("every cross-page link is a route with its anchor kept, and no .html link is left", () => {
    for (const slug of LEGAL_SLUGS) {
      const p = LEGAL_PAGES[slug];
      expect(p.html).not.toMatch(/\.html["#]/);
      for (const { slug: to, anchor } of anchorLinksIn(p.html)) {
        const target = to ? LEGAL_PAGES[to as keyof typeof LEGAL_PAGES] : p;
        expect(target, `${slug} links to /${to}`).toBeTruthy();
        expect(idsIn(target.html).has(anchor), `${slug} → /${to || slug}#${anchor}`).toBe(true);
      }
    }
    // The anchors the brief names.
    expect(idsIn(LEGAL_PAGES.privacy.html).has("humanos")).toBe(true);
    expect(idsIn(LEGAL_PAGES.privacy.html).has("ai")).toBe(true);
    expect(idsIn(LEGAL_PAGES.terms.html).has("advice")).toBe(true);
    expect(idsIn(LEGAL_PAGES.terms.html).has("conduct")).toBe(true);
  });
  it("titles, descriptions and the canonical address come from the page; the header and footer name every route", () => {
    const p = legalFromHtml("privacy", readFileSync(join(ROOT, "docs/legal/privacy.html"), "utf8"));
    expect(p.title).toBe("Privacy Policy");
    expect(legalMetadata(p)).toEqual({ title: "Privacy Policy", description: p.description, alternates: { canonical: "https://helixos.evolveomega.com/privacy" }, robots: { index: true, follow: true } });
    expect(LEGAL_NAV.map((n) => n.slug)).toEqual([...LEGAL_SLUGS]);
    for (const f of LEGAL_FOOTER) expect(LEGAL_SLUGS).toContain(f.href.slice(1));
    // The v2 copy (H-347): no GoHighLevel sign-in, no Report button, the seat is "the Danno seat", notifications live in Settings.
    for (const slug of LEGAL_SLUGS) {
      const html = LEGAL_PAGES[slug].html;
      expect(html).not.toMatch(/GoHighLevel\) account|Settings → Notifications|use Report|The Danno Seat/);
    }
  });
  it("a page without its parts fails loudly", () => {
    expect(() => legalFromHtml("terms", "<html><title>x</title></html>")).toThrow(/missing/);
  });
});
