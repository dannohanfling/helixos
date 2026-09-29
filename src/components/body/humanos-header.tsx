/**
 * The header of every HumanOS page (rev 238): the "HumanOS" eyebrow in its cyan, the page's own title, and a gear to HumanOS
 * settings on the right, so settings are one tap from anywhere in the space without taking a menu slot.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export function HumanosHeader({ title, subtitle, action, gear = true }: { title: string; subtitle?: ReactNode; action?: ReactNode; gear?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-humanos" data-testid="humanos-eyebrow">
          HumanOS
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {action}
        {gear ? (
          <Link href="/body/settings" className="btn btn-ghost btn-sm text-base" aria-label="HumanOS settings" title="HumanOS settings" data-testid="humanos-gear">
            ⚙️
          </Link>
        ) : null}
      </div>
    </div>
  );
}
