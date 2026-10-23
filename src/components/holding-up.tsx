import Link from "next/link";

/**
 * "What's holding this up" (rev 850): the blockers a member can clear themself, each with its Fix it link, above whatever they
 * hold up (Ship, the composer). Nothing to show when nothing the member can fix is in the way.
 */
export function HoldingUp({ items }: { items: { what: string; fix: { href: string; label: string } }[] }) {
  if (!items.length) return null;
  // One fix can clear several steps (GoHighLevel holds both posts): each link once, on the first line it clears.
  const first = items.map((it, i) => items.findIndex((x) => x.fix.href === it.fix.href) === i);
  return (
    <div className="mb-3 rounded-lg border border-warn bg-warn-soft p-3 text-sm" data-testid="holding-up">
      <div className="font-semibold">What&apos;s holding this up</div>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={it.what} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1" data-testid="holding-up-item">
            <span className="text-ink-2">{it.what}</span>
            {first[i] ? (
              <Link href={it.fix.href} className="btn btn-ghost btn-sm min-h-11!" data-testid="holding-up-fix">
                {it.fix.label} →
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
