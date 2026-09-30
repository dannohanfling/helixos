/**
 * One exercise's history (B2): a single line of the top set per session, in HumanOS's cyan. One series, so no legend (the card's
 * title names it); a 2px line, 8px markers ringed in the surface, recessive grid with its two values, a hover title on every
 * point with a hit target bigger than the mark, the latest value labelled. The session list below the chart is its table view.
 */
export type TrendPoint = { date: string; value: number; label: string };

function niceStep(range: number): number {
  const raw = range / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function TrendLine({ points, unit, name }: { points: TrendPoint[]; unit: string; name: string }) {
  if (points.length < 2) return <p className="text-sm text-ink-2" data-testid="trend-few">The chart starts with a second session.</p>;
  // Drawn near phone width so its text reads at 1:1 there; capped in height on wider screens.
  const w = 360;
  const h = 170;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 22;
  const values = points.map((p) => p.value);
  const step = niceStep(Math.max(...values) - Math.min(...values) || Math.max(...values) || 1);
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.max(lo + step, Math.ceil(Math.max(...values) / step) * step);
  const x = (i: number) => padL + (i * (w - padL - padR)) / (points.length - 1);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const fmtDate = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto max-h-72 w-full" role="img" aria-label={`${name}: top set per session, ${fmt(points[0].value)} to ${fmt(last.value)} ${unit}`} data-testid="trend-line">
      {[lo, hi].map((v) => (
        <g key={v}>
          <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
          <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
            {fmt(v)}
          </text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--humanos)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.date} data-testid="trend-point">
          <circle cx={x(i)} cy={y(p.value)} r={4} fill="var(--humanos)" stroke="var(--surface)" strokeWidth={2} />
          <circle cx={x(i)} cy={y(p.value)} r={12} fill="transparent">
            <title>{`${fmtDate(p.date)}: ${p.label}`}</title>
          </circle>
        </g>
      ))}
      <text x={x(points.length - 1)} y={y(last.value) - 10} textAnchor="end" fontSize={11} fill="var(--ink-2)">
        {fmt(last.value)} {unit}
      </text>
      <text x={padL} y={h - 4} fontSize={10} fill="var(--ink-3)">
        {fmtDate(points[0].date)}
      </text>
      <text x={w - padR} y={h - 4} textAnchor="end" fontSize={10} fill="var(--ink-3)">
        {fmtDate(last.date)}
      </text>
    </svg>
  );
}
