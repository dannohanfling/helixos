import type { ReactNode } from "react";

/** Every page of the section carries Danno's attribution as its foot, word for word. */
export default function SocratesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <p className="mt-10 border-t pt-4 text-[11px] leading-relaxed text-ink-3" data-testid="socrates-attribution">
        I paid for and studied Jeremy Miner&apos;s NEPQ and Matt Ryder&apos;s Sales Sniper. SocratesOS is my own framework, built from what they taught me. Where a specific idea is someone else&apos;s — like Alex Hormozi&apos;s &quot;shoulder to shoulder&quot; — it&apos;s credited where it appears.
      </p>
    </>
  );
}
