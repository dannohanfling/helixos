import { requireViewer } from "@/lib/auth";
import { addQuestionAction, deleteQuestionAction } from "@/lib/actions/socrates";
import { CLARITY_BEATS, NEPQ_CATEGORIES, SCRIPT_TYPES, beatByStage, questionsFor } from "@/lib/engine/socrates";
import { visibleQuestions } from "@/lib/queries/socrates";
import { Badge, Card, Disclosure, Field, PageHeader, Tabs } from "@/components/ui";

export const metadata = { title: "Question library" };

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<{ stage?: string; type?: string }> }) {
  const v = await requireViewer();
  const sp = await searchParams;
  const stage = beatByStage(sp.stage ?? "")?.stage ?? null;
  const type = SCRIPT_TYPES.find((t) => t === sp.type) ?? null;
  const all = await visibleQuestions(v.user.id);
  const rows = questionsFor(all, stage, type);
  const q = type ? `&type=${encodeURIComponent(type)}` : "";
  const own = all.filter((x) => x.own).length;
  return (
    <>
      <PageHeader title="Question library" subtitle={`${all.length - own} in the library · ${own} of your own`} />
      <Tabs
        items={[{ key: "all", label: "All", href: `/socrates/questions?${q.slice(1)}`, count: questionsFor(all, null, type).length }, ...CLARITY_BEATS.map((b) => ({ key: b.stage, label: `${b.letter} · ${b.name}`, href: `/socrates/questions?stage=${encodeURIComponent(b.stage)}${q}`, count: questionsFor(all, b.stage, type).length }))]}
        current={stage ?? "all"}
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {stage ? <input type="hidden" name="stage" value={stage} /> : null}
        <label className="block">
          <span className="label">Script type</span>
          <select className="field w-auto" name="type" defaultValue={type ?? ""} data-testid="type-filter">
            <option value="">Any</option>
            {SCRIPT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-ghost btn-sm" type="submit">Filter</button>
      </form>
      <Card>
        {rows.length ? (
          <ul className="divide-y" data-testid="question-list">
            {rows.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start gap-2 py-2.5 text-sm" data-testid="question-row" data-stage={x.clarityStage} data-own={x.own ? "1" : "0"}>
                <span className="min-w-0 flex-1">{x.question}</span>
                <span className="flex flex-wrap gap-1 text-[11px]">
                  {!stage ? <Badge tone="accent">{beatByStage(x.clarityStage)?.letter ?? "?"}</Badge> : null}
                  {x.nepqCategory ? <Badge>{x.nepqCategory}</Badge> : null}
                  <Badge tone={x.own ? "good" : "neutral"}>{x.own ? "yours" : x.source}</Badge>
                  {x.scriptTypes.map((t) => (
                    <span key={t} className="rounded-full border px-2 py-0.5 text-ink-3">{t}</span>
                  ))}
                </span>
                {x.own ? (
                  <form action={deleteQuestionAction}>
                    <input type="hidden" name="id" value={x.id} />
                    <button className="text-xs text-ink-3 underline" type="submit">Delete</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-ink-3" data-testid="no-questions">Nothing tagged for this beat and script type.</p>
        )}
      </Card>
      <Disclosure className="mt-4" summary={<span className="btn btn-soft btn-sm">+ Add your own question</span>}>
        <form action={addQuestionAction} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="add-question">
          <div className="sm:col-span-2">
            <Field label="Question" hint="Put [brackets] around the parts you fill in on the day.">
              <input className="field" name="question" required />
            </Field>
          </div>
          <Field label="CLARITY beat">
            <select className="field" name="clarityStage" defaultValue={stage ?? CLARITY_BEATS[0].stage}>
              {CLARITY_BEATS.map((b) => (
                <option key={b.key} value={b.stage}>{b.stage}</option>
              ))}
            </select>
          </Field>
          <Field label="NEPQ category (optional)">
            <select className="field" name="nepqCategory" defaultValue="">
              <option value="">—</option>
              {NEPQ_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="label">Script types</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {SCRIPT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1.5">
                  <input type="checkbox" name="scriptTypes" value={t} defaultChecked={t === type} /> {t}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <button className="btn btn-primary btn-sm" type="submit">Add question</button>
          </div>
        </form>
      </Disclosure>
    </>
  );
}
