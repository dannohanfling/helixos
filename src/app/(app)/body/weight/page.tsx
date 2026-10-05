import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card, Disclosure } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmDelete } from "@/components/confirm-delete";
import { HumanosHeader } from "@/components/body/humanos-header";
import { ScaleImport } from "@/components/body/scale-import";
import { TrendLine } from "@/components/body/trend-line";
import { formatDate } from "@/lib/dates";
import { METRICS, displayValue, fmtMetric, unitLabel, withDerived, type MetricKey } from "@/lib/engine/body-scale";
import { requireBodyEnabled, weighIns, type WeighInsView } from "@/lib/queries/body";
import { deleteReadingAction, importScaleCsvAction, logWeighInAction, setBodyGoalAction } from "@/lib/actions/body";

export const metadata = { title: "HumanOS · Weigh-ins" };

const RANGES: { key: string; days: number | null; label: string }[] = [
  { key: "30", days: 30, label: "30 days" },
  { key: "90", days: 90, label: "90 days" },
  { key: "365", days: 365, label: "A year" },
  { key: "all", days: null, label: "All" },
];

const big = "field py-2 text-base tabular sm:py-1 sm:text-sm";

/** One metric's card: the numbers it leads with, then the chart with the 7-day average and the goal. */
function TrendCard({ card, unit, today }: { card: WeighInsView["cards"][number]; unit: "lb" | "kg"; today: string }) {
  const { metric, stats, goal } = card;
  const points = card.points.map((p) => ({ date: p.date, value: displayValue(metric.key, p.value, unit), label: fmtMetric(metric.key, p.value, unit) }));
  const average = card.average.map((a) => (a == null ? null : displayValue(metric.key, a, unit)));
  const sign = (n: number) => (n > 0 ? "▲ +" : n < 0 ? "▼ " : "") + fmtMetric(metric.key, Math.abs(n), unit).replace(/^/, n < 0 ? "−" : "");
  return (
    <Card title={metric.label} data-testid="trend-card" id={`trend-${metric.key}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" data-testid={`trend-${metric.key}-stats`}>
        {stats.latest ? (
          <span>
            <span className="text-lg font-semibold tabular text-humanos-ink">{fmtMetric(metric.key, stats.latest.value, unit)}</span>
            <span className="text-xs text-ink-3"> {stats.latest.date === today ? "today" : formatDate(stats.latest.date)}</span>
          </span>
        ) : null}
        {stats.avg7 != null ? (
          <span className="tabular text-ink-2">
            7-day avg <b className="text-ink">{fmtMetric(metric.key, stats.avg7, unit)}</b>
          </span>
        ) : null}
        {stats.change7 != null ? <span className={`tabular ${stats.change7 === 0 ? "text-ink-3" : "text-ink-2"}`}>{sign(stats.change7)} vs last week</span> : null}
        {goal ? (
          <span className="tabular text-ink-2" data-testid={`trend-${metric.key}-goal`}>
            goal <b className="text-ink">{fmtMetric(metric.key, goal.target, unit)}</b>
            {goal.by ? ` by ${formatDate(goal.by)}` : ""}
          </span>
        ) : null}
      </div>
      <TrendLine points={points} unit={unitLabel(metric.key, unit)} name={metric.label} average={average} goal={goal ? displayValue(metric.key, goal.target, unit) : null} few="The chart starts with a second day." />
      <Disclosure summary={<span className="text-xs text-ink-3 underline">{goal ? "Change the goal" : "Set a goal"}</span>} className="mt-2">
        <form action={setBodyGoalAction} className="flex flex-wrap items-end gap-2" data-testid={`goal-${metric.key}`}>
          <input type="hidden" name="key" value={metric.key} />
          <label className="w-24">
            <span className="label">Target {unitLabel(metric.key, unit) ? `(${unitLabel(metric.key, unit)})` : ""}</span>
            <input name="target" type="text" autoComplete="off" inputMode="decimal" className="field py-1 text-sm tabular" defaultValue={goal ? displayValue(metric.key, goal.target, unit) : ""} placeholder="none" />
          </label>
          <label className="w-36">
            <span className="label">By</span>
            <input name="by" type="date" className="field py-1 text-sm" defaultValue={goal?.by ?? ""} />
          </label>
          <SubmitButton className="btn btn-soft btn-sm" pendingText="Saving…">
            Save
          </SubmitButton>
        </form>
        <p className="mt-1 text-xs text-ink-3">A goal draws a line on this chart. Leave the target blank to clear it.</p>
      </Disclosure>
    </Card>
  );
}

export default async function WeighInsPage({ searchParams }: { searchParams: Promise<{ range?: string; error?: string; imported?: string; already?: string; filled?: string; bad?: string; logged?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const sp = await searchParams;
  const range = RANGES.find((r) => r.key === sp.range) ?? RANGES[1];
  const w = await weighIns(v.workspace.id, v.user.id, v.today, range.days);
  if (!w) redirect("/body");
  const unit = w.unit;
  const latest = w.latest;
  const weightCard = w.cards.find((c) => c.metric.key === "weight")!;
  const cards = w.cards.filter((c) => c.points.length);

  return (
    <>
      <HumanosHeader title="Weigh-ins" subtitle="Your weight and what the scale says with it. The day's figure is its lowest reading, kept whole." action={<span className="flex items-center gap-2"><Link href="/body/import" className="text-xs text-ink-2 hover:underline" data-testid="weight-import-link">From Airtable</Link><Link href="/body" className="btn btn-ghost btn-sm">← Log</Link></span>} />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" role="alert" data-testid="body-error">
          {sp.error}
        </p>
      ) : null}
      {sp.imported != null ? (
        <p className="mb-4 rounded-xl border p-3 text-sm" role="status" data-testid="scale-imported" data-imported={sp.imported} data-already={sp.already ?? "0"}>
          Imported {sp.imported} reading{sp.imported === "1" ? "" : "s"}
          {Number(sp.already) ? `, ${sp.already} already in` : ""}
          {Number(sp.filled) ? ` (${sp.filled} of them filled in with numbers they didn't have)` : ""}
          {Number(sp.bad) ? `, ${sp.bad} row${sp.bad === "1" ? "" : "s"} the file couldn't be read from` : ""}.
        </p>
      ) : null}

      <section className="card mb-4 border-l-4 border-l-humanos p-4" data-testid="weigh-lead">
        {latest ? (
          <>
            <p className="text-2xl font-semibold tabular text-humanos-ink" data-testid="weigh-latest">
              {latest.values.weight != null ? fmtMetric("weight", latest.values.weight, unit) : "—"}
              {latest.values.bf != null ? <span className="text-base font-medium text-ink-2"> · {fmtMetric("bf", latest.values.bf, unit)} body fat</span> : null}
            </p>
            <p className="mt-1 text-sm text-ink-2">
              {latest.date === v.today ? "Today" : formatDate(latest.date, { weekday: "short", month: "short", day: "numeric" })}
              {latest.time ? ` at ${latest.time}` : ""}
              {latest.values.ffm != null ? ` · ${fmtMetric("ffm", latest.values.ffm, unit)} fat-free` : ""}
              {weightCard.stats.avg7 != null ? ` · 7-day average ${fmtMetric("weight", weightCard.stats.avg7, unit)}` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-2" data-testid="weigh-empty">
            No weigh-ins yet. Log one below, or import your RENPHO export.
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Log a weigh-in" id="log">
          <form action={logWeighInAction} className="space-y-2" data-testid="weigh-form">
            <div className="flex flex-wrap items-end gap-2">
              <label className="w-36">
                <span className="label">Day</span>
                <input name="date" type="date" defaultValue={v.today} max={v.today} className={big} required />
              </label>
              <label className="w-24">
                <span className="label">Weight ({unit})</span>
                <input name="weight" type="text" autoComplete="off" inputMode="decimal" className={big} required data-testid="weigh-weight" />
              </label>
              <label className="w-24">
                <span className="label">Body fat %</span>
                <input name="bf" type="text" autoComplete="off" inputMode="decimal" className={big} placeholder="—" data-testid="weigh-bf" />
              </label>
              <SubmitButton className="btn btn-humanos" pendingText="Saving…" data-testid="weigh-save">
                Save
              </SubmitButton>
            </div>
            <Disclosure summary={<span className="text-xs text-ink-3 underline">More from the scale</span>}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="w-28">
                  <span className="label">Time</span>
                  <input name="time" type="time" className={big} />
                </label>
                {(["smm_pct", "water", "visceral", "bmr", "met_age", "ffm"] as MetricKey[]).map((k) => (
                  <label key={k} className="w-28">
                    <span className="label">
                      {METRICS.find((m) => m.key === k)!.short} {unitLabel(k, unit) ? `(${unitLabel(k, unit)})` : ""}
                    </span>
                    <input name={k} type="text" autoComplete="off" inputMode="decimal" className={big} placeholder="—" />
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-3">Fat-free mass is worked out from weight and body fat when you leave it blank.</p>
            </Disclosure>
          </form>
        </Card>

        <Card title="Import from RENPHO" id="import">
          <ScaleImport action={importScaleCsvAction} />
          <p className="mt-2 text-xs text-ink-3">In the RENPHO app, export your data as a CSV (both the older and the newer layout work). Readings already here are skipped, so you can import the whole export each time.</p>
        </Card>
      </div>

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Trends</h2>
        <div className="flex gap-1 text-xs" data-testid="weigh-range">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/body/weight?range=${r.key}`} className={`rounded-full px-2.5 py-1 ${r.key === range.key ? "bg-humanos-soft font-semibold text-humanos-ink" : "text-ink-2 hover:bg-surface-2"}`} aria-current={r.key === range.key ? "page" : undefined}>
              {r.label}
            </Link>
          ))}
        </div>
      </div>
      {cards.length ? (
        <div className="grid gap-4 md:grid-cols-2" data-testid="trend-cards" data-count={cards.length}>
          {cards.map((c) => (
            <TrendCard key={c.metric.key} card={c} unit={unit} today={v.today} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-2" data-testid="trend-none">
          {w.count ? `Nothing in the last ${range.label.toLowerCase()}. ` : ""}
          {w.count ? (
            <Link href="/body/weight?range=all" className="underline">
              Show everything
            </Link>
          ) : (
            "The trend cards fill in as you log."
          )}
        </p>
      )}

      <Card className="mt-4" title={`Readings${w.count > w.readings.length ? ` · last ${w.readings.length} of ${w.count}` : ""}`} id="readings">
        {w.readings.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="weigh-readings">
              <thead className="text-left text-xs text-ink-3">
                <tr>
                  <th className="py-1 pr-2 font-medium">Day</th>
                  <th className="py-1 pr-2 font-medium">Time</th>
                  <th className="py-1 pr-2 text-right font-medium">Weight</th>
                  <th className="py-1 pr-2 text-right font-medium">Body fat</th>
                  <th className="hidden py-1 pr-2 text-right font-medium sm:table-cell">Fat-free</th>
                  <th className="py-1 pr-2 font-medium">From</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {w.readings.map((r) => (
                  <Fragment key={r.readingId}>
                  <tr className="border-t" data-testid="weigh-reading" data-date={r.date} data-source={r.source}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(r.date, { month: "short", day: "numeric" })}</td>
                    <td className="py-1.5 pr-2 tabular text-ink-3">{r.time ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular whitespace-nowrap">{r.values.weight != null ? fmtMetric("weight", r.values.weight, unit) : "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular">{r.values.bf != null ? fmtMetric("bf", r.values.bf, unit) : "—"}</td>
                    <td className="hidden py-1.5 pr-2 text-right tabular sm:table-cell">{r.values.ffm != null ? fmtMetric("ffm", r.values.ffm, unit) : "—"}</td>
                    <td className="py-1.5 pr-2 text-xs text-ink-3">{r.source === "renpho" ? "RENPHO" : r.source === "manual" ? "typed" : r.source === "health" ? "Apple Health" : r.source}</td>
                    <td className="py-1.5 text-right">
                      <form action={deleteReadingAction}>
                        <input type="hidden" name="id" value={r.readingId} />
                        <ConfirmDelete what={`the reading of ${formatDate(r.date)}${r.time ? ` at ${r.time}` : ""}`} undo="Log or import it again any time." label="✕" title="Delete reading" className="btn btn-ghost btn-xs" testId="weigh-delete" />
                      </form>
                    </td>
                  </tr>
                  {/* Every number the reading holds (rev 476): the list shows three; opening it shows the rest, fat-free and fat mass worked out when the scale didn't say. */}
                  <tr data-testid="weigh-reading-more" data-reading={r.readingId}>
                    <td colSpan={7} className="pb-2">
                      <details>
                        <summary className="cursor-pointer text-xs text-ink-3 underline">Every number ({Object.keys(withDerived(r.values)).length})</summary>
                        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
                          {METRICS.filter((m) => withDerived(r.values)[m.key] != null).map((m) => (
                            <div key={m.key} className="flex justify-between gap-2" data-testid="weigh-reading-value" data-key={m.key}>
                              <dt className="text-ink-3">{m.label}</dt>
                              <dd className="tabular">
                                {fmtMetric(m.key, withDerived(r.values)[m.key]!, unit)}
                                {r.values[m.key] == null ? <span className="text-ink-3"> (worked out)</span> : null}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-2">Nothing yet.</p>
        )}
      </Card>
    </>
  );
}
