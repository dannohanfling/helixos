import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { Card } from "@/components/ui";
import { HumanosHeader } from "@/components/body/humanos-header";
import { TrendLine } from "@/components/body/trend-line";
import { formatDate } from "@/lib/dates";
import { fmtSet } from "@/lib/engine/body-training";
import { exerciseHistory, requireBodyEnabled } from "@/lib/queries/body";

export const metadata = { title: "HumanOS · Exercise history" };

export default async function ExerciseHistoryPage({ params }: { params: Promise<{ exerciseId: string }> }) {
  const v = await requireViewer();
  requireBodyEnabled(v);
  const { exerciseId } = await params;
  const h = await exerciseHistory(v.workspace.id, v.user.id, exerciseId);
  if (!h) notFound();
  const bw = h.exercise.kind === "bodyweight";
  // Weighted: the top set's weight. Bodyweight: its reps (added weight shows in the label and the list).
  const points = h.points.map((p) => ({ date: p.date, value: bw ? p.top.reps : (p.top.weight ?? 0), label: fmtSet({ ...p.top, unit: h.unit }, h.unit, h.exercise.kind) }));

  return (
    <>
      <HumanosHeader title={h.exercise.name} subtitle={h.pr ? <span data-testid="history-pr">PR {h.pr.text} · {formatDate(h.pr.date, { month: "short", day: "numeric", year: "numeric" })}</span> : "No sets yet."} action={<Link href="/body/training" className="btn btn-ghost btn-sm">← Training</Link>} />
      <Card className="mb-4" title={bw ? "Reps, best set per session" : `Top set per session (${h.unit})`}>
        <TrendLine points={points} unit={bw ? "reps" : h.unit} name={h.exercise.name} />
      </Card>
      <Card title="Every session">
        {h.sessions.length ? (
          <ul className="divide-y text-sm" data-testid="history-sessions">
            {h.sessions.map((s) => (
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
