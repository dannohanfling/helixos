/**
 * What shows the instant a page is asked for, while its data loads (H-1674): grey blocks shaped like that page, with the
 * shared gleam (.skel in globals.css). No data, no reads, and sized like the real content so nothing jumps when it lands.
 * Every shape keeps data-testid="page-loading", which the walks wait on.
 */
export type SkeletonShape = "cards" | "list" | "today" | "scene" | "table";

export function Skel({ className = "" }: { className?: string }) {
  return <div className={`skel ${className}`} aria-hidden="true" />;
}

function Rows({ n, avatar = true }: { n: number; avatar?: boolean }) {
  return (
    <div className="card divide-y divide-line p-0">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {avatar ? <Skel className="h-9 w-9 shrink-0 rounded-full" /> : null}
          <div className="min-w-0 flex-1 space-y-2">
            <Skel className="h-3.5 w-2/5" />
            <Skel className="h-3 w-4/5" />
          </div>
          <Skel className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function Cards({ n }: { n: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card space-y-3 p-5">
          <Skel className="h-4 w-32" />
          <Skel className="h-3 w-full" />
          <Skel className="h-3 w-5/6" />
          <Skel className="h-8 w-28 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({ shape = "cards" }: { shape?: SkeletonShape }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading" data-testid="page-loading" data-shape={shape}>
      <Skel className="h-7 w-48" />
      <Skel className="h-4 w-72 max-w-full" />
      {shape === "list" ? <Rows n={6} /> : null}
      {shape === "cards" ? <Cards n={4} /> : null}
      {shape === "table" ? <Rows n={8} avatar={false} /> : null}
      {shape === "scene" ? (
        <>
          <Skel className="aspect-[1680/944] w-full rounded-2xl" />
          <Cards n={2} />
        </>
      ) : null}
      {shape === "today" ? (
        <>
          <div className="card space-y-3 p-5">
            <Skel className="h-5 w-40" />
            <Skel className="h-3 w-full" />
            <Skel className="h-3 w-3/4" />
            <Skel className="h-10 w-36 rounded-lg" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card space-y-2 p-4">
                <Skel className="h-3 w-12" />
                <Skel className="h-6 w-16" />
              </div>
            ))}
          </div>
          <Rows n={3} avatar={false} />
        </>
      ) : null}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
