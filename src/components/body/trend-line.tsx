/**
 * One metric over time (B2's exercise history, the Weigh-ins trend cards): a single line in HumanOS's cyan, a 2px line, 8px
 * markers ringed in the surface while there are few enough points to read them, a recessive grid with its two values, a hover
 * title on every point with a hit target bigger than the mark, and the latest value labelled. Optional: a dashed 7-day average
 * in muted ink, and a dotted goal line, each named in a small legend below, so nothing is identified by colour alone. The list
 * under each chart is its table view.
 */
export type TrendPoint = { date: string; value: number; label: string };

function niceStep(range: number): number {
  const raw = range / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function TrendLine({ points, unit, name, average, goal, few = "The chart starts with a second session." }: { points: TrendPoint[]; unit: string; name: string; /** Aligned to points; null where there's no average yet. */ average?: (number | null)[]; goal?: number | null; few?: string }) {
  if (points.length < 2)
    return (
      <p className="text-sm text-ink-2" data-testid="trend-few">
        {few}
      </p>
    );
  // Drawn near phone width so its text reads at 1:1 there; capped in height on wider screens.
  const w = 360;
  const h = 170;
  const padL = 40;
  const padR = 16;
  const padT = 18;
  const padB = 22;
  const values = [...points.map((p) => p.value), ...(average?.filter((a): a is number => a != null) ?? []), ...(goal != null ? [goal] : [])];
  const step = niceStep(Math.max(...values) - Math.min(...values) || Math.max(...values) || 1);
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.max(lo + step, Math.ceil(Math.max(...values) / step) * step);
  const x = (i: number) => padL + (i * (w - padL - padR)) / (points.length - 1);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  // A gap (null) ends a segment and the next value starts a new one.
  const path = (vals: (number | null)[]): string => {
    let d = "";
    vals.forEach((v, i) => {
      if (v == null) return;
      d += `${i === 0 || vals[i - 1] == null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const fmtDate = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const last = points[points.length - 1];
  const markers = points.length <= 60;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto max-h-72 w-full" role="img" aria-label={`${name}: ${fmt(points[0].value)} to ${fmt(last.value)} ${unit}${goal != null ? `, goal ${fmt(goal)}` : ""}`} data-testid="trend-line">
        {[lo, hi].map((v) => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
              {fmt(v)}
            </text>
          </g>
        ))}
        {goal != null ? (
          <g data-testid="trend-goal">
            <line x1={padL} x2={w - padR} y1={y(goal)} y2={y(goal)} stroke="var(--humanos-ink)" strokeWidth={1.5} strokeDasharray="2 4" />
            <text x={w - padR} y={y(goal) - 4} textAnchor="end" fontSize={10} fill="var(--ink-2)">
              goal {fmt(goal)}
            </text>
          </g>
        ) : null}
        {average?.some((a) => a != null) ? <path d={path(average)} fill="none" stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" data-testid="trend-avg" /> : null}
        <path d={path(points.map((p) => p.value))} fill="none" stroke="var(--humanos)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.date} data-testid="trend-point">
            {markers ? <circle cx={x(i)} cy={y(p.value)} r={4} fill="var(--humanos)" stroke="var(--surface)" strokeWidth={2} /> : null}
            <circle cx={x(i)} cy={y(p.value)} r={12} fill="transparent">
              <title>{`${fmtDate(p.date)}: ${p.label}${average?.[i] != null ? ` · 7-day avg ${fmt(average[i]!)}` : ""}`}</title>
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
      {average?.some((a) => a != null) || goal != null ? (
        <p className="mt-1 flex flex-wrap gap-3 text-[11px] text-ink-3">
          <span>
            <span className="mr-1 inline-block h-0.5 w-4 bg-humanos align-middle" /> daily
          </span>
          {average?.some((a) => a != null) ? (
            <span>
              <span className="mr-1 inline-block w-4 border-t-2 border-dashed border-ink-3 align-middle" /> 7-day average
            </span>
          ) : null}
          {goal != null ? (
            <span>
              <span className="mr-1 inline-block w-4 border-t-2 border-dotted border-humanos-ink align-middle" /> goal
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
