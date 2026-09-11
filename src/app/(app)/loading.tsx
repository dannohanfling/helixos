/**
 * What a client sees the instant they tap a link, while the next page renders: the shape of a page, not a blank. The
 * shell (nav, bars) stays put; only the content area shows this.
 */
import { AppLogo } from "@/components/brand-logo";

export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" role="status" aria-live="polite" aria-label="Loading" data-testid="page-loading">
      <div className="flex justify-center py-2">
        <AppLogo size={96} className="opacity-70" />
      </div>
      <div className="h-7 w-48 rounded-md bg-surface-2" />
      <div className="h-4 w-72 max-w-full rounded-md bg-surface-2" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="h-4 w-32 rounded-md bg-surface-2" />
            <div className="h-3 w-full rounded-md bg-surface-2" />
            <div className="h-3 w-5/6 rounded-md bg-surface-2" />
            <div className="h-8 w-28 rounded-md bg-surface-2" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
