import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { completeCurriculumDayAction, submitPathwayTaskAction } from "@/lib/actions/pathway";
import { Badge, Card, Disclosure, Empty, Field, PageHeader, Progress } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { FIELD_TASKS, OPEN_LIMIT, SECTION_TASKS, sectionCountLine, simplePath, roadLine, stageRelation } from "@/lib/engine/pathway";
import { syncFieldTasks } from "@/lib/queries/pathway";
import type { LibraryTask, PathwayProgress } from "@/db/schema";

export const metadata = { title: "Pathway" };

const EFFORT: Record<string, string> = { quick: "⚡ < 15 min", medium: "🕐 30–60 min", heavy: "🏋️ 1–3 hrs", deep: "🏔️ half-day+" };
const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "good" | "warn" }> = {
  todo: { label: "To do", tone: "neutral" },
  submitted: { label: "Waiting on coach", tone: "accent" },
  revision: { label: "Needs a tweak", tone: "warn" },
  verified: { label: "Verified", tone: "good" },
};

function TaskLink({ t, st, selected, extra = false }: { t: LibraryTask; st: string; selected: boolean; extra?: boolean }) {
  return (
    <li>
      <Link href={`/pathway?task=${t.key}`} className={`flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2 ${selected ? "bg-accent-soft" : ""}`}>
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${st === "verified" ? "border-good bg-good text-white" : st === "submitted" ? "border-accent text-accent" : st === "revision" ? "border-warn text-warn" : "border-line"}`}>
          {st === "verified" ? "✓" : st === "submitted" ? "…" : st === "revision" ? "!" : ""}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-medium ${st === "verified" ? "text-ink-2 line-through decoration-line" : ""}`}>{t.name}</span>
          <span className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-ink-3">
            <span>+{t.points} pts</span>
            <span>· {EFFORT[t.effort]}</span>
            {st === "revision" ? <Badge tone="warn">Coach asked for a tweak</Badge> : extra ? <Badge tone="neutral">Extra</Badge> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * A stage that is not the client's current one, read-only. A future stage says what unlocks it, in the stage's own entry
 * criteria, and its tasks are greyed and not links; a past stage shows its tasks with their status.
 */
function StagePreview({ stage, tasks, relation, statusOf, back }: { stage: { key: string; icon: string | null; name: string; tagline: string | null; description: string | null; entryCriteria: string | null; expectedDuration: string | null }; tasks: LibraryTask[]; relation: "past" | "future"; statusOf: (key: string) => string; back: string }) {
  return (
    <Card title={`${stage.icon ?? ""} ${stage.name}`} action={<Badge tone={relation === "future" ? "neutral" : "good"}>{relation === "future" ? "up ahead" : "behind you"}</Badge>}>
      <div data-testid="stage-preview" data-stage={stage.key} data-relation={relation}>
        <div className="mb-3 space-y-1 text-sm">
          {stage.tagline ? <p className="font-medium">{stage.tagline}</p> : null}
          {stage.description ? <p className="text-ink-2">{stage.description}</p> : null}
          {relation === "future" && stage.entryCriteria ? (
            <p className="rounded-lg bg-surface-2 p-2 text-xs" data-testid="stage-unlock">
              <span className="font-semibold">Unlocks when:</span> {stage.entryCriteria}
            </p>
          ) : null}
        </div>
        <ol className="-mx-2 divide-y">
          {tasks.map((t) => (
            <li key={t.key} className={`flex items-start gap-3 px-2 py-2.5 ${relation === "future" ? "opacity-50" : ""}`} data-testid="preview-task" aria-disabled={relation === "future" ? "true" : undefined}>
              <span className="mt-0.5 text-sm">{relation === "future" ? "🔒" : STATUS[statusOf(t.key) as keyof typeof STATUS]?.label === "Verified" ? "✅" : "◻︎"}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="block text-xs text-ink-3">+{t.points} pts{t.priority !== "must" ? " · optional" : ""}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-ink-3">
          {relation === "future" ? "Read only until you get here. " : ""}
          <Link href={back} className="underline">Back to now</Link>
        </p>
      </div>
    </Card>
  );
}

export default async function PathwayPage({ searchParams }: { searchParams: Promise<{ task?: string; stage?: string; view?: string }> }) {
  const v = await requireViewer();
  await syncFieldTasks(v.workspace.id, v.user.id);
  const sp = await searchParams;
  const [stages, library, progress, curriculum, curriculumDone, courses] = await Promise.all([
    db.query.pathwayStages.findMany({ orderBy: asc(schema.pathwayStages.order) }),
    db.query.libraryTasks.findMany({ orderBy: asc(schema.libraryTasks.order) }),
    db.query.pathwayProgress.findMany({ where: eq(schema.pathwayProgress.userId, v.user.id) }),
    db.query.curriculumDays.findMany({ orderBy: asc(schema.curriculumDays.day) }),
    db.query.curriculumProgress.findMany({ where: eq(schema.curriculumProgress.userId, v.user.id) }),
    db.query.courses.findMany(),
  ]);
  const sectionCounts: Record<string, number> = { recA3OidbU8gUYW8x: (await db.query.leadMagnets.findMany({ where: eq(schema.leadMagnets.userId, v.user.id), columns: { id: true } })).length };
  const progByKey = new Map<string, PathwayProgress>(progress.map((p) => [p.libraryTaskKey, p]));
  const statusOf = (key: string) => progByKey.get(key)?.status ?? "todo";
  const path = simplePath(stages, library, progress);
  const currentStage = stages.find((s) => s.key === path.stageKey) ?? stages[0];
  const fullMap = sp.view === "all";
  const viewStageKey = sp.stage ?? path.stageKey;
  const viewStage = stages.find((s) => s.key === viewStageKey) ?? currentStage;
  // A stage the client clicked that is not the one they are in: shown read-only, beside the NOW card, which never changes.
  const relation = stageRelation(stages, path.stageKey, viewStage?.key ?? path.stageKey);
  const previewStage = !fullMap && sp.stage && relation !== "current" ? viewStage : null;
  const selected = sp.task ? library.find((t) => t.key === sp.task) : undefined;
  const selectedProg = selected ? progByKey.get(selected.key) : undefined;
  const stageStats = stages.map((s) => {
    const tasks = library.filter((t) => t.stageKey === s.key);
    const core = tasks.filter((t) => t.priority === "must");
    const pathTasks = core.length ? core : tasks.filter((t) => t.priority === "should");
    const done = pathTasks.filter((t) => statusOf(t.key) === "verified").length;
    return { stage: s, done, total: pathTasks.length, pct: pathTasks.length ? Math.round((done / pathTasks.length) * 100) : 0 };
  });
  const doneDays = new Set(curriculumDone.map((c) => c.day));
  const nextDay = curriculum.find((c) => !doneDays.has(c.day));
  const totalVerified = progress.filter((p) => p.status === "verified").length;
  const pathDone = stageStats.reduce((a, s) => a + s.done, 0);
  const pathTotal = stageStats.reduce((a, s) => a + s.total, 0);
  const stageTasks = library.filter((t) => t.stageKey === viewStage?.key);
  const courseLink = courses.find((c) => c.program === "Launch Pad") ? "/courses" : null;

  return (
    <>
      <PageHeader
        title="Your pathway"
        subtitle={path.allDone ? "Every stage done. You're the case study now." : `${roadLine(stages, path.stageKey)}. ${currentStage?.name}: ${pathDone} of ${pathTotal} path steps verified. One thing at a time.`}
        action={
          <div className="flex flex-wrap gap-2 text-xs">
            {v.membership.certEnabled ? <Link href="/certification" className="btn btn-soft btn-sm">🎓 Certification</Link> : null}
            {courseLink ? <Link href={courseLink} className="btn btn-ghost btn-sm">📚 Courses</Link> : null}
            <Link href={fullMap ? "/pathway" : "/pathway?view=all"} className="btn btn-ghost btn-sm">{fullMap ? "Simple view" : "Whole map"}</Link>
          </div>
        }
      />

      {/* Stage strip: compact, just where you are */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {stageStats.map((s) => {
          const isCurrent = s.stage.key === path.stageKey;
          const done = s.total > 0 && s.done === s.total;
          return (
            <Link key={s.stage.key} href={fullMap ? `/pathway?view=all&stage=${s.stage.key}` : `/pathway?stage=${s.stage.key}`} title={`${s.stage.name}: ${s.done}/${s.total}`} className={`flex min-w-[7.5rem] shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs transition hover:border-ink ${isCurrent ? "border-accent bg-accent-soft" : done ? "bg-good-soft" : "bg-surface opacity-70"}`}>
              <span className="text-base">{done ? "✅" : s.stage.icon}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{s.stage.name}</span>
                <span className="block text-[10px] text-ink-3">{s.done}/{s.total}</span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          {!fullMap ? (
            <>
              <Card title={`${currentStage?.icon ?? ""} Now`} action={<span className="text-xs text-ink-3">up to {OPEN_LIMIT} open at a time</span>}>
                <div data-testid="now-card" data-stage={currentStage?.key} className="contents" />
                {currentStage ? <p className="mb-3 text-sm text-ink-2">{currentStage.tagline}</p> : null}
                {path.now.length ? (
                  <ol className="-mx-2 divide-y">
                    {path.now.map((t) => {
                      const lib = library.find((l) => l.key === t.key)!;
                      return <TaskLink key={t.key} t={lib} st={statusOf(t.key)} selected={selected?.key === t.key} />;
                    })}
                  </ol>
                ) : path.allDone ? (
                  <Empty icon="🏔️" title="Top of the mountain" hint="Every path step is verified. Keep the daily loop going." />
                ) : (
                  <Empty icon="⏳" title="All submitted" hint="Your coach is reviewing. New steps unlock as they verify." />
                )}
                {path.remaining > 0 ? <p className="mt-3 text-xs text-ink-3">{path.remaining} more in this stage unlock as you finish these.</p> : null}
              </Card>
              {path.waiting.length ? (
                <Card title="Waiting on your coach">
                  <ol className="-mx-2 divide-y">
                    {path.waiting.map((t) => {
                      const lib = library.find((l) => l.key === t.key)!;
                      return <TaskLink key={t.key} t={lib} st="submitted" selected={selected?.key === t.key} />;
                    })}
                  </ol>
                </Card>
              ) : null}
              {path.extras.total ? (
                <Disclosure summary={<span className="text-sm text-ink-2">Extras for this stage ({path.extras.done}/{path.extras.total}) · optional</span>} className="card p-4">
                  <p className="mt-2 mb-1 text-xs text-ink-3">Nice-to-haves. They earn points but never block the next stage.</p>
                  <ol className="-mx-2 divide-y">
                    {path.extras.tasks.map((t) => {
                      const lib = library.find((l) => l.key === t.key)!;
                      return <TaskLink key={t.key} t={lib} st={statusOf(t.key)} selected={selected?.key === t.key} extra />;
                    })}
                  </ol>
                </Disclosure>
              ) : null}
            </>
          ) : viewStage && relation === "future" ? (
            <StagePreview stage={viewStage} tasks={stageTasks} relation="future" statusOf={statusOf} back="/pathway?view=all" />
          ) : (
            <Card title={`${viewStage?.icon ?? ""} ${viewStage?.name ?? "Stage"}`} action={<span className="text-xs text-ink-3">{viewStage?.expectedDuration}</span>}>
              {viewStage ? (
                <div className="mb-3 space-y-1 text-sm">
                  <p className="font-medium">{viewStage.tagline}</p>
                  <p className="text-ink-2">{viewStage.description}</p>
                  {viewStage.exitCriteria ? <p className="text-xs text-ink-3"><span className="font-semibold">Done when:</span> {viewStage.exitCriteria}</p> : null}
                </div>
              ) : null}
              <ol className="-mx-2 divide-y">
                {stageTasks.map((t) => <TaskLink key={t.key} t={t} st={statusOf(t.key)} selected={selected?.key === t.key} extra={t.priority !== "must"} />)}
              </ol>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {previewStage && relation !== "current" ? (
            <StagePreview stage={previewStage} tasks={stageTasks} relation={relation} statusOf={statusOf} back="/pathway" />
          ) : selected ? (
            <Card title="Task" action={<Badge tone={STATUS[statusOf(selected.key)].tone}>{STATUS[statusOf(selected.key)].label}</Badge>}>
              <h3 className="text-lg font-bold">{selected.name}</h3>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-3">
                <span>+{selected.points} pts</span>
                <span>· {EFFORT[selected.effort]}</span>
                <span>· proof: {selected.submissionType}</span>
              </div>
              {selected.teaching ? (
                <div className="mt-3">
                  <div className="label">Why this matters</div>
                  <p className="whitespace-pre-line text-sm text-ink-2">{selected.teaching}</p>
                </div>
              ) : null}
              {selected.howTo ? (
                <div className="mt-3">
                  <div className="label">How to complete</div>
                  <p className="whitespace-pre-line text-sm">{selected.howTo}</p>
                </div>
              ) : null}
              {selected.unlocks ? (
                <div className="mt-3 rounded-lg bg-surface-2 p-3 text-xs">
                  <span className="font-semibold">Unlocks:</span> {selected.unlocks}
                </div>
              ) : null}
              {selected.trainingUrl ? (
                <a href={selected.trainingUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm underline">
                  Watch the training ↗
                </a>
              ) : null}
              {SECTION_TASKS[selected.key] ? (
                <div className="mt-3 rounded-lg bg-surface-2 p-3 text-sm" data-testid="section-task">
                  {sectionCountLine(selected.key, sectionCounts[selected.key] ?? 0)}{" "}
                  <Link href={SECTION_TASKS[selected.key].href} className="font-semibold underline">
                    Open {SECTION_TASKS[selected.key].where} →
                  </Link>
                </div>
              ) : null}
              {selectedProg?.coachFeedback ? (
                <div className="mt-3 rounded-lg border border-warn bg-warn-soft p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide">Coach feedback</div>
                  <p className="mt-1">{selectedProg.coachFeedback}</p>
                </div>
              ) : null}
              {statusOf(selected.key) === "verified" ? (
                <p className="mt-4 text-sm text-good">✓ Verified {selectedProg?.verifiedAt ? formatDate(selectedProg.verifiedAt.slice(0, 10)) : ""}. Points are yours.</p>
              ) : statusOf(selected.key) === "submitted" ? (
                <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
                  <p className="font-medium">Submitted. Your coach will review it.</p>
                  {selectedProg?.submissionText ? <p className="mt-1 whitespace-pre-line text-ink-2">{selectedProg.submissionText}</p> : null}
                </div>
              ) : FIELD_TASKS[selected.key] ? (
                <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm" data-testid="field-task">
                  This one completes itself when the field is saved.{" "}
                  <Link href={FIELD_TASKS[selected.key].href} className="font-semibold underline">
                    Set it on {FIELD_TASKS[selected.key].where} →
                  </Link>
                </div>
              ) : (
                <form action={submitPathwayTaskAction} className="mt-4 space-y-3">
                  <input type="hidden" name="key" value={selected.key} />
                  {selected.submissionType !== "checkbox" ? (
                    <>
                      <Field label={selected.submissionType === "link" || selected.submissionType === "screenshot" || selected.submissionType === "video" ? "Link to your proof (post, screenshot, Loom…)" : "Link (optional)"}>
                        <input className="field" name="submissionUrl" type="url" placeholder="https://…" defaultValue={selectedProg?.submissionUrl ?? ""} />
                      </Field>
                      <Field label={selected.submissionType === "written" ? "Your answer" : "Notes for your coach"}>
                        <textarea className="field min-h-28" name="submissionText" defaultValue={selectedProg?.submissionText ?? ""} placeholder="Short. Specific. What you did and what you learned." />
                      </Field>
                    </>
                  ) : (
                    <p className="text-sm text-ink-2">This one is on your honor. Tick it when it&apos;s truly done.</p>
                  )}
                  <button className="btn btn-accent" type="submit">
                    {selected.submissionType === "checkbox" ? `Mark done · +${selected.points}` : statusOf(selected.key) === "revision" ? "Resubmit" : "Submit for review"}
                  </button>
                </form>
              )}
            </Card>
          ) : (
            <Card>
              <Empty icon="👈" title="Pick the top one" hint="Each step comes with why it matters, how to do it, and what it unlocks. Do one. Submit it. The next one appears." />
            </Card>
          )}

          <Card id="curriculum" title="30-day build" action={<span className="text-xs text-ink-3">{doneDays.size}/30 days · {totalVerified} tasks verified</span>}>
            {nextDay ? (
              <div className="mb-3 rounded-lg bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                    Day {nextDay.day} · {nextDay.week}
                  </div>
                  <Badge tone="accent">+{nextDay.points}</Badge>
                </div>
                <div className="mt-1 font-semibold">{nextDay.title}</div>
                <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{nextDay.instructions}</p>
                {nextDay.why ? <p className="mt-2 text-xs text-ink-3">{nextDay.why}</p> : null}
                <form action={completeCurriculumDayAction} className="mt-3">
                  <input type="hidden" name="day" value={nextDay.day} />
                  <button className="btn btn-accent btn-sm" type="submit">
                    Done, log it
                  </button>
                </form>
              </div>
            ) : (
              <p className="mb-3 text-sm text-good">All 30 days done. The habits continue.</p>
            )}
            <div className="grid grid-cols-10 gap-1">
              {curriculum.map((c) => (
                <div key={c.day} title={`Day ${c.day}: ${c.title}`} className={`grid aspect-square place-items-center rounded text-[10px] font-semibold ${doneDays.has(c.day) ? "bg-good text-white" : c.day === nextDay?.day ? "bg-accent text-white" : "bg-surface-2 text-ink-3"}`}>
                  {c.day}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      <div className="mt-3">
        <Progress value={pathTotal ? Math.round((pathDone / pathTotal) * 100) : 0} tone="good" height={4} />
      </div>
    </>
  );
}
