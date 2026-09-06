import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { OFFER_CONTAINERS } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { addComponentAction, deleteOfferAction, updateComponentAction, updateOfferAction } from "@/lib/actions/offers";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Field, PageHeader, Progress } from "@/components/ui";
import { offerOnePager, scoreOffer } from "@/lib/engine/offer-score";
import { assetsFor } from "@/lib/queries/library";

function T({ name, label, value, hint, placeholder }: { name: string; label: string; value: string | null; hint?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <textarea className="field" name={name} defaultValue={value ?? ""} placeholder={placeholder} />
    </Field>
  );
}

const BREAK_LABEL: Record<string, string> = { vehicle: "🎯 Vehicle: proves the method works", internal: "💪 Internal: carries the load for them", external: "🌍 External: wins the outside game", none: "Untagged" };

export default async function OfferWizardPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const offer = await db.query.offers.findFirst({ where: and(eq(schema.offers.id, id), eq(schema.offers.userId, v.user.id)) });
  if (!offer) notFound();
  const [components, objections, proofs] = await Promise.all([
    db.query.offerComponents.findMany({ where: eq(schema.offerComponents.offerId, id), orderBy: asc(schema.offerComponents.order) }),
    assetsFor(v.workspace.id, v.user.id, "objection"),
    db.query.proofs.findMany({ where: and(eq(schema.proofs.userId, v.user.id), eq(schema.proofs.status, "approved")) }),
  ]);
  const r = scoreOffer(offer, components);
  const onePager = offerOnePager(offer, components);
  const groups = ["clarity", "belief", "value", "risk"] as const;

  return (
    <>
      <PageHeader
        title={offer.name}
        subtitle={
          <span className="flex items-center gap-2">
            <Link href="/offers" className="hover:underline">
              ← Offers
            </Link>
            <Badge tone={r.verdict === "ready" ? "good" : r.verdict === "needs_work" ? "accent" : "warn"}>
              {r.score}% · {r.verdict.replace("_", " ")}
            </Badge>
          </span>
        }
        action={
          <div className="flex gap-2">
            <CopyButton text={onePager} label="Copy one-pager" />
            <form action={deleteOfferAction}>
              <input type="hidden" name="id" value={offer.id} />
              <button className="btn btn-ghost btn-sm" type="submit">
                Delete
              </button>
            </form>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <form action={updateOfferAction} className="space-y-4">
            <input type="hidden" name="id" value={offer.id} />
            <Card id="who" title="1 · Who and what" action={<button className="btn btn-accent btn-sm" type="submit">Save offer</button>}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Offer name">
                  <input className="field" name="name" defaultValue={offer.name} required />
                </Field>
                <Field label="Status">
                  <select className="field" name="status" defaultValue={offer.status}>
                    <option value="draft">Draft</option>
                    <option value="live">Live</option>
                    <option value="retired">Retired</option>
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <T name="avatar" label="The one person this is for" value={offer.avatar} hint="Not 'business owners'. One specific human with a pain, a goal, and things they've already tried." placeholder="Busy moms of school-age kids who've tried every diet and quit by week three." />
                </div>
                <div className="sm:col-span-2">
                  <T name="coreProblem" label="Their core problem, in their words" value={offer.coreProblem} placeholder="I lose 10 lbs and gain it back every single time. I'm sick of starting over." />
                </div>
              </div>
            </Card>
            <Card id="promise" title="2 · The Big Promise">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <T name="promise" label="I help [who] go from [pain] to [outcome] in [time] without [thing they hate]" value={offer.promise} hint="A number, a clock, and a 'without'. That's what makes it repeatable." placeholder="I help busy moms drop 15 lbs in 90 days without giving up wine or weekends." />
                </div>
                <T name="oneBelief" label="The ONE belief (domino)" value={offer.oneBelief} hint="If they believe this, they buy." placeholder="If they believe the plan does the work and they only have to follow it, they buy." />
                <T name="difference" label="How is this different from everything they've seen?" value={offer.difference} />
              </div>
            </Card>
            <Card id="method" title="3 · Your method">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Named mechanism" hint="Capital letters. Yours.">
                  <input className="field" name="mechanismName" defaultValue={offer.mechanismName ?? ""} placeholder="The 12-Minute Tuesday System" />
                </Field>
                <Field label="Container">
                  <select className="field" name="container" defaultValue={offer.container}>
                    {OFFER_CONTAINERS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <div className="label">The path (3 to 5 steps from problem to promise)</div>
                  <div className="grid gap-2 sm:grid-cols-5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <input key={i} className="field" name={`step${i}`} defaultValue={offer.pathSteps[i - 1] ?? ""} placeholder={`Step ${i}`} />
                    ))}
                  </div>
                </div>
                <T name="howItWorks" label="How it works (delivery)" value={offer.howItWorks} placeholder="Two 30-minute group calls a week, a daily check-in, templates for every meal." />
                <Field label="Length">
                  <input className="field" name="length" defaultValue={offer.length ?? ""} placeholder="90 days" />
                </Field>
              </div>
            </Card>
            <Card id="price" title="4 · Price and risk">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Price ($)">
                  <input className="field tabular" name="price" type="number" min={0} defaultValue={offer.price} />
                </Field>
                <Field label="Payment plan">
                  <input className="field" name="paymentPlan" defaultValue={offer.paymentPlan ?? ""} placeholder="3 x $550" />
                </Field>
                <div className="sm:col-span-2">
                  <T name="guarantee" label="Guarantee / risk reversal" value={offer.guarantee} placeholder="Follow the plan for 90 days and don't lose 10 lbs? I coach you free until you do." />
                </div>
                <T name="whyNow" label="Why now" value={offer.whyNow} placeholder="Next cohort opens Monday. 12 seats." />
                <T name="whyTrust" label="Why trust you" value={offer.whyTrust} placeholder="Results, years, your own story." />
                <T name="scarcity" label="Scarcity (real)" value={offer.scarcity} />
                <T name="urgency" label="Urgency (real)" value={offer.urgency} />
              </div>
            </Card>
            <Card id="fit" title="5 · Fit">
              <div className="grid gap-3 sm:grid-cols-2">
                <T name="forYouIf" label="This is for you if…" value={offer.forYouIf} />
                <T name="notForYouIf" label="This is not for you if…" value={offer.notForYouIf} />
              </div>
            </Card>
            <Card id="objections" title="6 · Top 5 objections, answered">
              <div className="grid gap-3 sm:grid-cols-2">
                <T name="objTime" label="“I don't have time.”" value={offer.objTime} />
                <T name="objMoney" label="“I don't have the money.”" value={offer.objMoney} />
                <T name="objPartner" label="“I need to ask my partner.”" value={offer.objPartner} />
                <T name="objTriedBefore" label="“I've tried this before.”" value={offer.objTriedBefore} />
                <T name="objDiy" label="“I'll do it myself.”" value={offer.objDiy} />
                <div>
                  <div className="label">Steal a reframe</div>
                  <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                    {objections.slice(0, 12).map((o) => (
                      <li key={o.id} className="flex items-start justify-between gap-2 rounded bg-surface-2 p-2">
                        <span>
                          <span className="font-semibold">{o.name}</span>
                          {o.reframe ? <span className="block text-ink-2 line-clamp-2">{o.reframe}</span> : null}
                        </span>
                        {o.reframe ? <CopyButton text={o.reframe} label="Copy" className="btn btn-ghost btn-xs" /> : null}
                      </li>
                    ))}
                  </ul>
                  {proofs.length ? (
                    <>
                      <div className="label mt-3">Answer with proof</div>
                      <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                        {proofs.map((pr) => (
                          <li key={pr.id} className="flex items-start justify-between gap-2 rounded bg-surface-2 p-2">
                            <span className="line-clamp-2">{pr.shortVersion ?? pr.name}</span>
                            <CopyButton text={pr.shortVersion ?? pr.name} label="Copy" className="btn btn-ghost btn-xs" />
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>
            <Card title="Links">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sales page">
                  <input className="field" name="salesPageUrl" type="url" defaultValue={offer.salesPageUrl ?? ""} />
                </Field>
                <Field label="Payment link">
                  <input className="field" name="paymentLink" type="url" defaultValue={offer.paymentLink ?? ""} />
                </Field>
                <div className="sm:col-span-2">
                  <T name="notes" label="Notes" value={offer.notes} />
                </div>
              </div>
            </Card>
            <div className="flex justify-end">
              <button className="btn btn-accent" type="submit">
                Save offer
              </button>
            </div>
          </form>

          <Card id="stack" title="7 · The stack" action={<span className="text-xs text-ink-3">${r.stackValue.toLocaleString()} value · {r.multiple ? `${r.multiple.toFixed(1)}x` : "—"} price</span>}>
            {components.length ? (
              <ul className="mb-4 divide-y">
                {components.map((c) => (
                  <li key={c.id} className="py-2">
                    <form action={updateComponentAction} className="grid items-end gap-2 sm:grid-cols-[1.4fr_0.8fr_0.8fr_1.2fr_auto_auto]">
                      <input type="hidden" name="id" value={c.id} />
                      <input className="field" name="name" defaultValue={c.name} />
                      <select className="field" name="type" defaultValue={c.type}>
                        <option value="core">Core</option>
                        <option value="bonus">Bonus</option>
                        <option value="guarantee">Guarantee</option>
                      </select>
                      <input className="field tabular" name="perceivedValue" type="number" min={0} defaultValue={c.perceivedValue} />
                      <select className="field" name="beliefBreak" defaultValue={c.beliefBreak}>
                        {Object.entries(BREAK_LABEL).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-ghost btn-sm" type="submit">
                        Save
                      </button>
                      <button className="btn btn-ghost btn-sm" type="submit" name="delete" value="1" title="Remove">
                        ✕
                      </button>
                      {c.description ? <p className="text-xs text-ink-3 sm:col-span-6">{c.description}</p> : null}
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-ink-2">Empty stack. Add the core deliverable first, then bonuses that remove reasons to stall.</p>
            )}
            <form action={addComponentAction} className="grid items-end gap-2 rounded-lg bg-surface-2 p-3 sm:grid-cols-[1.4fr_0.8fr_0.8fr_1.2fr_auto]">
              <input type="hidden" name="offerId" value={offer.id} />
              <Field label="Component">
                <input className="field" name="name" required placeholder="Weekend Playbook" />
              </Field>
              <Field label="Type">
                <select className="field" name="type" defaultValue="bonus">
                  <option value="core">Core</option>
                  <option value="bonus">Bonus</option>
                  <option value="guarantee">Guarantee</option>
                </select>
              </Field>
              <Field label="Value $">
                <input className="field tabular" name="perceivedValue" type="number" min={0} placeholder="497" />
              </Field>
              <Field label="Solves which belief?">
                <select className="field" name="beliefBreak" defaultValue="none">
                  {Object.entries(BREAK_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="btn btn-primary btn-sm" type="submit">
                Add
              </button>
            </form>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card title="Optimizer">
            <div className="flex items-end gap-3">
              <div className="text-5xl font-semibold leading-none">{r.score}</div>
              <div className="pb-1 text-sm text-ink-2">/ 100 · {r.verdict === "ready" ? "ready to sell" : r.verdict === "needs_work" ? "needs work" : "not ready"}</div>
            </div>
            <div className="mt-3">
              <Progress value={r.score} tone={r.verdict === "ready" ? "good" : r.verdict === "needs_work" ? "accent" : "warn"} />
            </div>
            <div className="mt-4 space-y-3">
              {groups.map((g) => {
                const items = r.checks.filter((c) => c.group === g);
                return (
                  <div key={g}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{g}</div>
                    <ul className="space-y-1">
                      {items.map((c) => (
                        <li key={c.key} className="text-sm">
                          <div className="flex items-start gap-2">
                            <span className={c.pass ? "text-good" : "text-warn"}>{c.pass ? "✓" : "○"}</span>
                            <div className="min-w-0">
                              <div className={c.pass ? "text-ink-2" : "font-medium"}>{c.label}</div>
                              {!c.pass ? <div className="text-xs text-ink-3">{c.fix}</div> : null}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="One-pager preview" action={<CopyButton text={onePager} label="Copy" className="btn btn-ghost btn-xs" />}>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-ink-2">{onePager}</pre>
          </Card>
        </div>
      </div>
    </>
  );
}
