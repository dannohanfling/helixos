/**
 * The correlation explorer's two pictures (B10, rev 231), hand-rolled SVG like the trend line: a dual-axis timeline, metric A in
 * HumanOS's cyan on the left axis and metric B in muted ink dashed on the right, each named in a legend; and a scatter of the
 * paired values with a hover title on every dot. Nothing is identified by colour alone.
 */
import type { Point } from "@/lib/engine/body-correlate";

const W = 640;
const H = 220;
const PAD = { l: 44, r: 44, t: 12, b: 28 };

function scale(values: number[]): { lo: number; hi: number } {
  if (!values.length) return { lo: 0, hi: 1 };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const padBy = (hi - lo) * 0.08;
  return { lo: lo - padBy, hi: hi + padBy };
}
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 });

export function DualLine({ a, b, labelA, labelB, from, to }: { a: Point[]; b: Point[]; labelA: string; labelB: string; from: string; to: string }) {
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));
  const x = (d: string) => PAD.l + ((Date.parse(d) - Date.parse(from)) / 86400000 / days) * (W - PAD.l - PAD.r);
  const sa = scale(a.map((p) => p.value));
  const sb = scale(b.map((p) => p.value));
  const ya = (v: number) => PAD.t + (1 - (v - sa.lo) / (sa.hi - sa.lo)) * (H - PAD.t - PAD.b);
  const yb = (v: number) => PAD.t + (1 - (v - sb.lo) / (sb.hi - sb.lo)) * (H - PAD.t - PAD.b);
  const path = (pts: Point[], y: (v: number) => number) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  if (!a.length && !b.length) return <p className="text-sm text-ink-2">Nothing logged for either metric in this window.</p>;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${labelA} and ${labelB} over time`} data-testid="pair-timeline" data-a={a.length} data-b={b.length}>
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} className="stroke-ink-4" strokeWidth={1} />
        <text x={PAD.l - 4} y={PAD.t + 4} textAnchor="end" className="fill-ink-3 text-[10px]">
          {fmt(sa.hi)}
        </text>
        <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" className="fill-ink-3 text-[10px]">
          {fmt(sa.lo)}
        </text>
        <text x={W - PAD.r + 4} y={PAD.t + 4} className="fill-ink-3 text-[10px]">
          {fmt(sb.hi)}
        </text>
        <text x={W - PAD.r + 4} y={H - PAD.b} className="fill-ink-3 text-[10px]">
          {fmt(sb.lo)}
        </text>
        <text x={PAD.l} y={H - 8} className="fill-ink-3 text-[10px]">
          {from}
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-ink-3 text-[10px]">
          {to}
        </text>
        {a.length > 1 ? <path d={path(a, ya)} fill="none" className="stroke-humanos" strokeWidth={2} /> : null}
        {b.length > 1 ? <path d={path(b, yb)} fill="none" className="stroke-ink-2" strokeWidth={1.5} strokeDasharray="5 4" /> : null}
        {a.map((p) => (
          <circle key={`a${p.date}`} cx={x(p.date)} cy={ya(p.value)} r={2.5} className="fill-humanos">
            <title>{`${p.date}: ${labelA} ${fmt(p.value)}`}</title>
          </circle>
        ))}
        {b.map((p) => (
          <circle key={`b${p.date}`} cx={x(p.date)} cy={yb(p.value)} r={2.5} className="fill-ink-2">
            <title>{`${p.date}: ${labelB} ${fmt(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-[11px] text-ink-3">
        <span>
          <span className="mr-1 inline-block h-0.5 w-5 align-middle bg-humanos" /> {labelA} (left)
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-5 border-t border-dashed border-ink-2 align-middle" /> {labelB} (right)
        </span>
      </figcaption>
    </figure>
  );
}

export function Scatter({ pairs, labelA, labelB }: { pairs: { date: string; x: number; y: number }[]; labelA: string; labelB: string }) {
  if (pairs.length < 2) return <p className="text-sm text-ink-2">The scatter starts with two pairs.</p>;
  const S = 260;
  const P = { l: 40, r: 10, t: 10, b: 28 };
  const sx = scale(pairs.map((p) => p.x));
  const sy = scale(pairs.map((p) => p.y));
  const x = (v: number) => P.l + ((v - sx.lo) / (sx.hi - sx.lo)) * (S - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - sy.lo) / (sy.hi - sy.lo)) * (S - P.t - P.b);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="mx-auto h-auto w-full max-w-xs" role="img" aria-label={`${labelA} against ${labelB}`} data-testid="pair-scatter" data-n={pairs.length}>
      <line x1={P.l} y1={S - P.b} x2={S - P.r} y2={S - P.b} className="stroke-ink-4" strokeWidth={1} />
      <line x1={P.l} y1={P.t} x2={P.l} y2={S - P.b} className="stroke-ink-4" strokeWidth={1} />
      <text x={S / 2} y={S - 6} textAnchor="middle" className="fill-ink-3 text-[10px]">
        {labelA}
      </text>
      <text x={10} y={S / 2} textAnchor="middle" transform={`rotate(-90 10 ${S / 2})`} className="fill-ink-3 text-[10px]">
        {labelB}
      </text>
      {pairs.map((p) => (
        <circle key={p.date} cx={x(p.x)} cy={y(p.y)} r={3.5} className="fill-humanos opacity-70">
          <title>{`${p.date}: ${labelA} ${fmt(p.x)}, ${labelB} ${fmt(p.y)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
