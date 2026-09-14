import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { deleteScriptAction, saveBeatAction, saveFillsAction, updateScriptAction } from "@/lib/actions/socrates";
import { BRANCH_CONDITIONS, BRANCH_DEFAULT_BEATS, CLARITY_BEATS, PLACEHOLDER_PROMPTS, REFRAME_BEAT, SCRIPT_TYPES, assemble, beatByKey, beatDone, beatOf, callSheet, callSheetHtml, callSheetText, copyBlockText, defaultBranchIds, placeholdersOf, progress, questionsFor, reframesByGroup, unfilledIn } from "@/lib/engine/socrates";
import { fillsFor, ownScript, visibleQuestions } from "@/lib/queries/socrates";
import { CallSheetView } from "@/components/call-sheet";
import { QuestionPicker } from "@/components/question-picker";
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
  const assembled = assemble(s.beats, all);
  const blanks = placeholdersOf(assembled);
  const { fills, offer } = await fillsFor(assembled, s.fills, v.user.id);
  const unfilled = unfilledIn(assembled, fills);
  const fillStep = sp.beat === "fill";
  const current = fillStep ? null : (beatByKey(sp.beat ?? "") ?? CLARITY_BEATS.find((b) => !beatDone(beatOf(s.beats, b.key))) ?? CLARITY_BEATS[0]);
  const idx = current ? CLARITY_BEATS.findIndex((b) => b.key === current.key) : -1;
  const next = current ? (CLARITY_BEATS[idx + 1] ?? null) : null;
  const draft = current ? beatOf(s.beats, current.key) : null;
  const library = current ? questionsFor(all, current.stage, s.scriptType) : [];
  const primaryId = draft?.questionIds[0] ?? "";
  const followUpIds = draft?.questionIds.slice(1) ?? [];
  const branchIds = current && draft ? (draft.branchIds ?? defaultBranchIds(current.key)) : [];
  const branchesDefaultOn = current ? (BRANCH_DEFAULT_BEATS as readonly string[]).includes(current.key) : false;
  const sheet = callSheet(s.name, s.scriptType, assembled, fills);
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
        <Card className="mt-4" title="Your script is ready" id="script-outputs">
          {unfilled.length ? (
            <p className="mb-3 rounded-lg bg-warn-soft p-2 text-sm" data-testid="outputs-unfilled">
              {unfilled.length === 1 ? "One blank is" : `${unfilled.length} blanks are`} still unfilled and shows as such in every output: {unfilled.join(", ")}. <Link href={`/socrates/scripts/${s.id}?beat=fill`} className="underline">Fill in the blanks</Link>
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2" data-testid="output-choice">
            <div className="rounded-lg border border-line p-3">
              <p className="font-medium">Call sheet</p>
              <p className="mt-1 text-xs text-ink-2">Live, on screen or printed. Your line, what to listen for, and what to say if they push back, with room to write what they said.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/socrates/scripts/${s.id}/sheet`} className="btn btn-primary btn-sm" data-testid="open-sheet">Open the call sheet</Link>
                <CopyButton text={callSheetText(sheet)} html={callSheetHtml(sheet)} label="Copy the call sheet" className="btn btn-soft btn-sm" />
              </div>
            </div>
            <div className="rounded-lg border border-line p-3">
              <p className="font-medium">Copy block</p>
              <p className="mt-1 text-xs text-ink-2">For a DM or an email. The questions only: no branches, no labels, no blank lines.</p>
              <div className="mt-2">
                <CopyButton text={copyBlockText(sheet)} label="Copy the questions" className="btn btn-soft btn-sm" />
              </div>
            </div>
          </div>
          <Disclosure summary={<span className="mt-3 inline-block text-xs underline">Preview the call sheet here</span>}>
            <div className="rounded-lg border border-line p-4">
              <CallSheetView sheet={sheet} />
            </div>
          </Disclosure>
        </Card>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="The 7 beats">
          <ol className="-mx-2 divide-y" data-testid="beat-list">
            {CLARITY_BEATS.map((b) => {
              const done = beatDone(beatOf(s.beats, b.key));
              return (
                <li key={b.key}>
                  <Link href={`/socrates/scripts/${s.id}?beat=${b.key}`} className={`flex items-center gap-2 px-2 py-2 text-sm hover:bg-surface-2 ${current && b.key === current.key ? "bg-accent-soft" : ""}`} data-testid="beat-link" data-beat={b.key} data-done={done ? "1" : "0"}>
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${done ? "border-good bg-good text-white" : "border-line"}`}>{done ? "✓" : b.letter}</span>
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  </Link>
                </li>
              );
            })}
            <li>
              <Link href={`/socrates/scripts/${s.id}?beat=fill`} className={`flex items-center gap-2 px-2 py-2 text-sm hover:bg-surface-2 ${fillStep ? "bg-accent-soft" : ""}`} data-testid="beat-link" data-beat="fill" data-done={blanks.length && !unfilled.length ? "1" : "0"}>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${blanks.length && !unfilled.length ? "border-good bg-good text-white" : "border-line"}`}>{blanks.length && !unfilled.length ? "✓" : "…"}</span>
                <span className="min-w-0 flex-1 truncate">Fill in the blanks</span>
                {unfilled.length ? <Badge tone="neutral">{unfilled.length}</Badge> : null}
              </Link>
            </li>
          </ol>
          <form action={deleteScriptAction} className="mt-3">
            <input type="hidden" name="id" value={s.id} />
            <button className="text-xs text-ink-3 underline" type="submit">Delete this script</button>
          </form>
        </Card>
        {fillStep ? (
          <Card title="Fill in the blanks" action={<Badge tone={blanks.length && !unfilled.length ? "good" : "neutral"}>{blanks.length ? `${blanks.length - unfilled.length} of ${blanks.length}` : "none"}</Badge>}>
            {blanks.length ? (
              <form action={saveFillsAction} className="space-y-4" data-testid="fill-form">
                <input type="hidden" name="id" value={s.id} />
                <p className="text-sm text-ink-2">Every blank the questions you picked carry, asked once. What you type here replaces it everywhere it appears.</p>
                {blanks.map((k) => {
                  const prompt = PLACEHOLDER_PROMPTS[k];
                  const fromOffer = prompt?.source === "offer" && offer && !s.fills[k]?.trim();
                  return (
                    <Field key={k} label={prompt?.label ?? k} hint={prompt?.help ?? (fromOffer ? `Prefilled from your offer: ${offer.name}` : undefined)}>
                      <input className="field" name={`fill:${k}`} defaultValue={fills[k] ?? ""} data-testid="fill" data-key={k} />
                    </Field>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-accent" type="submit">Save</button>
                  {p.complete ? <Link href={`/socrates/scripts/${s.id}`} className="btn btn-ghost">To the outputs</Link> : null}
                </div>
              </form>
            ) : (
              <p className="text-sm text-ink-3" data-testid="fill-none">The questions you picked carry no blanks.</p>
            )}
          </Card>
        ) : current && draft ? (
          <Card title={<span><span className="text-accent">{current.letter}</span> — {current.name}</span>} action={<Badge tone={beatDone(draft) ? "good" : "neutral"}>{beatDone(draft) ? "done" : "open"}</Badge>}>
            <form action={saveBeatAction} className="space-y-4" data-testid="beat-form" data-beat={current.key}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="beat" value={current.key} />
              <QuestionPicker library={library} primaryId={primaryId} followUpIds={followUpIds} scriptType={s.scriptType} />
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
              <Field label="Listen for" hint="The shape of their answer, in your own note. Not their words: the sheet never writes the prospect's lines.">
                <textarea className="field min-h-16" name="listenFor" defaultValue={draft.listenFor ?? ""} data-testid="listen-for" />
              </Field>
              <Disclosure open={branchesDefaultOn || branchIds.length > 0} summary={<span className="label cursor-pointer underline">And if they push back here?</span>}>
                <fieldset data-testid="beat-branches" data-default={branchesDefaultOn ? "on" : "off"}>
                  <div className="space-y-3">
                    {reframesByGroup().map((g) => (
                      <div key={g.group}>
                        <div className="text-xs italic text-ink-2">{BRANCH_CONDITIONS[g.group] ?? g.group}</div>
                        <ul className="mt-1 space-y-1">
                          {g.reframes.map((r) => (
                            <li key={r.id}>
                              <label className="flex items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
                                <input type="checkbox" name="branchIds" value={r.id} defaultChecked={branchIds.includes(r.id)} className="mt-1" data-testid="branch" />
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
              </Disclosure>
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
                  <button className="btn btn-accent" type="submit" name="next" value="fill">
                    Save and fill in the blanks →
                  </button>
                )}
              </div>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
