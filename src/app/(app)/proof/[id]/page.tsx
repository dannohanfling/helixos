import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { PROOF_TYPES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { approveHarvestedProofAction, deleteProofAction, proofToContentAction, unapproveProofAction, updateProofAction } from "@/lib/actions/proofs";
import { attribution, withAttribution } from "@/lib/engine/fathom";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

const TYPE_LABEL: Record<string, string> = { result: "Result", testimonial: "Testimonial", screenshot: "Screenshot", case_study: "Case study", stat: "Stat", story: "Story" };
const SHAPE_LABEL: Record<string, string> = { shortVersion: "short version", longVersion: "long version", hook: "hook", punchline: "punchline" };

export default async function ProofDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notVerbatim?: string; needsPermission?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const p = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, id), eq(schema.proofs.userId, v.user.id)) });
  if (!p) notFound();
  const harvested = Boolean(p.quote);
  const oneLiner = p.shortVersion ?? p.resultAfter ?? p.name;
  const slide = [p.who ? `${p.who}` : "", p.problemBefore ? `Before: ${p.problemBefore}` : "", p.resultAfter ? `After: ${p.resultAfter}` : "", p.shift ? `The shift: ${p.shift}` : ""].filter(Boolean).join("\n");
  const shapes = [
    { key: "short", label: "Short version", text: p.shortVersion },
    { key: "long", label: "Long version", text: p.longVersion },
    { key: "hook", label: "Hook", text: p.hook },
    { key: "punchline", label: "Punchline", text: p.punchline },
  ].filter((s): s is { key: string; label: string; text: string } => Boolean(s.text));
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={<Link href="/proof" className="hover:underline">← Proof Bank</Link>}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={p.status === "approved" ? "good" : "neutral"}>{p.status}</Badge>
            {!harvested || p.status === "approved" ? (
              <form action={proofToContentAction}>
                <input type="hidden" name="id" value={p.id} />
                <button className="btn btn-accent btn-sm" type="submit">✍️ Draft a win post</button>
              </form>
            ) : null}
          </div>
        }
      />
      {sp.notVerbatim ? (
        <p className="mb-4 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="not-verbatim" role="alert">
          Not saved: the {SHAPE_LABEL[sp.notVerbatim] ?? sp.notVerbatim} isn&apos;t a trim of the quote. Cut with an ellipsis (…); never rewrite their words.
        </p>
      ) : null}
      {sp.needsPermission ? (
        <p className="mb-4 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="needs-permission" role="alert">
          Not approved: tick the permission line first.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          {harvested ? (
            <Card title="Verbatim, from the recording" action={<CopyButton text={withAttribution(p.quote!, p.who)} label="Copy with name" className="btn btn-ghost btn-xs" />}>
              <blockquote className="text-lg leading-relaxed" data-testid="verbatim-quote">“{p.quote}”</blockquote>
              <p className="mt-2 text-sm text-ink-2" data-testid="quote-speaker">
                <span className="font-medium">{p.who}</span>
                {p.sourceTimestamp ? ` · at ${p.sourceTimestamp}` : ""}
                {p.sourceRecordedAt ? ` · ${formatDateTime(p.sourceRecordedAt, v.tz)}` : ""}
                {p.sourceUrl ? (
                  <>
                    {" · "}
                    <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="underline" data-testid="quote-link">Hear it in Fathom ↗</a>
                  </>
                ) : null}
              </p>
              {p.contextBefore || p.contextAfter ? (
                <div className="mt-3 space-y-1 rounded-lg bg-surface-2 p-3 text-xs text-ink-2" data-testid="quote-context">
                  {p.contextBefore ? <p>Before it: “{p.contextBefore}”</p> : null}
                  {p.contextAfter ? <p>After it: “{p.contextAfter}”</p> : null}
                </div>
              ) : null}
              <p className="mt-2 text-xs text-ink-3">These words are theirs. Every shape below is a trim of this quote, never a rewrite. The frame around it is yours.</p>
            </Card>
          ) : null}
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
                {harvested ? (
                  <Field label="Who">
                    <input className="field" value={p.who ?? ""} readOnly aria-readonly="true" data-testid="who-readonly" />
                  </Field>
                ) : (
                  <Field label="Status">
                    <select className="field" name="status" defaultValue={p.status}>
                      <option value="draft">Draft</option>
                      <option value="approved">Approved to use</option>
                    </select>
                  </Field>
                )}
              </div>
              {!harvested ? (
                <Field label="Who">
                  <input className="field" name="who" defaultValue={p.who ?? ""} />
                </Field>
              ) : null}
              {harvested ? <div className="label pt-1">Their words, trimmed only</div> : null}
              <Field label={harvested ? "Short version (trim)" : "One-liner (for a slide or a comment)"} hint={harvested ? "An excerpt of the quote, an ellipsis for what you cut." : "Leave blank and it's built from before and after."}>
                <input className="field" name="shortVersion" defaultValue={p.shortVersion ?? ""} data-testid="short-version" />
              </Field>
              <Field label={harvested ? "Hook (trim)" : "Hook"}>
                <input className="field" name="hook" defaultValue={p.hook ?? ""} placeholder={harvested ? undefined : "She said she'd quit by week three. Week six: down 11."} data-testid="hook" />
              </Field>
              <Field label={harvested ? "Punchline (trim)" : "Punchline"}>
                <input className="field" name="punchline" defaultValue={p.punchline ?? ""} />
              </Field>
              <Field label={harvested ? "Long version (trim)" : "Long version (the full story)"}>
                <textarea className="field min-h-32" name="longVersion" defaultValue={p.longVersion ?? ""} />
              </Field>
              {harvested ? <div className="label pt-1">The frame, in your words</div> : null}
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
        </div>
        <div className="space-y-4">
          {harvested ? (
            <Card title="Permission to use it" action={<Badge tone={p.status === "approved" ? "good" : "neutral"}>{p.status}</Badge>}>
              {p.status === "approved" ? (
                <>
                  <p className="text-sm" data-testid="permission-record">
                    {p.who} has given me permission to use what they said here in my marketing.
                    {p.permissionAt ? <span className="block text-xs text-ink-3">Ticked {formatDateTime(p.permissionAt, v.tz)}.</span> : null}
                  </p>
                  <form action={unapproveProofAction} className="mt-3">
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-xs underline" type="submit">Back to draft</button>
                  </form>
                </>
              ) : (
                <form action={approveHarvestedProofAction} className="space-y-3">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="flex items-start gap-2 text-sm" data-testid="permission-tick">
                    <input type="checkbox" name="permission" className="mt-1" />
                    <span>{p.who} has given me permission to use what they said here in my marketing.</span>
                  </label>
                  <button className="btn btn-primary btn-sm" type="submit" data-testid="approve">Approve</button>
                  <p className="text-xs text-ink-3">A draft is invisible to every AI feature and every picker until it is approved here.</p>
                </form>
              )}
            </Card>
          ) : null}
          <Card title="Copy with attribution">
            {shapes.length ? (
              <ul className="space-y-2" data-testid="copy-out">
                {shapes.map((s) => (
                  <li key={s.key} className="flex items-start gap-2 rounded-lg bg-surface-2 p-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] uppercase tracking-wide text-ink-3">{s.label}</span>
                      <span className="block" data-testid={`copy-${s.key}-text`}>{withAttribution(s.text, p.who)}</span>
                    </span>
                    <CopyButton text={withAttribution(s.text, p.who)} label="Copy" className="btn btn-ghost btn-xs" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Fill in a version above and it appears here with the name attached.</p>
            )}
            <p className="mt-2 text-xs text-ink-3">For a website, a funnel or a landing page. The name{attribution(p.who) ? ` (${attribution(p.who)})` : ""} travels with the words.</p>
          </Card>
          {!harvested ? (
            <>
              <Card title="Ready to paste" action={<CopyButton text={oneLiner} label="Copy" className="btn btn-ghost btn-xs" />}>
                <p className="text-sm">{oneLiner}</p>
                <p className="mt-2 text-xs text-ink-3">Use in a comment, a DM reply, or under an objection.</p>
              </Card>
              <Card title="Slide version" action={<CopyButton text={slide} label="Copy" className="btn btn-ghost btn-xs" />}>
                <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-sm">{slide || "Fill in before and after."}</pre>
                <p className="mt-2 text-xs text-ink-3">Drop this in the webinar proof block. Approved proofs show up in the script picker.</p>
              </Card>
            </>
          ) : null}
          {p.link && !harvested ? (
            <Card title="Evidence">
              <a href={p.link} target="_blank" rel="noreferrer" className="text-sm underline">Open link ↗</a>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
