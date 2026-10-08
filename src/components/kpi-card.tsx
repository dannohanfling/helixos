import { KPI_PERIODS } from "@/db/schema";
import { archiveKpiAction, createKpiAction, logKpiValueAction, updateKpiAction } from "@/lib/actions/kpi";
import { PACE_LABEL, PACE_TONE, formatKpi, weeklySeries, type KpiRead, type ValueRow } from "@/lib/engine/kpi";
import { TARGET_METRICS } from "@/lib/engine/targets";
import { formatDate } from "@/lib/dates";
import { Badge, Card, Disclosure, Field } from "@/components/ui";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SubmitButton } from "@/components/submit-button";

export const PERIOD_LABEL: Record<(typeof KPI_PERIODS)[number], string> = { week: "This week", month: "This month", quarter: "This quarter", year: "This year", range: "Its own dates" };
export const SOURCE_LABEL = { numbers: "Read from my Numbers", manual: "I type it in", close: "Ask me in the evening close" } as const;

/**
 * Business goals BG2: the record's KPIs. Each one reads its actual against its target with pace (linear across the period),
 * a weekly chart of the actual against the straight target line, a value box for the typed and close-asked ones, and
 * Archive. Below, the form for a new KPI with its source.
 */
export function KpiCard({ recordId, reads, logs, values, today, error }: { recordId: string; reads: KpiRead[]; logs: readonly ({ date: string } & Record<string, unknown>)[]; values: readonly ValueRow[]; today: string; error?: string }) {
  const own = reads.filter((r) => r.kpi.recordId === recordId);
  return (
    <Card id="kpis" title={`KPIs · ${own.length}`} action={<span className="text-xs text-ink-3">what proves this is moving</span>}>
      {error ? (
        <p className="mb-2 rounded-lg border border-danger bg-danger-soft p-2 text-sm" role="alert" data-testid="kpi-error">
          {error}
        </p>
      ) : null}
      {own.length ? (
        <ul className="divide-y" data-testid="kpi-list">
          {own.map((r) => (
            <li key={r.kpi.id} className="py-3" data-testid="kpi-row" data-pace={r.pace}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium" data-testid="kpi-name">{r.kpi.name}</span>
                  <Badge tone={PACE_TONE[r.pace]}>{PACE_LABEL[r.pace]}</Badge>
                  <span className="text-xs text-ink-3">{PERIOD_LABEL[r.kpi.period]}{r.kpi.period === "range" && r.kpi.periodStart ? ` (${formatDate(r.window.from)} to ${formatDate(r.window.to)})` : ""} · {SOURCE_LABEL[r.kpi.source].toLowerCase()}{r.kpi.source === "numbers" ? ` (${TARGET_METRICS.find((t) => t.key === r.kpi.metric)?.label ?? r.kpi.metric})` : ""}</span>
                </span>
                <span className="tabular text-sm" data-testid="kpi-actual">
                  {formatKpi(r.actual, r.kpi.unit)} / {formatKpi(r.kpi.target, r.kpi.unit)}
                  {r.kpi.target > 0 && r.pace !== "done" ? <span className="ml-1 text-xs text-ink-3">({formatKpi(r.expected, r.kpi.unit)} due by today)</span> : null}
                </span>
              </div>
              <Chart points={weeklySeries(r.kpi, r.window, today, logs, values)} target={r.kpi.target} unit={r.kpi.unit} />
              <div className="mt-2 flex flex-wrap items-end gap-2">
                {r.kpi.source !== "numbers" ? (
                  <form action={logKpiValueAction} className="flex items-end gap-2" data-testid="kpi-log">
                    <input type="hidden" name="kpiId" value={r.kpi.id} />
                    <Field label="Log a value">
                      <input className="field tabular w-28" name="value" inputMode="decimal" placeholder="0" data-testid="kpi-value" />
                    </Field>
                    <Field label="On">
                      <input className="field" name="date" type="date" defaultValue={today} max={today} />
                    </Field>
                    <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="kpi-log-save">Save</SubmitButton>
                  </form>
                ) : (
                  <span className="text-xs text-ink-3">Summed from your evening closes; nothing to type twice.</span>
                )}
                <Disclosure summary={<span className="btn btn-ghost btn-xs">Edit</span>} className="ml-auto">
                  <form action={updateKpiAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={r.kpi.id} />
                    <Field label="Name">
                      <input className="field" name="name" defaultValue={r.kpi.name} />
                    </Field>
                    <Field label="Target">
                      <input className="field tabular w-28" name="target" defaultValue={r.kpi.target} inputMode="decimal" data-testid="kpi-edit-target" />
                    </Field>
                    <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…" data-testid="kpi-edit-save">Save</SubmitButton>
                  </form>
                  <form action={archiveKpiAction} className="mt-2 text-right">
                    <input type="hidden" name="id" value={r.kpi.id} />
                    <ConfirmDelete what={`the KPI "${r.kpi.name}"`} undo="It comes off this record, the tree and the close; its values stay." label="Archive" className="btn btn-ghost btn-xs text-danger" testId="kpi-archive" />
                  </form>
                </Disclosure>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-2">No KPIs yet. Add the number that would prove this is moving: calls booked, cash collected, show-ups.</p>
      )}
      <Disclosure open={Boolean(error)} summary={<span className="btn btn-soft btn-sm mt-3" data-testid="kpi-new">+ New KPI</span>}>
        <form action={createKpiAction} className="mt-2 grid gap-3 sm:grid-cols-3" data-testid="kpi-form">
          <input type="hidden" name="recordId" value={recordId} />
          <div className="sm:col-span-2">
            <Field label="Name">
              <input className="field" name="name" placeholder="Calls booked" required data-testid="kpi-form-name" />
            </Field>
          </div>
          <Field label="Target">
            <input className="field tabular" name="target" placeholder="12" inputMode="decimal" required data-testid="kpi-form-target" />
          </Field>
          <Field label="Where the number comes from">
            <select className="field" name="source" defaultValue="numbers" data-testid="kpi-form-source">
              {(Object.keys(SOURCE_LABEL) as (keyof typeof SOURCE_LABEL)[]).map((k) => (
                <option key={k} value={k}>{SOURCE_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Which number (from my Numbers)" hint="For a KPI read from your Numbers; the unit follows it.">
            <select className="field" name="metric" defaultValue="callsBooked" data-testid="kpi-form-metric">
              {TARGET_METRICS.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Unit" hint="For a typed or close-asked KPI: $, %, count, or a word.">
            <input className="field" name="unit" placeholder="count" data-testid="kpi-form-unit" />
          </Field>
          <Field label="Period">
            <select className="field" name="period" defaultValue="month" data-testid="kpi-form-period">
              {KPI_PERIODS.map((k) => (
                <option key={k} value={k}>{PERIOD_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="From (own dates only)">
            <input className="field" name="periodStart" type="date" />
          </Field>
          <Field label="To (own dates only)">
            <input className="field" name="periodEnd" type="date" />
          </Field>
          <div className="sm:col-span-3">
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…" data-testid="kpi-form-save">Add KPI</SubmitButton>
          </div>
        </form>
      </Disclosure>
    </Card>
  );
}

/** The weekly chart: the actual, cumulative, against the straight target line; weeks still to come are hollow. */
function Chart({ points, target, unit }: { points: { week: string; actual: number; target: number; future: boolean }[]; target: number; unit: string }) {
  if (points.length < 2) return null;
  const W = 320;
  const H = 72;
  const pad = 6;
  const top = Math.max(target, ...points.map((p) => p.actual), 1);
  const x = (i: number) => pad + (i * (W - pad * 2)) / (points.length - 1);
  const y = (v: number) => H - pad - (Math.min(v, top) / top) * (H - pad * 2);
  const done = points.filter((p) => !p.future);
  const actualPath = done.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.actual).toFixed(1)}`).join(" ");
  const targetPath = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.target).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-18 w-full max-w-sm" role="img" aria-label={`By week: ${done.map((p) => `${formatDate(p.week)} ${formatKpi(p.actual, unit)}`).join(", ")}; target ${formatKpi(target, unit)}`} data-testid="kpi-chart">
      <path d={targetPath} fill="none" stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="3 3" />
      {actualPath ? <path d={actualPath} fill="none" stroke="var(--accent)" strokeWidth="2" /> : null}
      {points.map((p, i) => (
        <circle key={p.week} cx={x(i)} cy={y(p.future ? p.target : p.actual)} r="2.5" fill={p.future ? "var(--surface)" : "var(--accent)"} stroke={p.future ? "var(--ink-3)" : "var(--accent)"} />
      ))}
    </svg>
  );
}
