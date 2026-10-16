/**
 * The six public pages (H-331): privacy, terms, support, delete account, AI and your Board, community guidelines. Scriba's
 * pages (docs/legal/*.html, the v2 copy of H-347) are the source of truth, word for word; this reads one page's title,
 * description and body out of its HTML and swaps the cross-page links (`terms.html#advice`) for the routes (`/terms#advice`),
 * anchors kept. `scripts/legal-pages.ts` writes the result to src/content/legal.ts, and the unit test regenerates it from the
 * docs so the two can never drift.
 */
export const LEGAL_SLUGS = ["privacy", "terms", "support", "delete-account", "ai-and-the-board", "community-guidelines"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/** The header's labels, in the order Scriba's pages list them. */
export const LEGAL_NAV: { slug: LegalSlug; label: string }[] = [
  { slug: "privacy", label: "Privacy" },
  { slug: "terms", label: "Terms" },
  { slug: "support", label: "Support" },
  { slug: "delete-account", label: "Delete account" },
  { slug: "ai-and-the-board", label: "AI and your Board" },
  { slug: "community-guidelines", label: "Community" },
];

/** The small footer under every app page: Privacy · Terms · Support · Community. */
export const LEGAL_FOOTER: { href: string; label: string }[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
  { href: "/community-guidelines", label: "Community" },
];

export const SITE = "https://helixos.evolveomega.com";

export type LegalPage = { slug: LegalSlug; title: string; description: string; html: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** One page out of its HTML file. Throws when the file is not shaped as the six are, so a bad edit fails the test, not a visitor. */
export function legalFromHtml(slug: LegalSlug, html: string): LegalPage {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.replace(/\s*·\s*HelixOS\s*$/, "").trim();
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
  const main = /<main><div class="wrap">([\s\S]*?)<\/div><\/main>/.exec(html)?.[1];
  if (!title || !description || !main) throw new Error(`${slug}: the page is missing its title, description or main`);
  const body = main
    .trim()
    // Cross-page links become routes; an anchor on them stays. A link to the live site's root becomes a plain root link.
    .replace(/href="([a-z-]+)\.html(#[a-z-]+)?"/g, (_m, page: string, anchor: string | undefined) => `href="/${page}${anchor ?? ""}"`)
    .replace(/href="https:\/\/helixos\.evolveomega\.com\/?"/g, 'href="/"');
  return { slug, title: decode(title), description: decode(description), html: body };
}

/** Every id on the page, for the anchor check. */
export const idsIn = (html: string): Set<string> => new Set([...html.matchAll(/ id="([a-z-]+)"/g)].map((m) => m[1]));

/** Every `/page#anchor` the page links to. */
export const anchorLinksIn = (html: string): { slug: string; anchor: string }[] =>
  [...html.matchAll(/href="\/([a-z-]+)#([a-z-]+)"/g)].map((m) => ({ slug: m[1], anchor: m[2] })).concat([...html.matchAll(/href="#([a-z-]+)"/g)].map((m) => ({ slug: "", anchor: m[1] })));

export const legalMetadata = (p: LegalPage) => ({ title: p.title, description: p.description, alternates: { canonical: `${SITE}/${p.slug}` }, robots: { index: true, follow: true } });
