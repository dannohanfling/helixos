import type { LegalPage } from "@/lib/engine/legal";

/**
 * One page's body, Scriba's HTML as written (docs/legal, through the generated src/content/legal.ts): no member input is ever
 * in it, so rendering it as markup is rendering our own page. The ids inside it are the anchors other pages link to.
 */
export function LegalArticle({ page }: { page: LegalPage }) {
  return <article data-testid={`legal-${page.slug}`} dangerouslySetInnerHTML={{ __html: page.html }} />;
}
