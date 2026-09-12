import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { deleteScriptAction, saveBeatAction, updateScriptAction } from "@/lib/actions/socrates";
import { CLARITY_BEATS, REFRAME_BEAT, SCRIPT_TYPES, assemble, beatByKey, beatDone, beatOf, progress, questionsFor, reframesByGroup, scriptText } from "@/lib/engine/socrates";
import { ownScript, visibleQuestions } from "@/lib/queries/socrates";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Disclosure, Field, PageHeader, Progress } from "@/components/ui";

export const metadata = { title: "Script" };

export default async function ScriptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ beat?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const s = await ownScript(id, v.user.id);
  if (!s) notFound();
  const all = await visibleQuestions(v.user.id);
  const p = progress(s.beats);
  const current = beatByKey(sp.beat ?? "") ?? CLARITY_BEATS.find((b) => !beatDone(beatOf(s.beats, b.key))) ?? CLARITY_BEATS[0];
  const idx = CLARITY_BEATS.findIndex((b) => b.key === current.key);
  const next = CLARITY_BEATS[idx + 1] ?? null;
  const draft = beatOf(s.beats, current.key);
  const library = questionsFor(all, current.stage, s.scriptType);
  const assembled = assemble(s.beats, all);
  const text = scriptText(s.name, s.scriptType, assembled);
  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/socrates/scripts" className="hover:underline">← Scripts</Link>
            <Badge>{s.scriptType}</Badge>
            <Badge tone={p.complete ? "good" : "accent"}>
              <span data-testid="script-progress">{p.done} of {p.total}</span>
            </Badge>
          </span>
        }
        action={
          <Disclosure summary={<span className="btn btn-ghost btn-sm">Rename or change type</span>}>
            <form action={updateScriptAction} className="card mt-2 grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto]">
              <input type="hidden" name="id" value={s.id} />
              <input className="field" name="name" defaultValue={s.name} />
              <select className="field" name="scriptType" defaultValue={s.scriptType}>
                {SCRIPT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button className="btn btn-soft btn-sm" type="submit">Save</button>
            </form>
          </Disclosure>
        }
      />
      <Progress value={(p.done / p.total) * 100} tone={p.complete ? "good" : "accent"} />
      {p.complete ? (
        <Card className="mt-4" title="The finished script" action={<CopyButton text={text} label="Copy the script" className="btn btn-primary btn-sm" />}>
          <div className="space-y-4" data-testid="assembled-script">
            {assembled.map((a) => (
              <section key={a.beat.key}>
                <h3 className="text-sm font-semibold"><span className="text-accent">{a.beat.letter}</span> — {a.beat.name}</h3>
                <div className="mt-1 space-y-1.5 text-[15px] leading-relaxed">
                  {a.questions.map((q) => (
                    <p key={q.id}>{q.question}</p>
                  ))}
                  {a.reframes.map((r) => (
                    <p key={r.id}>
                      <span className="italic">{r.transitionIn}</span> {r.memorablePhrase} {r.metaphor}
                      {r.credit ? <span className="block text-xs text-ink-3">Credit: {r.credit}</span> : null}
                    </p>
                  ))}
                  {a.override ? <p className="whitespace-pre-line">{a.override}</p> : null}
                </div>
              </section>
            ))}
          </div>
        </Card>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="The 7 beats">
          <ol className="-mx-2 divide-y" data-testid="beat-list">
            {CLARITY_BEATS.map((b) => {
              const done = beatDone(beatOf(s.beats, b.key));
              return (
                <li key={b.key}>
                  <Link href={`/socrates/scripts/${s.id}?beat=${b.key}`} className={`flex items-center gap-2 px-2 py-2 text-sm hover:bg-surface-2 ${b.key === current.key ? "bg-accent-soft" : ""}`} data-testid="beat-link" data-beat={b.key} data-done={done ? "1" : "0"}>
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${done ? "border-good bg-good text-white" : "border-line"}`}>{done ? "✓" : b.letter}</span>
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <form action={deleteScriptAction} className="mt-3">
            <input type="hidden" name="id" value={s.id} />
            <button className="text-xs text-ink-3 underline" type="submit">Delete this script</button>
          </form>
        </Card>
        <Card title={<span><span className="text-accent">{current.letter}</span> — {current.name}</span>} action={<Badge tone={beatDone(draft) ? "good" : "neutral"}>{beatDone(draft) ? "done" : "open"}</Badge>}>
          <form action={saveBeatAction} className="space-y-4" data-testid="beat-form" data-beat={current.key}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="beat" value={current.key} />
            <fieldset>
              <legend className="label">Pick from the library</legend>
              {library.length ? (
                <ul className="mt-1 space-y-1.5" data-testid="beat-library">
                  {library.map((q) => (
                    <li key={q.id}>
                      <label className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                        <input type="checkbox" name="questionIds" value={q.id} defaultChecked={draft.questionIds.includes(q.id)} className="mt-1" data-testid="pick" />
                        <span className="min-w-0 flex-1">
                          {q.question}
                          <span className="ml-1 text-[11px] text-ink-3">{q.own ? "yours" : q.nepqCategory ?? q.source}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-ink-3" data-testid="beat-empty">Nothing tagged for this beat and {s.scriptType}. Write your own below.</p>
              )}
            </fieldset>
            {s.scriptType === "Objection" && current.key === REFRAME_BEAT ? (
              <fieldset data-testid="beat-reframes">
                <legend className="label">Reframes, by objection <Link href="/socrates/reframes" className="ml-1 font-normal underline">full library</Link> · <Link href="/socrates/objections" className="font-normal underline" data-testid="beat-objections-link">your objections</Link></legend>
                <div className="mt-1 space-y-3">
                  {reframesByGroup().map((g) => (
                    <div key={g.group}>
                      <div className="text-xs font-semibold text-ink-2">{g.group}</div>
                      <ul className="mt-1 space-y-1">
                        {g.reframes.map((r) => (
                          <li key={r.id}>
                            <label className="flex items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
                              <input type="checkbox" name="reframeIds" value={r.id} defaultChecked={draft.reframeIds.includes(r.id)} className="mt-1" />
                              <span className="min-w-0 flex-1">
                                <span className="font-medium">{r.name}</span> <span className="text-ink-2">{r.memorablePhrase}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <Field label="Or write your own">
              <textarea className="field min-h-28" name="override" defaultValue={draft.override ?? ""} data-testid="override" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-ghost" type="submit">Save</button>
              {next ? (
                <button className="btn btn-accent" type="submit" name="next" value={next.key}>
                  Save and next →
                </button>
              ) : (
                <button className="btn btn-accent" type="submit">Save and read it back</button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
