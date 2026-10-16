import Link from "next/link";
import { LEGAL_FOOTER } from "@/lib/engine/legal";

/** The small footer on every page (H-331): Privacy · Terms · Support · Community. */
export function LegalFooter() {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pb-2 text-[11px] text-ink-3" data-testid="legal-footer">
      {LEGAL_FOOTER.map((l, i) => (
        <span key={l.href} className="flex items-center gap-2">
          {i ? <span aria-hidden>·</span> : null}
          <Link href={l.href} className="hover:text-ink hover:underline">
            {l.label}
          </Link>
        </span>
      ))}
    </footer>
  );
}
