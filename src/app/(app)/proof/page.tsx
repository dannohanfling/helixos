import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PROOF_TYPES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { createProofAction, proofFromCheckinAction } from "@/lib/actions/proofs";
import { Badge, Card, Disclosure, Empty, Field, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { fathomKeyFor } from "@/lib/fathom";

export const metadata = { title: "Proof Bank" };

const TYPE_LABEL: Record<string, string> = { result: "Result", testimonial: "Testimonial", screenshot: "Screenshot", case_study: "Case study", stat: "Stat", story: "Story" };

export default async function ProofPage() {
  const v = await requireViewer();
  const [rows, checkins, clients] = await Promise.all([
    db.query.proofs.findMany({ where: eq(schema.proofs.userId, v.user.id), orderBy: desc(schema.proofs.createdAt) }),
    db.query.clientCheckins.findMany({ where: eq(schema.clientCheckins.userId, v.user.id), orderBy: desc(schema.clientCheckins.date), limit: 40 }),
    db.query.clientRecords.findMany({ where: eq(schema.clientRecords.userId, v.user.id) }),
  ]);
  const fathom = await fathomKeyFor(v.workspace.id, v.user.id);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const captured = new Set(rows.map((r) => r.resultAfter));
  const wins = checkins.filter((k) => k.wins && !captured.has(k.wins)).slice(0, 6);
  const approved = rows.filter((r) => r.status === "approved").length;
  const grandfathered = rows.filter((r) => r.status === "approved" && !r.permissionAt).length;
  return (
    <>
      <PageHeader title="Proof Bank" subtitle={<span>{rows.length} proofs · {approved} approved to use{grandfathered ? <span data-testid="grandfathered-count"> ({grandfathered} approved before the permission tick; they stay approved)</span> : null}. Every win your clients get is a post, a webinar slide, and an objection answer.</span>} />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          {rows.length ? (
            <Card title="Your proof">
              <ul className="divide-y">
                {rows.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <Link href={`/proof/${r.id}`} className="flex items-start gap-3 hover:underline">
                      <span className="mt-0.5 text-lg">{r.type === "testimonial" ? "💬" : r.type === "screenshot" ? "📸" : r.type === "case_study" ? "📚" : r.type === "stat" ? "📈" : r.type === "story" ? "📖" : "🏆"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{r.name}</span>
                        <span className="block truncate text-sm text-ink-2">{r.shortVersion ?? r.resultAfter ?? ""}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={r.status === "approved" ? "good" : "neutral"}>{r.status}</Badge>
                        <span className="text-[11px] text-ink-3">{TYPE_LABEL[r.type]}{r.beliefBroken !== "none" ? ` · breaks ${r.beliefBroken} belief` : ""}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card>
              <Empty icon="🏆" title="No proof yet" hint="Add a result, a testimonial or a screenshot. Or pull a win straight from a client check-in." />
            </Card>
          )}
          {wins.length ? (
            <Card title="Wins from client check-ins" action={<span className="text-xs text-ink-3">one click to capture</span>}>
              <ul className="space-y-2">
                {wins.map((k) => (
                  <li key={k.id} className="flex items-start gap-3 rounded-lg bg-surface-2 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-ink-3">{clientName.get(k.clientRecordId) ?? "Client"} · {formatDate(k.date)}</div>
                      <div>{k.wins}</div>
                    </div>
                    <form action={proofFromCheckinAction}>
                      <input type="hidden" name="checkinId" value={k.id} />
                      <button className="btn btn-soft btn-xs" type="submit">Capture</button>
                    </form>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
        <Card title="🎙️ Harvest from Fathom" action={fathom ? <Badge tone="good">connected</Badge> : <Badge tone="neutral">not connected</Badge>}>
          {fathom ? (
            <>
              <p className="text-sm text-ink-2">Pick one of your recorded calls and pull your client&apos;s own words out of it, word for word, with a link back to the moment.</p>
              <Link href="/proof/harvest" className="btn btn-accent btn-sm mt-3 inline-block" data-testid="harvest-link">Pick a recording →</Link>
            </>
          ) : (
            <p className="text-sm" data-testid="harvest-needs-key">
              Not connected. <Link href="/settings#fathom" className="underline">Paste your Fathom API key in Settings</Link> to pick a recording and pull quotes from it.
            </p>
          )}
        </Card>
        <Card title="Add proof">
          <form action={createProofAction} className="space-y-3">
            <Field label="Name it">
              <input className="field" name="name" required placeholder="Sarah: 11 lbs by week 6" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select className="field" name="type" defaultValue="result">
                  {PROOF_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </Field>
              <Field label="Who">
                <input className="field" name="who" placeholder="Sarah, mom of 2" />
              </Field>
            </div>
            <Field label="Before (their words)">
              <input className="field" name="problemBefore" placeholder="I quit every diet by week three." />
            </Field>
            <Field label="After">
              <input className="field" name="resultAfter" placeholder="Down 11 lbs. Wine on Saturday. Still going." />
            </Field>
            <Disclosure summary={<span className="text-xs text-ink-3 underline">More (shift, belief, link, client)</span>}>
              <div className="mt-2 space-y-3">
                <Field label="What shifted">
                  <input className="field" name="shift" placeholder="She stopped planning and started picking." />
                </Field>
                <Field label="Belief it breaks">
                  <select className="field" name="beliefBroken" defaultValue="none">
                    <option value="none">None in particular</option>
                    <option value="vehicle">Vehicle: this method works</option>
                    <option value="internal">Internal: I can do this</option>
                    <option value="external">External: my life allows this</option>
                  </select>
                </Field>
                <Field label="Link (screenshot, post, video)">
                  <input className="field" name="link" type="url" placeholder="https://…" />
                </Field>
                <Field label="Client">
                  <select className="field" name="clientRecordId" defaultValue="">
                    <option value="">Not linked</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              </div>
            </Disclosure>
            <button className="btn btn-primary" type="submit">Save proof</button>
          </form>
        </Card>
        </div>
      </div>
    </>
  );
}
