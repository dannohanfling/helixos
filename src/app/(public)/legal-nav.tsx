"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEGAL_NAV } from "@/lib/engine/legal";

/** The header's six links, the current page marked for the eye and the screen reader. */
export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav className="site" aria-label="Legal and support" data-testid="legal-nav">
      {LEGAL_NAV.map((n) => (
        <Link key={n.slug} href={`/${n.slug}`} aria-current={pathname === `/${n.slug}` ? "page" : undefined}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
