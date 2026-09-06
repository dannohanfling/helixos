import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { completeCurriculumDayAction, submitPathwayTaskAction } from "@/lib/actions/pathway";
import { Badge, Card, Empty, Field, PageHeader, Progress } from "@/components/ui";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Pathway" };

const EFFORT: Record<string, string> = { quick: "⚡ < 15 min", medium: "🕐 30–60 min", heavy: "🏋️ 1–3 hrs", deep: "🏔️ half-day+" };
const PRIORITY: Record<string, { label: string; tone: "danger" | "accent" | "neutral" }> = {
  must: { label: "Must do", tone: "danger" },
  should: { label: "Should do", tone: "accent" },
  nice: { label: "Nice to have", tone: "neutral" },
  optional: { label: "Optional", tone: "neutral" },
};
const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "good" | "warn" }> = {
  todo: { label: "To do", tone: "neutral" },
  submitted: { label: "Waiting on coach", tone: "accent" },
  revision: { label: "Needs a tweak", tone: "warn" },
  verified: { label: "Verified", tone: "good" },
};

export default async function PathwayPage({ searchParams }: { searchParams: Promise<{ task?: string; stage?: string; filter?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const [stages, library, progress, curriculum, curriculumDone] = await Promise.all([
    db.query.pathwayStages.findMany({ orderBy: asc(schema.pathwayStages.order) }),
    db.query.libraryTasks.findMany({ orderBy: asc(schema.libraryTasks.order) }),
    db.query.pathwayProgress.findMany({ where: eq(schema.pathwayProgress.userId, v.user.id) }),
    db.query.curriculumDays.findMany({ orderBy: asc(schema.curriculumDays.day) }),
    db.query.curriculumProgress.findMany({ where: eq(schema.curriculumProgress.userId, v.user.id) }),
  ]);
  const progByKey = new Map(progress.map((p) => [p.libraryTaskKey, p]));
  const statusOf = (key: string) => progByKey.get(key)?.status ?? "todo";
  const stageStats = stages.map((s) => {
    const tasks = library.filter((t) => t.stageKey === s.key);
    const verified = tasks.filter((t) => statusOf(t.key) === "verified");
    const pts = verified.reduce((a, t) => a + t.points, 0);
    const total = tasks.reduce((a, t) => a + t.points, 0);
    return { stage: s, tasks, verified: verified.length, pts, total, pct: tasks.length ? Math.round((verified.length / tasks.length) * 100) : 0 };
  });
  const firstIncomplete = stageStats.find((s) => s.verified < s.tasks.length)?.stage.key ?? stages[0]?.key;
  const openStageKey = sp.stage ?? (sp.task ? library.find((t) => t.key === sp.task)?.stageKey : undefined) ?? firstIncomplete;
  const openStage = stageStats.find((s) => s.stage.key === openStageKey);
  const selected = sp.task ? library.find((t) => t.key === sp.task) : undefined;
  const selectedProg = selected ? progByKey.get(selected.key) : undefined;
  const revisions = progress.filter((p) => p.status === "revision");
  const filterRevision = sp.filter === "revision";
  const visibleTasks = filterRevision ? library.filter((t) => statusOf(t.key) === "revision") : (openStage?.tasks ?? []);
  const doneDays = new Set(curriculumDone.map((c) => c.day));
  const nextDay = curriculum.find((c) => !doneDays.has(c.day));
  const totalVerified = progress.filter((p) => p.status === "verified").length;

  return (
    <>
      <PageHeader title="Your pathway" subtitle={`${totalVerified} of ${library.length} tasks verified. Seven stages. One asset at a time.`} />

      {/* Stage strip */}
      <div className="mb-4 grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {stageStats.map((s) => {
          const active = s.stage.key === openStageKey && !filterRevision;
          const done = s.verified === s.tasks.length && s.tasks.length > 0;
          return (
            <Link key={s.stage.key} href={`/pathway?stage=${s.stage.key}`} className={`rounded-xl border p-3 text-left transition hover:border-ink ${active ? "border-accent bg-accent-soft" : done ? "bg-good-soft" : "bg-surface"}`}>
              <div className="text-lg">{s.stage.icon}</div>
              <div className="mt-1 truncate text-xs font-semibold">{s.stage.name}</div>
              <div className="mt-1 text-[11px] text-ink-3">
                {s.verified}/{s.tasks.length} · {s.pts} pts
              </div>
              <div className="mt-1.5">
                <Progress value={s.pct} tone={done ? "good" : "accent"} height={4} />
              </div>
            </Link>
          );
        })}
      </div>

      {revisions.length && !filterRevision ? (
        <Link href="/pathway?filter=revision" className="mb-4 block rounded-xl border border-warn bg-warn-soft px-4 py-3 text-sm">
          ✏️ Your coach asked for a tweak on {revisions.length} {revisions.length === 1 ? "task" : "tasks"}. <span className="font-semibold underline">See feedback →</span>
        </Link>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <Card
            title={filterRevision ? "Needs a tweak" : `${openStage?.stage.icon ?? ""} ${openStage?.stage.name ?? "Stage"}`}
            action={openStage ? <span className="text-xs text-ink-3">{openStage.stage.expectedDuration}</span> : null}
          >
            {openStage && !filterRevision ? (
              <div className="mb-3 space-y-1 text-sm">
                <p className="font-medium">{openStage.stage.tagline}</p>
                <p className="text-ink-2">{openStage.stage.description}</p>
                {openStage.stage.exitCriteria ? (
                  <p className="text-xs text-ink-3">
                    <span className="font-semibold">Done when:</span> {openStage.stage.exitCriteria}
                  </p>
                ) : null}
              </div>
            ) : null}
            {visibleTasks.length ? (
              <ol className="-mx-2 divide-y">
                {visibleTasks.map((t) => {
                  const st = statusOf(t.key);
                  const isSel = selected?.key === t.key;
                  return (
                    <li key={t.key}>
                      <Link href={`/pathway?task=${t.key}${filterRevision ? "&filter=revision" : ""}`} className={`flex items-start gap-3 px-2 py-2.5 hover:bg-surface-2 ${isSel ? "bg-accent-soft" : ""}`}>
                        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${st === "verified" ? "border-good bg-good text-white" : st === "submitted" ? "border-accent text-accent" : st === "revision" ? "border-warn text-warn" : "border-line"}`}>
                          {st === "verified" ? "✓" : st === "submitted" ? "…" : st === "revision" ? "!" : ""}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm font-medium ${st === "verified" ? "text-ink-2" : ""}`}>{t.name}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-ink-3">
                            <span>+{t.points} pts</span>
                            <span>· {EFFORT[t.effort]}</span>
                            <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <Empty icon="🧭" title="Nothing here" />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {selected ? (
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
              <Empty icon="👈" title="Pick a task" hint="Each one comes with why it matters, how to do it, and what it unlocks." />
            </Card>
          )}

          <Card id="curriculum" title="30-day build" action={<span className="text-xs text-ink-3">{doneDays.size}/30 days</span>}>
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
    </>
  );
}
