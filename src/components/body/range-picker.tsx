/**
 * The range picker the Body pages share (rev 237 phase 10b): Week, Month, 90 days, Year as pills, with a step back and forward
 * inside the chosen range and the range's name between them. Links only, so a view can be bookmarked: `?range=month&from=…`.
 */
import Link from "next/link";
import { RANGE_KEYS, RANGE_LABEL, stepRange, type Bounds } from "@/lib/engine/body-range";
import { addDays, startOfWeek } from "@/lib/dates";

export function RangePicker({ path, bounds, today, keys = RANGE_KEYS, extra = {} }: { path: string; bounds: Bounds; today: string; keys?: (typeof RANGE_KEYS)[number][]; extra?: Record<string, string> }) {
  const dates = { addDays, startOfWeek };
  const href = (range: string, from: string | null) => `${path}?${new URLSearchParams({ ...extra, range, ...(from ? { from } : {}) }).toString()}`;
  const back = stepRange(bounds, -1, today, dates);
  const fwd = stepRange(bounds, 1, today, dates);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="range-picker" data-range={bounds.key} data-from={bounds.from} data-to={bounds.to}>
      <div className="flex gap-1 text-xs">
        {keys.map((k) => (
          <Link key={k} href={href(k, null)} className={`rounded-full px-2.5 py-1 ${k === bounds.key ? "bg-humanos-soft font-semibold text-humanos-ink" : "text-ink-2 hover:bg-surface-2"}`} aria-current={k === bounds.key ? "page" : undefined} data-testid={`range-${k}`}>
            {RANGE_LABEL[k]}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-1 text-sm">
        <Link href={href(bounds.key, back)} className="btn btn-ghost btn-sm" aria-label="Earlier">
          ←
        </Link>
        <span className="font-medium" data-testid="range-label">
          {bounds.label}
        </span>
        <Link href={fwd ? href(bounds.key, fwd) : "#"} className={`btn btn-ghost btn-sm ${fwd ? "" : "pointer-events-none opacity-40"}`} aria-label="Later" aria-disabled={!fwd}>
          →
        </Link>
      </div>
    </div>
  );
}
