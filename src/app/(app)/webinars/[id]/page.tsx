import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { deleteWebinarAction, draftSectionAction, linkOfferAction, saveReadinessAction, updateRunAction, updateSectionAction, updateWebinarBeliefsAction, updateWebinarFoundationAction } from "@/lib/actions/webinars";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Disclosure, Field, PageHeader, Progress } from "@/components/ui";
import { ACTS, READINESS_DIMENSIONS, SECTION_TEMPLATES, STEPS, WIZARD_STAGES, deckOutline, nextStep, readinessScore, webinarProgress, type StepKey } from "@/lib/engine/webinar";
import { assetsFor } from "@/lib/queries/library";
import { AssetForm } from "@/components/asset-form";
import { AiFormStatus } from "@/components/ai-status";

const ACT_ICON: Record<string, string> = { opening: "🎬", vehicle: "🎯", internal: "💪", external: "🌍", closing: "🎭" };

export default async function WebinarWizardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; section?: string; act?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const ai = await hasAiKey();
  const w = await db.query.webinars.findFirst({ where: and(eq(schema.webinars.id, id), eq(schema.webinars.userId, v.user.id)) });
  if (!w) notFound();
  const [sections, beliefs, reviews, offers, assets, proofs] = await Promise.all([
    db.query.webinarSections.findMany({ where: eq(schema.webinarSections.webinarId, id), orderBy: asc(schema.webinarSections.order) }),
    db.query.webinarBeliefs.findMany({ where: eq(schema.webinarBeliefs.webinarId, id) }),
    db.query.readinessReviews.findMany({ where: eq(schema.readinessReviews.webinarId, id), orderBy: desc(schema.readinessReviews.createdAt) }),
    db.query.offers.findMany({ where: eq(schema.offers.userId, v.user.id) }),
    assetsFor(v.workspace.id, v.user.id),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
  ]);
  const review = reviews[0] ?? null;
  const progress = webinarProgress(w, sections, beliefs, review);
  const step = (STEPS.find((s) => s.key === sp.step)?.key ?? nextStep(progress.steps)) as StepKey;
  const stories = assets.filter((a) => a.type === "story");
  const frameworks = assets.filter((a) => a.type === "framework").sort((a, b) => (a.extra.priority === "High" ? 0 : 1) - (b.extra.priority === "High" ? 0 : 1) || a.name.localeCompare(b.name));
  const offer = w.offerId ? offers.find((o) => o.id === w.offerId) : undefined;
  const components = offer ? await db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, offer.id), orderBy: asc(schema.offerComponents.order) }) : [];

  // Script step state
  const sectionKey = sp.section ?? sections.find((s) => s.status === "todo")?.sectionKey ?? sections[0]?.sectionKey;
  const section = sections.find((s) => s.sectionKey === sectionKey) ?? sections[0];
  const tpl = SECTION_TEMPLATES.find((t) => t.key === section?.sectionKey);
  const actKey = sp.act ?? section?.act ?? "opening";
  const act = ACTS.find((a) => a.key === actKey)!;
  const sectionAssets = tpl?.assetType ? assets.filter((a) => a.type === tpl.assetType) : [];
  const chosenAsset = section?.assetId ? assets.find((a) => a.id === section.assetId) : undefined;
  const idx = sections.findIndex((s) => s.sectionKey === section?.sectionKey);
  const nextSection = sections[idx + 1];

  return (
    <>
      <PageHeader
        title={w.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/webinars" className="hover:underline">
              ← Webinars
            </Link>
            <Badge tone={w.status === "ready" || w.status === "scheduled" ? "good" : "accent"}>{w.status}</Badge>
            <span>
              {progress.drafted}/{sections.length} sections · ~{progress.totalMinutes} min · {progress.overall}% built
            </span>
          </span>
        }
        action={
          <form action={deleteWebinarAction}>
            <input type="hidden" name="id" value={w.id} />
            <button className="text-xs text-ink-3 hover:text-danger" type="submit">
              Delete
            </button>
          </form>
        }
      />

      {/* Step strip */}
      <div className="mb-5 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {STEPS.map((s) => {
          const pct = Math.round((progress.steps[s.key] ?? 0) * 100);
          const active = s.key === step;
          return (
            <Link key={s.key} href={`/webinars/${w.id}?step=${s.key}`} className={`rounded-xl border p-2.5 text-left transition hover:border-ink ${active ? "border-accent bg-accent-soft" : pct >= 100 ? "bg-good-soft" : "bg-surface"}`}>
              <div className="text-base">{s.icon}</div>
              <div className="text-xs font-semibold">{s.label}</div>
              <div className="mt-1.5">
                <Progress value={pct} tone={pct >= 100 ? "good" : "accent"} height={3} />
              </div>
            </Link>
          );
        })}
      </div>

      {step === "foundation" ? (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card title="1 · Foundation">
            <p className="mb-4 text-sm text-ink-2">{WIZARD_STAGES[0]?.description}</p>
            <form action={updateWebinarFoundationAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={w.id} />
              <div className="sm:col-span-2">
                <Field label="Title">
                  <input className="field" name="title" defaultValue={w.title} required />
                </Field>
              </div>
              <Field label="Type">
                <select className="field" name="category" defaultValue={w.category}>
                  {["Live", "Evergreen", "JV / partner", "Challenge"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Call to action at the end">
                <select className="field" name="ctaType" defaultValue={w.ctaType}>
                  {["Book a call", "Buy now", "Apply", "Join the community", "Start the trial"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Who is this for? (one specific person)">
                  <textarea className="field" name="audience" defaultValue={w.audience ?? ""} placeholder="Busy moms of school-age kids who've tried every diet and quit by week three." />
                </Field>
              </div>
              <Field label="Their core problem (in their words)">
                <textarea className="field" name="coreProblem" defaultValue={w.coreProblem ?? ""} placeholder="I lose 10 lbs and gain it back every time." />
              </Field>
              <Field label="The result they want">
                <textarea className="field" name="desiredResult" defaultValue={w.desiredResult ?? ""} placeholder="To stop starting over. To trust themselves around food." />
              </Field>
              <div className="sm:col-span-2">
                <Field label="The promise (specific, measurable, time-bound)" hint="What they walk away with by the end of the hour, and what changes if they act.">
                  <textarea className="field" name="promise" defaultValue={w.promise ?? ""} placeholder="Leave with a 12-minute Tuesday plan and the 3 swaps that drop the first 5 lbs in 14 days." />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Your named mechanism" hint="Capital letters. Not 'my approach', a name they can repeat.">
                  <input className="field" name="mechanismName" defaultValue={w.mechanismName ?? ""} placeholder="The 12-Minute Tuesday System" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <button className="btn btn-accent" type="submit">
                  Save and map beliefs →
                </button>
              </div>
            </form>
          </Card>
          <div className="space-y-4">
            <Card title="The structure you're building">
              <ol className="space-y-2 text-sm">
                {ACTS.map((a) => (
                  <li key={a.key} className="rounded-lg bg-surface-2 p-3">
                    <div className="font-semibold">
                      {ACT_ICON[a.key]} {a.name.replace(/^[^\w]+/, "")}
                    </div>
                    <div className="text-xs text-ink-2">{a.tooltip}</div>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="Done when">
              <p className="text-sm text-ink-2">{WIZARD_STAGES[0]?.validation}</p>
            </Card>
          </div>
        </div>
      ) : null}

      {step === "beliefs" ? (
        <form action={updateWebinarBeliefsAction} className="space-y-4">
          <input type="hidden" name="id" value={w.id} />
          <p className="text-sm text-ink-2">{WIZARD_STAGES[1]?.description} Fill the three shifts. Each one becomes an act.</p>
          <div className="grid gap-4 lg:grid-cols-3">
            {(["vehicle", "internal", "external"] as const).map((type) => {
              const a = ACTS.find((x) => x.key === type)!;
              const b = beliefs.find((x) => x.type === type);
              return (
                <Card key={type} title={`${ACT_ICON[type]} ${a.name.replace(/^[^\w]+/, "")}`}>
                  <p className="mb-3 text-xs text-ink-2">{a.purpose}</p>
                  <div className="space-y-3">
                    <Field label="They believe now" hint={a.beliefFrom ?? undefined}>
                      <textarea className="field" name={`${type}_from`} defaultValue={b?.fromBelief ?? ""} />
                    </Field>
                    <Field label="They must believe by the end" hint={a.beliefTo ?? undefined}>
                      <textarea className="field" name={`${type}_to`} defaultValue={b?.toBelief ?? ""} />
                    </Field>
                    <Field label="Proof you'll show">
                      <textarea className="field" name={`${type}_proof`} defaultValue={b?.proof ?? ""} placeholder="Data, a screenshot, a client result." />
                    </Field>
                    <Field label="Story that carries it">
                      <select className="field" name={`${type}_story`} defaultValue={b?.storyAssetId ?? ""}>
                        <option value="">Pick from the story bank…</option>
                        {stories.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.isExample ? " (example)" : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {a.example ? (
                    <details className="mt-3">
                      <summary className="text-xs text-ink-3 underline">See the worked example</summary>
                      <p className="mt-2 whitespace-pre-line text-xs text-ink-2">{a.example}</p>
                    </details>
                  ) : null}
                </Card>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <button className="btn btn-accent" type="submit">
              Save and write the script →
            </button>
            <Disclosure summary={<span className="btn btn-ghost btn-sm">+ Add a story to your bank</span>}>
              <div className="card p-4">
                <AssetForm type="story" back={`/webinars/${w.id}?step=beliefs`} />
              </div>
            </Disclosure>
          </div>
        </form>
      ) : null}

      {step === "script" && section && tpl ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="space-y-3">
            <div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 text-xs">
              {ACTS.map((a) => {
                const secs = sections.filter((s) => s.act === a.key);
                const done = secs.filter((s) => s.status !== "todo").length;
                const first = secs[0]?.sectionKey;
                return (
                  <Link key={a.key} href={`/webinars/${w.id}?step=script&section=${first}`} className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium ${a.key === act.key ? "bg-surface shadow-sm" : "text-ink-2"}`}>
                    {ACT_ICON[a.key]} {a.name.replace(/^[^\w]+/, "").replace(/ — .*/, "")} <span className="badge">{done}/{secs.length}</span>
                  </Link>
                );
              })}
            </div>
            <Card title={act.name.replace(/^[^\w]+/, "")}>
              <p className="text-xs text-ink-2">{act.tooltip}</p>
              {act.soundbite ? <p className="mt-2 text-xs italic text-ink-3">“{act.soundbite}”</p> : null}
              <ol className="-mx-2 mt-3 divide-y">
                {sections
                  .filter((s) => s.act === act.key)
                  .map((s) => (
                    <li key={s.id}>
                      <Link href={`/webinars/${w.id}?step=script&section=${s.sectionKey}`} className={`flex items-center gap-2 px-2 py-2 text-sm hover:bg-surface-2 ${s.sectionKey === section.sectionKey ? "bg-accent-soft" : ""}`}>
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${s.status === "final" ? "border-good bg-good text-white" : s.status === "drafted" ? "border-accent text-accent" : "border-line"}`}>
                          {s.status === "final" ? "✓" : s.status === "drafted" ? "…" : s.order}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                        <span className="text-[11px] text-ink-3">{s.durationMin}m</span>
                      </Link>
                    </li>
                  ))}
              </ol>
              <details className="mt-3">
                <summary className="text-xs text-ink-3 underline">Coaching for this act</summary>
                <p className="mt-2 whitespace-pre-line text-xs text-ink-2">{act.coachingPrompt}</p>
              </details>
            </Card>
          </div>

          <Card title={`${section.order}. ${section.name}`} action={<Badge tone={section.status === "final" ? "good" : section.status === "drafted" ? "accent" : "neutral"}>{section.status}</Badge>}>
            <p className="text-sm text-ink-2">{tpl.prompt}</p>
            <form action={updateSectionAction} className="mt-4 space-y-3">
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="sectionKey" value={section.sectionKey} />
              {sectionAssets.length ? (
                <Field label={`Pull a ${tpl.assetType} from the bank (optional)`}>
                  <select className="field" name="assetId" defaultValue={section.assetId ?? ""}>
                    <option value="">Write my own</option>
                    {sectionAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.isExample ? " (example)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {chosenAsset ? (
                <div className="rounded-lg bg-surface-2 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{chosenAsset.name}</div>
                    <CopyButton text={chosenAsset.body} label="Copy" className="btn btn-ghost btn-xs" />
                  </div>
                  <p className="mt-1 line-clamp-6 whitespace-pre-line text-ink-2">{chosenAsset.body}</p>
                  {chosenAsset.useWhen ? <p className="mt-1 text-ink-3">When: {chosenAsset.useWhen}</p> : null}
                </div>
              ) : null}
              <Field label="Key points (one per line)">
                <textarea className="field min-h-20" name="keyPoints" defaultValue={section.keyPoints ?? ""} placeholder={tpl.exampleKeyPoints} />
              </Field>
              <Field label="Script (what you'll actually say)">
                <textarea className="field min-h-56" name="script" defaultValue={section.script ?? ""} placeholder="Talk it out loud first. Then type what you said." />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Transition in">
                  <input className="field" name="transitionIn" defaultValue={section.transitionIn ?? ""} placeholder={tpl.exampleTransition?.split("|")[0]?.replace("In:", "").trim()} />
                </Field>
                <Field label="Transition out">
                  <input className="field" name="transitionOut" defaultValue={section.transitionOut ?? ""} placeholder={tpl.exampleTransition?.split("|")[1]?.replace("Out:", "").trim()} />
                </Field>
                <Field label="Minutes">
                  <input className="field tabular" name="durationMin" type="number" min={1} max={30} defaultValue={section.durationMin} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" name="status" value="drafted" defaultChecked={section.status !== "final"} /> Drafted
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" name="status" value="final" defaultChecked={section.status === "final"} /> Final
                </label>
                <span className="flex-1" />
                <button className="btn btn-ghost" type="submit">
                  Save
                </button>
                {nextSection ? (
                  <button className="btn btn-accent" type="submit" name="next" value={nextSection.sectionKey}>
                    Save and next →
                  </button>
                ) : (
                  <Link href={`/webinars/${w.id}?step=offer`} className="btn btn-accent">
                    On to the offer →
                  </Link>
                )}
              </div>
            </form>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
              <form action={draftSectionAction}>
                <input type="hidden" name="id" value={w.id} />
                <input type="hidden" name="sectionKey" value={section.sectionKey} />
                <input type="hidden" name="mode" value={ai ? "ai" : "example"} />
                <button className="btn btn-soft btn-sm" type="submit">
                  {ai ? "✨ Draft this section for me" : "Start from the example"}
                </button>
                <AiFormStatus feature="webinar_section" enabled={ai} onlyWhen={{ field: "mode", value: "ai" }} />
              </form>
              <details className="text-xs">
                <summary className="text-ink-3 underline">See the Leaky Webinar version</summary>
                <div className="mt-2 rounded-lg bg-surface-2 p-3">
                  <p className="whitespace-pre-line">{tpl.exampleScript}</p>
                  <p className="mt-2 text-ink-3">{tpl.exampleTransition}</p>
                </div>
              </details>
              <Disclosure summary={<span className="text-xs text-ink-3 underline">Frameworks, metaphors and proof ({frameworks.length + proofs.length})</span>}>
                <div className="mt-2 grid w-full gap-3 sm:grid-cols-2">
                  <div>
                    <div className="label">Frameworks and metaphors</div>
                    <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
                      {frameworks.map((f) => (
                        <li key={f.id} className="flex items-start justify-between gap-2 rounded bg-surface-2 p-2">
                          <span className="min-w-0">
                            <span className="font-semibold">{f.name}</span>
                            {f.extra.stage ? <span className="text-ink-3"> · {f.extra.stage}</span> : null}
                            <span className="block text-ink-2 line-clamp-2">{f.summary ?? f.body}</span>
                          </span>
                          <CopyButton text={[f.summary, f.body, f.extra.transitionIn ? `In: ${f.extra.transitionIn}` : "", f.extra.transitionOut ? `Out: ${f.extra.transitionOut}` : ""].filter(Boolean).join("\n\n")} label="Copy" className="btn btn-ghost btn-xs" />
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="label">Approved proof</div>
                    {proofs.length ? (
                      <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
                        {proofs.map((pr) => (
                          <li key={pr.id} className="flex items-start justify-between gap-2 rounded bg-surface-2 p-2">
                            <span className="min-w-0">
                              <span className="font-semibold">{pr.name}</span>
                              {pr.beliefBroken !== "none" ? <span className="text-ink-3"> · breaks {pr.beliefBroken}</span> : null}
                              <span className="block text-ink-2 line-clamp-2">{pr.shortVersion ?? pr.resultAfter}</span>
                            </span>
                            <CopyButton text={pr.longVersion ?? pr.shortVersion ?? pr.name} label="Copy" className="btn btn-ghost btn-xs" />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-ink-3">Approve proofs in the <Link href="/proof" className="underline">Proof Bank</Link> and they show up here.</p>
                    )}
                  </div>
                </div>
              </Disclosure>
              {tpl.assetType ? (
                <Disclosure summary={<span className="text-xs text-ink-3 underline">+ Add a {tpl.assetType} to your bank</span>}>
                  <div className="card p-4">
                    <AssetForm type={tpl.assetType} back={`/webinars/${w.id}?step=script&section=${section.sectionKey}`} />
                  </div>
                </Disclosure>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}

      {step === "offer" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card title="7 · Offer">
            <p className="mb-3 text-sm text-ink-2">{WIZARD_STAGES[6]?.description}</p>
            <form action={linkOfferAction} className="space-y-3">
              <input type="hidden" name="id" value={w.id} />
              <Field label="Which offer does this webinar sell?">
                <select className="field" name="offerId" defaultValue={w.offerId ?? ""}>
                  <option value="">Choose an offer…</option>
                  {offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} {o.price ? `· $${o.price.toLocaleString()}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Call to action">
                <select className="field" name="ctaType" defaultValue={w.ctaType}>
                  {["Book a call", "Buy now", "Apply", "Join the community", "Start the trial"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <div className="flex gap-2">
                <button className="btn btn-accent" type="submit">
                  Save and build the deck →
                </button>
                <Link href="/offers" className="btn btn-ghost">
                  Open the Offer Wizard
                </Link>
              </div>
            </form>
          </Card>
          <Card title="Map the stack to the belief breaks">
            {offer ? (
              <div className="space-y-2 text-sm">
                <div className="font-semibold">{offer.name}</div>
                {offer.promise ? <p className="text-ink-2">{offer.promise}</p> : null}
                <ul className="mt-2 divide-y">
                  {components.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span>
                        {c.type === "bonus" ? "🎁" : c.type === "guarantee" ? "🛡️" : "📦"} {c.name}
                      </span>
                      <span className="flex items-center gap-2 text-xs">
                        {c.beliefBreak !== "none" ? <Badge tone="accent">{ACT_ICON[c.beliefBreak]} solves {c.beliefBreak}</Badge> : <Badge tone="warn">untagged</Badge>}
                        <span className="tabular text-ink-3">${c.perceivedValue.toLocaleString()}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-3">Every component should answer one of the three belief breaks. Three keys, three locks. Tag them in the Offer Wizard.</p>
                <Link href={`/offers/${offer.id}#stack`} className="text-xs underline">
                  Edit the stack →
                </Link>
              </div>
            ) : (
              <p className="text-sm text-ink-2">Pick an offer and its stack shows here, tagged by which belief break each component solves.</p>
            )}
          </Card>
        </div>
      ) : null}

      {step === "deck" ? (
        <DeckStep webinarId={w.id} sections={sections} />
      ) : null}

      {step === "review" ? (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card title="10 · Readiness review" action={review ? <Badge tone={review.verdict === "ready" ? "good" : review.verdict === "needs_work" ? "warn" : "danger"}>{review.score}% · {review.verdict.replace("_", " ")}</Badge> : null}>
            <p className="mb-3 text-sm text-ink-2">Grade honestly. 1 = missing, 5 = I&apos;d bet money on it. Anything at 2 or below blocks &ldquo;ready&rdquo;.</p>
            <form action={saveReadinessAction} className="space-y-3">
              <input type="hidden" name="id" value={w.id} />
              {READINESS_DIMENSIONS.map((d) => (
                <div key={d.key} className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
                  <div>
                    <div className="text-sm font-medium">{d.label}</div>
                    <div className="text-xs text-ink-3">{d.hint}</div>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="cursor-pointer">
                        <input type="radio" name={`r_${d.key}`} value={n} defaultChecked={(review?.ratings[d.key] ?? 3) === n} className="peer sr-only" />
                        <span className="grid h-8 w-8 place-items-center rounded-lg border text-sm peer-checked:border-accent peer-checked:bg-accent-soft">{n}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <Field label="Biggest gaps">
                <textarea className="field" name="biggestGaps" defaultValue={review?.biggestGaps ?? ""} placeholder="What's weakest? What would a skeptic poke at?" />
              </Field>
              <Field label="Next actions">
                <textarea className="field" name="nextActions" defaultValue={review?.nextActions ?? ""} placeholder="Three fixes before the next run." />
              </Field>
              <button className="btn btn-accent" type="submit">
                Save review
              </button>
            </form>
          </Card>
          <div className="space-y-4">
            {review ? (
              <Card title="Verdict">
                <div className="text-4xl font-semibold">{review.score}%</div>
                <div className="mt-1 text-sm">{review.verdict === "ready" ? "Presentation-ready. Schedule it." : review.verdict === "needs_work" ? "Close. Fix the weak spots and re-review." : "Not yet. Back to the script."}</div>
                {readinessScore(review.ratings).weakest.length ? <p className="mt-2 text-xs text-warn">Blocking: {readinessScore(review.ratings).weakest.join(", ")}</p> : null}
              </Card>
            ) : null}
            <Card title="Build check">
              <ul className="space-y-1.5 text-sm">
                <li>{progress.steps.foundation >= 1 ? "✅" : "⬜"} Foundation filled</li>
                <li>{progress.steps.beliefs >= 1 ? "✅" : "⬜"} Three belief shifts written</li>
                <li>{progress.drafted >= sections.length ? "✅" : "⬜"} All {sections.length} sections drafted ({progress.drafted})</li>
                <li>{w.offerId ? "✅" : "⬜"} Offer linked</li>
                <li>{components.length && components.every((c) => c.beliefBreak !== "none") ? "✅" : "⬜"} Stack mapped to belief breaks</li>
                <li>{progress.totalMinutes >= 55 && progress.totalMinutes <= 95 ? "✅" : "⬜"} Runtime between 55 and 95 min ({progress.totalMinutes})</li>
              </ul>
            </Card>
          </div>
        </div>
      ) : null}

      {step === "run" ? (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card title="Run it" action={<Badge tone={w.status === "delivered" ? "good" : "accent"}>{w.status}</Badge>}>
            <form action={updateRunAction} className="space-y-4">
              <input type="hidden" name="id" value={w.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Status">
                  <select className="field" name="status" defaultValue={w.status}>
                    {["building", "ready", "scheduled", "delivered"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date and time">
                  <input className="field" name="scheduledAt" type="datetime-local" defaultValue={w.scheduledAt?.slice(0, 16) ?? ""} />
                </Field>
                <Field label="Registration page">
                  <input className="field" name="registrationUrl" type="url" defaultValue={w.registrationUrl ?? ""} />
                </Field>
                <Field label="Deck link">
                  <input className="field" name="deckUrl" type="url" defaultValue={w.deckUrl ?? ""} />
                </Field>
                <Field label="Replay link">
                  <input className="field" name="replayUrl" type="url" defaultValue={w.replayUrl ?? ""} />
                </Field>
              </div>
              <div className="label">The numbers (fill after the event)</div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {[
                  ["registered", "Registered"],
                  ["showed", "Showed"],
                  ["offersMade", "Offers"],
                  ["callsBooked", "Calls"],
                  ["sales", "Sales"],
                  ["revenue", "Revenue $"],
                ].map(([k, label]) => (
                  <label key={k} className="block">
                    <span className="label">{label}</span>
                    <input className="field tabular" name={k} type="number" min={0} defaultValue={Number(w[k as "registered"])} />
                  </label>
                ))}
              </div>
              <div className="label">Debrief (this is the Optimize stage)</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Biggest leak">
                  <textarea className="field" name="debriefLeak" defaultValue={w.debriefLeak ?? ""} placeholder="Where did people drop off?" />
                </Field>
                <Field label="One fix">
                  <textarea className="field" name="debriefFix" defaultValue={w.debriefFix ?? ""} placeholder="One thing. Not five." />
                </Field>
                <Field label="Wins">
                  <textarea className="field" name="debriefWins" defaultValue={w.debriefWins ?? ""} />
                </Field>
              </div>
              <button className="btn btn-accent" type="submit">
                Save
              </button>
            </form>
          </Card>
          <div className="space-y-4">
            <Card title="Funnel">
              {w.registered ? (
                <ul className="space-y-1.5 text-sm tabular">
                  <li className="flex justify-between">
                    <span>Show-up rate</span>
                    <span>{Math.round((w.showed / w.registered) * 100)}%</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Calls per attendee</span>
                    <span>{w.showed ? Math.round((w.callsBooked / w.showed) * 100) : 0}%</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Sales per attendee</span>
                    <span>{w.showed ? Math.round((w.sales / w.showed) * 100) : 0}%</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Revenue per registrant</span>
                    <span>${Math.round(w.revenue / w.registered).toLocaleString()}</span>
                  </li>
                </ul>
              ) : (
                <p className="text-sm text-ink-2">Log registrations and show-ups after the event and the funnel math appears here. Every leak shows up in these four numbers.</p>
              )}
            </Card>
            <Card title="Before you go live">
              <ul className="space-y-1.5 text-sm">
                <li>⬜ Tech rehearsal done</li>
                <li>⬜ Reminder sequence live (48h, 24h, 1h)</li>
                <li>⬜ Offer page and payment link tested</li>
                <li>⬜ Replay + follow-up emails scheduled</li>
                <li>⬜ Non-buyer DM follow-up planned</li>
              </ul>
              <p className="mt-2 text-xs text-ink-3">These are pathway tasks in the Launch stage. Verify them there for points.</p>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}

function DeckStep({ webinarId, sections }: { webinarId: string; sections: { order: number; act: "opening" | "vehicle" | "internal" | "external" | "closing"; name: string; keyPoints: string | null; script: string | null }[] }) {
  const slides = deckOutline(sections);
  const md = slides.map((s) => `## ${s.n}. ${s.headline}\n_${s.section}_\n${s.body}\n\nVisual: ${s.visual}`).join("\n\n");
  return (
    <Card
      title={`9 · Deck outline · ${slides.length} slides`}
      action={
        <span className="flex flex-wrap gap-2">
          <a className="btn btn-primary btn-sm" href={`/api/webinars/${webinarId}/deck?format=pptx`} download data-testid="deck-pptx">
            Download .pptx
          </a>
          <a className="btn btn-ghost btn-sm" href={`/api/webinars/${webinarId}/deck?format=txt`} download>
            Outline (.txt)
          </a>
          <CopyButton text={md} label="Copy all" className="btn btn-ghost btn-sm" />
        </span>
      }
    >
      <p className="mb-3 text-sm text-ink-2">One idea per slide, derived from your key points, so tighten those first. The .pptx opens in PowerPoint, Keynote, Google Slides and Canva (Import) with the art direction in each slide&apos;s notes; or copy one slide at a time.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {slides.map((s) => (
          <div key={s.n} className="rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between text-[11px] text-ink-3">
              <span>
                {s.n} · {s.section}
              </span>
              <span>{ACT_ICON[s.act]}</span>
            </div>
            <div className="mt-1 font-semibold">{s.headline}</div>
            {s.body ? <p className="mt-1 whitespace-pre-line text-xs text-ink-2">{s.body}</p> : null}
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] italic text-ink-3">{s.visual}</p>
              <CopyButton text={`${s.headline}\n${s.body}\n\nVisual: ${s.visual}`} label="Copy" className="btn btn-ghost btn-xs" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Link href={`/webinars/${webinarId}?step=review`} className="btn btn-accent">
          On to the readiness review →
        </Link>
      </div>
    </Card>
  );
}
