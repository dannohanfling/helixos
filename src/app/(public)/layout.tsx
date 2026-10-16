import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./legal.css";
import { legalSans, legalSerif } from "./fonts";
import { LegalNav } from "./legal-nav";

/**
 * The six public pages (H-331): anyone can open them without signing in (the proxy lists them as public), search engines may
 * index them (robots.ts allows exactly these), and they wear Scriba's page design: golden hour by default, night under
 * prefers-color-scheme: dark, readable at 390. The copy is docs/legal/*.html, word for word, through src/content/legal.ts.
 */
export const metadata: Metadata = { robots: { index: true, follow: true } };

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`lg ${legalSerif.variable} ${legalSans.variable}`} data-testid="legal-page">
      <header className="site">
        <div className="wrap">
          <Link className="brand" href="/">
            Helix<span>OS</span>
          </Link>
          <LegalNav />
        </div>
      </header>
      <main>
        <div className="wrap">{children}</div>
      </main>
      <footer className="site">
        <div className="wrap">
          <span>HelixOS is operated by Eye To Eye Media LLC (Evolve Omega).</span>
          <span>
            <a href="mailto:danno@evolveomega.com">danno@evolveomega.com</a> · <a href="tel:+12068984249">(206) 898-4249</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
