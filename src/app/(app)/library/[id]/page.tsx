import Link from "next/link";
import { notFound } from "next/navigation";
import { CONTENT_TYPES, LIBRARY_KINDS } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { deleteLibraryPostAction, shareLibraryPostAction, updateLibraryPostAction, useLibraryPostAction } from "@/lib/actions/library";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { libraryPostFor } from "@/lib/queries/library-posts";

export default async function LibraryEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const p = await libraryPostFor(id, v.workspace.id, v.user.id);
  if (!p) notFound();
  const mine = p.userId === v.user.id;
  const coachOwned = v.role === "coach" && p.workspaceId === v.workspace.id && p.userId === null;
  const canEdit = mine || coachOwned;
  const full = [p.hook, p.body, p.cta].filter(Boolean).join("\n\n");
  return (
    <>
      <PageHeader
        title={p.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/library" className="hover:underline">
              ← Library
            </Link>
            <Badge tone={mine ? "good" : p.source === "coach" ? "accent" : "neutral"}>{mine ? "mine" : p.source === "coach" ? "from your coach" : "Evolve Omega"}</Badge>
            <span className="text-xs text-ink-3">
              {p.kind}
              {p.contentType ? ` · ${p.contentType}` : ""}
              {p.usedCount ? ` · used ${p.usedCount}×` : ""}
            </span>
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <form action={useLibraryPostAction}>
              <input type="hidden" name="id" value={p.id} />
              <button className="btn btn-accent btn-sm" type="submit">
                ✍️ Use this
              </button>
            </form>
            <CopyButton text={full} label="Copy" className="btn btn-ghost btn-sm" />
            {v.role === "coach" && (mine || coachOwned) ? (
              <form action={shareLibraryPostAction}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="shared" value={p.shared ? "0" : "1"} />
                <button className="btn btn-soft btn-sm" type="submit">
                  {p.shared ? "Stop sharing" : "Share with every member"}
                </button>
              </form>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card title="The text">
          {p.hook ? (
            <div className="mb-3">
              <div className="label">Hook</div>
              <p className="text-base font-medium">{p.hook}</p>
            </div>
          ) : null}
          {p.body ? (
            <div className="mb-3">
              <div className="label">Body</div>
              <p className="whitespace-pre-line text-sm leading-relaxed">{p.body}</p>
            </div>
          ) : null}
          {p.cta ? (
            <div>
              <div className="label">CTA</div>
              <p className="text-sm">{p.cta}</p>
            </div>
          ) : null}
          {p.example ? (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-ink-3 underline">See the worked example</summary>
              <p className="mt-2 whitespace-pre-line rounded-lg bg-surface-2 p-3 text-sm">{p.example}</p>
            </details>
          ) : null}
        </Card>
        <div className="space-y-4">
          {p.useWhen || p.whyItWorks || p.pillar || p.tags.length ? (
            <Card title="How to use it">
              {p.useWhen ? (
                <p className="text-sm">
                  <span className="font-semibold">Use when:</span> {p.useWhen}
                </p>
              ) : null}
              {p.whyItWorks ? (
                <p className="mt-2 text-sm">
                  <span className="font-semibold">Why it works:</span> {p.whyItWorks}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-3">
                {p.pillar ? <Badge>{p.pillar}</Badge> : null}
                {p.angle ? <Badge>{p.angle}</Badge> : null}
                {p.tags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
              {p.engagements || p.leads ? <p className="mt-2 text-xs text-ink-3">When it ran: 👍 {p.engagements} · 🆕 {p.leads} leads</p> : null}
            </Card>
          ) : null}
          {canEdit ? (
            <Card title="Edit">
              <form action={updateLibraryPostAction} className="space-y-3">
                <input type="hidden" name="id" value={p.id} />
                <Field label="Title">
                  <input className="field" name="title" defaultValue={p.title} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kind">
                    <select className="field" name="kind" defaultValue={p.kind}>
                      {LIBRARY_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Type">
                    <select className="field" name="contentType" defaultValue={p.contentType ?? ""}>
                      <option value="">Any</option>
                      {CONTENT_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Hook">
                  <input className="field" name="hook" defaultValue={p.hook ?? ""} />
                </Field>
                <Field label="Body">
                  <textarea className="field min-h-40" name="body" defaultValue={p.body} />
                </Field>
                <Field label="CTA">
                  <input className="field" name="cta" defaultValue={p.cta ?? ""} />
                </Field>
                <Field label="Use when">
                  <input className="field" name="useWhen" defaultValue={p.useWhen ?? ""} />
                </Field>
                <Field label="Why it works">
                  <input className="field" name="whyItWorks" defaultValue={p.whyItWorks ?? ""} />
                </Field>
                <Field label="Worked example (patterns)">
                  <textarea className="field" name="example" defaultValue={p.example ?? ""} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pillar">
                    <input className="field" name="pillar" defaultValue={p.pillar ?? ""} />
                  </Field>
                  <Field label="Angle">
                    <input className="field" name="angle" defaultValue={p.angle ?? ""} />
                  </Field>
                </div>
                <Field label="Tags (comma separated)">
                  <input className="field" name="tags" defaultValue={p.tags.join(", ")} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="hasCta" defaultChecked={p.hasCta} /> Has a call to action
                </label>
                <button className="btn btn-primary btn-sm" type="submit">
                  Save
                </button>
              </form>
              <form action={deleteLibraryPostAction} className="mt-3">
                <input type="hidden" name="id" value={p.id} />
                <button className="text-xs text-danger underline" type="submit">
                  Delete
                </button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
