/** Small, dependency-free SVG charts. Single hue, thin marks, recessive axes, hover titles, table fallback. */

export function BarChart({
  data,
  height = 160,
  valueLabel,
  highlightIndex,
}: {
  data: { label: string; value: number; sub?: string }[];
  height?: number;
  valueLabel: string;
  highlightIndex?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = niceMax(max);
  const w = 600;
  const padL = 0;
  const slot = w / data.length;
  const barW = Math.min(24, slot * 0.6);
  const plotH = height - 8;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} className="h-auto w-full" role="img" aria-label={`${valueLabel} by period`}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={padL} x2={w} y1={plotH - plotH * f} y2={plotH - plotH * f} stroke="var(--line)" strokeWidth={1} />
        ))}
        {data.map((d, i) => {
          const h = (d.value / nice) * plotH;
          const x = i * slot + (slot - barW) / 2;
          const y = plotH - h;
          const isHi = highlightIndex === i;
          const title = `${d.label}: ${d.value} ${valueLabel}${d.sub ? ` · ${d.sub}` : ""}`;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barW} height={h} rx={4} fill={isHi ? "var(--accent)" : "var(--series-1)"}>
                <title>{title}</title>
              </rect>
              {h > 4 ? <rect x={x} y={plotH - Math.min(4, h)} width={barW} height={Math.min(4, h)} fill={isHi ? "var(--accent)" : "var(--series-1)"} /> : null}
              {d.value > 0 && (isHi || i === data.length - 1) ? (
                <text x={x + barW / 2} y={Math.max(10, y - 4)} textAnchor="middle" fontSize={11} fill="var(--ink-2)">
                  {d.value}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={padL} x2={w} y1={plotH} y2={plotH} stroke="var(--line)" strokeWidth={1} />
      </svg>
      <div className="grid text-center text-[10px] text-ink-3" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
        {data.map((d) => (
          <span key={d.label} className="truncate">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function niceMax(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${i * step},${height - (v / max) * (height - 4) - 2}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--series-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={(values.length - 1) * step} cy={height - (last / max) * (height - 4) - 2} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

/** GitHub-style weekday heat calendar. Sequential single hue. */
export function StreakCalendar({ weeks, labelFor }: { weeks: { monday: string; days: { date: string; level: 0 | 1 | 2 | 3; title: string }[] }[]; labelFor: (monday: string) => string }) {
  const shade = ["var(--surface-2)", "color-mix(in oklab, var(--good) 35%, var(--surface))", "color-mix(in oklab, var(--good) 65%, var(--surface))", "var(--good)"];
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-1" style={{ gridTemplateColumns: `auto repeat(${weeks.length}, 14px)` }}>
        {["M", "T", "W", "T", "F"].map((d, r) => (
          <div key={d + r} className="contents">
            <div className="pr-1 text-[10px] leading-[14px] text-ink-3">{d}</div>
            {weeks.map((w) => {
              const day = w.days[r];
              return <div key={w.monday + r} title={day?.title} className="h-3.5 w-3.5 rounded-sm" style={{ background: shade[day?.level ?? 0] }} />;
            })}
          </div>
        ))}
        <div />
        {weeks.map((w) => (
          <div key={w.monday} className="text-[9px] text-ink-3">
            {labelFor(w.monday)}
          </div>
        ))}
      </div>
    </div>
  );
}
