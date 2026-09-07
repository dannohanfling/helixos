import Link from "next/link";
import { asc, eq, or, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { completeLessonAction, uncompleteLessonAction } from "@/lib/actions/courses";
import { Badge, Card, Disclosure, Empty, PageHeader, Progress, Tabs } from "@/components/ui";

export const metadata = { title: "Courses" };

const PROGRAMS = [
  { key: "Launch Pad", label: "Launch Pad", blurb: "Short mini-courses. Start here. Twenty minutes each." },
  { key: "Accelerator", label: "Accelerator", blurb: "The 6-week build: mindset, authority, community, content, organic, offer." },
  { key: "Academy", label: "Academy", blurb: "Exercises you return to. Each one produces an asset." },
];

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ program?: string; course?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const [courses, lessons, done, stages] = await Promise.all([
    db.query.courses.findMany({ where: or(isNull(schema.courses.workspaceId), eq(schema.courses.workspaceId, v.workspace.id)), orderBy: asc(schema.courses.order) }),
    db.query.lessons.findMany({ orderBy: asc(schema.lessons.order) }),
    db.query.lessonProgress.findMany({ where: eq(schema.lessonProgress.userId, v.user.id) }),
    db.query.pathwayStages.findMany(),
  ]);
  const stageOf = new Map(stages.map((s) => [s.key, s]));
  const doneIds = new Set(done.map((d) => d.lessonId));
  const program = PROGRAMS.find((p) => p.key === sp.program)?.key ?? "Launch Pad";
  const mine = courses.filter((c) => c.program === program);
  const lessonsOf = (courseId: string) => lessons.filter((l) => l.courseId === courseId);
  const selected = mine.find((c) => c.id === sp.course) ?? mine.find((c) => lessonsOf(c.id).some((l) => !doneIds.has(l.id))) ?? mine[0];
  const totalDone = lessons.filter((l) => doneIds.has(l.id)).length;
  const meta = PROGRAMS.find((p) => p.key === program)!;
  return (
    <>
      <PageHeader title="Courses" subtitle={`${totalDone} of ${lessons.length} lessons done. Do the thing, tick it.`} action={<Link href="/pathway" className="btn btn-ghost btn-sm">Pathway</Link>} />
      <Tabs items={PROGRAMS.map((p) => ({ key: p.key, label: p.label, href: `/courses?program=${encodeURIComponent(p.key)}`, count: courses.filter((c) => c.program === p.key).length }))} current={program} />
      <p className="mt-2 mb-4 text-sm text-ink-2">{meta.blurb}</p>
      {mine.length ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Card title="Courses">
            <ul className="-mx-2 divide-y">
              {mine.map((c) => {
                const ls = lessonsOf(c.id);
                const d = ls.filter((l) => doneIds.has(l.id)).length;
                const pct = ls.length ? Math.round((d / ls.length) * 100) : 0;
                return (
                  <li key={c.id}>
                    <Link href={`/courses?program=${encodeURIComponent(program)}&course=${c.id}`} className={`block px-2 py-2.5 hover:bg-surface-2 ${selected?.id === c.id ? "bg-accent-soft" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-ink-3">{d}/{ls.length}</span>
                      </div>
                      {c.tier ? <div className="text-[11px] text-ink-3">{c.tier}</div> : null}
                      <div className="mt-1.5"><Progress value={pct} tone={pct === 100 ? "good" : "accent"} height={4} /></div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
          {selected ? (
            <Card title={selected.name} action={selected.tier ? <Badge tone="neutral">{selected.tier}</Badge> : null}>
              {selected.description ? <p className="mb-3 text-sm text-ink-2">{selected.description}</p> : null}
              <ol className="space-y-2">
                {lessonsOf(selected.id).map((l) => {
                  const isDone = doneIds.has(l.id);
                  return (
                    <li key={l.id} className={`rounded-lg border p-3 ${isDone ? "border-good bg-good-soft" : ""}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                            {l.week ? <span>{l.week}</span> : null}
                            {l.stageKey && stageOf.get(l.stageKey) ? <span>· {stageOf.get(l.stageKey)!.icon} {stageOf.get(l.stageKey)!.name}</span> : null}
                            <span>· +{l.points} pts</span>
                          </div>
                          <div className={`font-medium ${isDone ? "line-through decoration-line" : ""}`}>{l.name}</div>
                          {l.objective ? <p className="mt-1 text-sm text-ink-2">{l.objective}</p> : null}
                        </div>
                        <form action={isDone ? uncompleteLessonAction : completeLessonAction} className="shrink-0">
                          <input type="hidden" name="lessonId" value={l.id} />
                          <button className={`btn btn-xs ${isDone ? "btn-ghost" : "btn-accent"}`} type="submit">{isDone ? "Undo" : "Done"}</button>
                        </form>
                      </div>
                      {l.prompts || l.resources ? (
                        <Disclosure summary={<span className="text-xs text-ink-3 underline">Prompts and resources</span>} className="mt-2">
                          {l.prompts ? <p className="mt-1 whitespace-pre-line text-sm">{l.prompts}</p> : null}
                          {l.resources ? <p className="mt-1 whitespace-pre-line text-xs text-ink-3">{l.resources}</p> : null}
                        </Disclosure>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </Card>
          ) : null}
        </div>
      ) : (
        <Card>
          <Empty icon="📚" title="No courses here yet" hint="Your coach hasn't published any courses yet. Check back after your next session." />
        </Card>
      )}
    </>
  );
}
