import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { TrendLine } from "@/components/body/trend-line";
import { addDays, formatDate } from "@/lib/dates";
import { fmtSet } from "@/lib/engine/body-training";
import { exerciseHistory, requireBodyEnabled } from "@/lib/queries/body";

export const metadata = { title: "HumanOS · Exercise history" };

const SPANS: { key: string; days: number | null; label: string }[] = [
  { key: "90", days: 90, label: "90 days" },
  { key: "365", days: 365, label: "A year" },
  { key: "all", days: null, label: "All" },
];

export default async function ExerciseHistoryPage({ params, searchParams }: { params: Promise<{ exerciseId: string }>; searchParams: Promise<{ range?: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const { exerciseId } = await params;
  const sp = await searchParams;
  const h = await exerciseHistory(v.workspace.id, v.user.id, exerciseId);
  if (!h) notFound();
  const bw = h.exercise.kind === "bodyweight";
  // Longer views (phase 10b): the chart and the list over 90 days, a year or everything.
  const span = SPANS.find((x) => x.key === sp.range) ?? SPANS[2];
  const from = span.days ? addDays(v.today, -(span.days - 1)) : null;
  const inSpan = <T extends { date: string }>(xs: T[]) => (from ? xs.filter((x) => x.date >= from) : xs);
  // Weighted: the top set's weight. Bodyweight: its reps (added weight shows in the label and the list).
  const points = inSpan(h.points).map((p) => ({ date: p.date, value: bw ? p.top.reps : (p.top.weight ?? 0), label: fmtSet({ ...p.top, unit: h.unit }, h.unit, h.exercise.kind) }));
  const sessions = inSpan(h.sessions);
  const top = inSpan(h.points).reduce<{ date: string; value: number } | null>((best, p) => {
    const value = bw ? p.top.reps : (p.top.weight ?? 0);
    return !best || value > best.value ? { date: p.date, value } : best;
  }, null);

  return (
    <>
      <HumanosHeader title={h.exercise.name} subtitle={h.pr ? <span data-testid="history-pr">PR {h.pr.text} · {formatDate(h.pr.date, { month: "short", day: "numeric", year: "numeric" })}</span> : "No sets yet."} action={<Link href="/body/training" className="btn btn-ghost btn-sm">← Training</Link>} />
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs" data-testid="exercise-range" data-range={span.key} data-sessions={sessions.length}>
        <div className="flex gap-1">
          {SPANS.map((x) => (
            <Link key={x.key} href={`/body/training/${h.exercise.id}?range=${x.key}`} className={`rounded-full px-2.5 py-1 ${x.key === span.key ? "bg-humanos-soft font-semibold text-humanos-ink" : "text-ink-2 hover:bg-surface-2"}`} aria-current={x.key === span.key ? "page" : undefined}>
              {x.label}
            </Link>
          ))}
        </div>
        <span className="text-ink-2">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
          {top ? ` · top ${bw ? `${top.value} reps` : `${top.value} ${h.unit}`} on ${formatDate(top.date, { month: "short", day: "numeric" })}` : ""}
        </span>
      </div>
      <Card className="mb-4" title={bw ? "Reps, best set per session" : `Top set per session (${h.unit})`}>
        <TrendLine points={points} unit={bw ? "reps" : h.unit} name={h.exercise.name} />
      </Card>
      <Card title="Every session">
        {sessions.length ? (
          <ul className="divide-y text-sm" data-testid="history-sessions">
            {sessions.map((s) => (
              <li key={s.date} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/body/training?date=${s.date}`} className="text-ink-2 hover:underline">
                  {formatDate(s.date, { weekday: "short", month: "short", day: "numeric" })}
                </Link>
                <span className="tabular">
                  {s.sets.map((x, i) => (
                    <span key={i}>
                      {i ? <span className="text-ink-3"> · </span> : null}
                      {x.text}
                      {x.pr ? " 🏆" : ""}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">Nothing logged yet.</p>
        )}
      </Card>
    </>
  );
}
