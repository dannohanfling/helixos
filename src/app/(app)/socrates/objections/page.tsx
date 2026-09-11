import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { BELIEF_KEYS } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { createObjectionAction, deleteObjectionAction, updateObjectionAction } from "@/lib/actions/objections";
import { assetsFor } from "@/lib/queries/library";
import { BELIEF_LABEL, OBJECTION_METHOD, REFRAME_STEP_KEY, handledIn, isSharedObjection, methodReady, reframesOf } from "@/lib/engine/objections";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Disclosure, Field, PageHeader } from "@/components/ui";

export const metadata = { title: "Objections" };

/**
 * Objections: a view over the one record (the asset bank's objection type), not a second store. The shared set is Evolve
 * Omega's and read-only; a client's own are theirs to edit. The handling method is a sequence and is shown only once every
 * step has its words; the reframe step is where the library is reached from.
 */
export default async function ObjectionsPage() {
  const v = await requireViewer();
  const [objections, offers, sections] = await Promise.all([
    assetsFor(v.workspace.id, v.user.id, "objection"),
    db.query.offers.findMany({ where: eq(schema.offers.userId, v.user.id) }),
    db.query.webinarSections.findMany(),
  ]);
  const myWebinars = await db.query.webinars.findMany({ where: eq(schema.webinars.userId, v.user.id) });
  const mine = new Set(myWebinars.map((w) => w.id));
  const mySections = sections.filter((s) => mine.has(s.webinarId));
  const titles = new Map(myWebinars.map((w) => [w.id, w.title]));
  void inArray;
  const own = objections.filter((o) => o.userId === v.user.id);
  const shared = objections.filter(isSharedObjection);
  const ready = methodReady();
  return (
    <>
      <PageHeader title="Objections" subtitle={<span>One record for every objection: their words, what is underneath, which belief, and every reframe you have for it. The offer wizard, the webinar wizard and Scripts read from here. Your reframes for the four groups are in the <Link href="/socrates/reframes" className="underline">reframe library</Link>.</span>} />
      {ready ? (
        <Card title="Handling one, in order">
          <ol className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3" data-testid="objection-method">
            {OBJECTION_METHOD.map((st, i) => (
              <li key={st.key} className="rounded-lg bg-surface-2 p-3">
                <div className="text-xs font-semibold text-ink-2">{i + 1}. {st.title}</div>
                <div className="mt-1">{st.line}</div>
                {st.key === REFRAME_STEP_KEY ? <a href="#library" className="mt-1 inline-block text-xs underline">Your reframes, below</a> : null}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]" id="library">
        <div className="space-y-4">
          <Card title="Yours" action={<Badge tone={own.length ? "good" : "neutral"}>{own.length}</Badge>}>
            {own.length ? (
              <ul className="space-y-3" data-testid="own-objections">
                {own.map((o) => {
                  const where = handledIn(o, mySections, offers, titles);
                  return (
                    <li key={o.id} id={`o-${o.id}`} className="rounded-lg border p-3" data-testid="objection" data-id={o.id} data-belief={o.belief ?? ""}>
                      <Disclosure summary={<span className="text-sm font-semibold">{o.name}</span>}>
                        <form action={updateObjectionAction} className="space-y-2 text-sm">
                          <input type="hidden" name="id" value={o.id} />
                          <Field label="In their words">
                            <input className="field" name="name" defaultValue={o.name} />
                          </Field>
                          <Field label="What they say, longer">
                            <textarea className="field" name="body" rows={2} defaultValue={o.body} />
                          </Field>
                          <Field label="What is underneath" hint="The real concern behind the words. A reframe aimed at the words misses.">
                            <textarea className="field" name="underneath" rows={2} defaultValue={o.underneath ?? ""} data-testid="objection-underneath" />
                          </Field>
                          <Field label="Which belief" hint="The same three the proof bank and the webinar use. 'Not a belief' is a real answer.">
                            <select className="field" name="belief" defaultValue={o.belief ?? ""} data-testid="objection-belief">
                              <option value="">Not mapped yet</option>
                              {BELIEF_KEYS.map((k) => (
                                <option key={k} value={k}>{BELIEF_LABEL[k]}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Reframes" hint="One per box. Add another for a second answer.">
                            <div className="space-y-1">
                              {[...reframesOf(o), ""].map((r, i) => (
                                <textarea key={i} className="field" name="reframes" rows={2} defaultValue={r} data-testid="objection-reframe" />
                              ))}
                            </div>
                          </Field>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="Proof that answers it">
                              <input className="field" name="proof" defaultValue={o.proof ?? ""} />
                            </Field>
                            <Field label="When to use it">
                              <input className="field" name="useWhen" defaultValue={o.useWhen ?? ""} />
                            </Field>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button className="btn btn-accent btn-sm" type="submit">Save</button>
                          </div>
                        </form>
                        <form action={deleteObjectionAction} className="mt-2">
                          <input type="hidden" name="id" value={o.id} />
                          <button className="text-xs text-ink-3 underline" type="submit">Delete</button>
                        </form>
                      </Disclosure>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {o.belief ? <Badge tone="accent">{o.belief}</Badge> : <Badge tone="neutral">belief not mapped</Badge>}
                        <span className="text-ink-3">{reframesOf(o).length} reframe{reframesOf(o).length === 1 ? "" : "s"}</span>
                        {where.length ? (
                          <span className="text-ink-3" data-testid="handled-in">
                            Already handled in: {where.map((w, i) => (
                              <span key={w.href}>
                                {i ? ", " : ""}
                                <Link href={w.href} className="underline">{w.label}</Link>
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-ink-3">Not yet used in a webinar or an offer.</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">None of your own yet. Add the ones you actually hear.</p>
            )}
          </Card>
          <Card title="Shared starter set" action={<Badge tone="neutral">shared · Evolve Omega</Badge>}>
            <p className="mb-2 text-xs text-ink-3">Danno&apos;s objections, shared with every client. The belief mapping is his to correct. Read-only here; add your own version above to change the words.</p>
            <ul className="space-y-2" data-testid="shared-objections">
              {shared.map((o) => {
                const rs = reframesOf(o);
                return (
                  <li key={o.id} className="rounded-lg border border-dashed bg-surface-2 p-3 text-sm" data-testid="shared-objection" data-belief={o.belief ?? ""} data-name={o.name}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{o.name}</span>
                      {o.tag ? <Badge tone="neutral">{o.tag}</Badge> : null}
                      {o.belief ? <Badge tone="accent">{o.belief}</Badge> : null}
                    </div>
                    <p className="mt-1 text-ink-2">{o.body}</p>
                    {rs.length ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-ink-3">{rs.length} reframe{rs.length === 1 ? "" : "s"}</summary>
                        {rs.map((r, i) => (
                          <div key={i} className="mt-1 flex items-start justify-between gap-2 rounded bg-surface p-2 text-xs">
                            <span className="whitespace-pre-line">{r}</span>
                            <CopyButton text={r} label="Copy" className="btn btn-ghost btn-xs" />
                          </div>
                        ))}
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
        <Card title="Add one you actually hear">
          <form action={createObjectionAction} className="space-y-2 text-sm" data-testid="objection-form">
            <Field label="In their words">
              <input className="field" name="name" required data-testid="new-objection-name" />
            </Field>
            <Field label="What they say, longer">
              <textarea className="field" name="body" rows={2} />
            </Field>
            <Field label="What is underneath" hint="The real concern behind the words.">
              <textarea className="field" name="underneath" rows={2} data-testid="new-objection-underneath" />
            </Field>
            <Field label="Which belief">
              <select className="field" name="belief" defaultValue="" data-testid="new-objection-belief">
                <option value="">Not mapped yet</option>
                {BELIEF_KEYS.map((k) => (
                  <option key={k} value={k}>{BELIEF_LABEL[k]}</option>
                ))}
              </select>
            </Field>
            <Field label="Reframes" hint="One per box.">
              <div className="space-y-1">
                <textarea className="field" name="reframes" rows={2} data-testid="new-objection-reframe" />
                <textarea className="field" name="reframes" rows={2} data-testid="new-objection-reframe" />
              </div>
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Proof that answers it">
                <input className="field" name="proof" />
              </Field>
              <Field label="When to use it">
                <input className="field" name="useWhen" />
              </Field>
            </div>
            <button className="btn btn-accent btn-sm" type="submit">Save to my objections</button>
          </form>
        </Card>
      </div>
    </>
  );
}
