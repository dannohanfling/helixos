import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { PROOF_TYPES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { deleteProofAction, proofToContentAction, updateProofAction } from "@/lib/actions/proofs";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Field, PageHeader } from "@/components/ui";

const TYPE_LABEL: Record<string, string> = { result: "Result", testimonial: "Testimonial", screenshot: "Screenshot", case_study: "Case study", stat: "Stat", story: "Story" };

export default async function ProofDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const p = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, id), eq(schema.proofs.userId, v.user.id)) });
  if (!p) notFound();
  const oneLiner = p.shortVersion ?? p.resultAfter ?? p.name;
  const slide = [p.who ? `${p.who}` : "", p.problemBefore ? `Before: ${p.problemBefore}` : "", p.resultAfter ? `After: ${p.resultAfter}` : "", p.shift ? `The shift: ${p.shift}` : ""].filter(Boolean).join("\n");
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={<Link href="/proof" className="hover:underline">← Proof Bank</Link>}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={p.status === "approved" ? "good" : "neutral"}>{p.status}</Badge>
            <form action={proofToContentAction}>
              <input type="hidden" name="id" value={p.id} />
              <button className="btn btn-accent btn-sm" type="submit">✍️ Draft a win post</button>
            </form>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Edit">
          <form action={updateProofAction} className="space-y-3">
            <input type="hidden" name="id" value={p.id} />
            <Field label="Name">
              <input className="field" name="name" defaultValue={p.name} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select className="field" name="type" defaultValue={p.type}>
                  {PROOF_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="field" name="status" defaultValue={p.status}>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved to use</option>
                </select>
              </Field>
            </div>
            <Field label="Who">
              <input className="field" name="who" defaultValue={p.who ?? ""} />
            </Field>
            <Field label="Before">
              <textarea className="field" name="problemBefore" defaultValue={p.problemBefore ?? ""} />
            </Field>
            <Field label="What shifted">
              <textarea className="field" name="shift" defaultValue={p.shift ?? ""} />
            </Field>
            <Field label="After">
              <textarea className="field" name="resultAfter" defaultValue={p.resultAfter ?? ""} />
            </Field>
            <Field label="Belief it breaks">
              <select className="field" name="beliefBroken" defaultValue={p.beliefBroken}>
                <option value="none">None in particular</option>
                <option value="vehicle">Vehicle</option>
                <option value="internal">Internal</option>
                <option value="external">External</option>
              </select>
            </Field>
            <Field label="One-liner (for a slide or a comment)" hint="Leave blank and it's built from before and after.">
              <input className="field" name="shortVersion" defaultValue={p.shortVersion ?? ""} />
            </Field>
            <Field label="Hook">
              <input className="field" name="hook" defaultValue={p.hook ?? ""} placeholder="She said she'd quit by week three. Week six: down 11." />
            </Field>
            <Field label="Punchline">
              <input className="field" name="punchline" defaultValue={p.punchline ?? ""} />
            </Field>
            <Field label="Long version (the full story)">
              <textarea className="field min-h-32" name="longVersion" defaultValue={p.longVersion ?? ""} />
            </Field>
            <Field label="Link">
              <input className="field" name="link" type="url" defaultValue={p.link ?? ""} />
            </Field>
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" type="submit">Save</button>
            </div>
          </form>
          <form action={deleteProofAction} className="mt-3">
            <input type="hidden" name="id" value={p.id} />
            <button className="text-xs text-danger underline" type="submit">Delete this proof</button>
          </form>
        </Card>
        <div className="space-y-4">
          <Card title="Ready to paste" action={<CopyButton text={oneLiner} label="Copy" className="btn btn-ghost btn-xs" />}>
            <p className="text-sm">{oneLiner}</p>
            <p className="mt-2 text-xs text-ink-3">Use in a comment, a DM reply, or under an objection.</p>
          </Card>
          <Card title="Slide version" action={<CopyButton text={slide} label="Copy" className="btn btn-ghost btn-xs" />}>
            <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-sm">{slide || "Fill in before and after."}</pre>
            <p className="mt-2 text-xs text-ink-3">Drop this in the webinar proof block. Approved proofs show up in the script picker.</p>
          </Card>
          {p.link ? (
            <Card title="Evidence">
              <a href={p.link} target="_blank" rel="noreferrer" className="text-sm underline">Open link ↗</a>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
