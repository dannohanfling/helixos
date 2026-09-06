import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { requireViewer } from "@/lib/auth";
import { aiEnabled } from "@/lib/ai";
import { generateVariantsAction, updateVariantAction } from "@/lib/actions/variants";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { CHANNEL_SPECS } from "@/lib/engine/repurpose";

export default async function RepurposePage({ params }: { params: Promise<{ id: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const item = await db.query.contentItems.findFirst({ where: and(eq(schema.contentItems.id, id), eq(schema.contentItems.userId, v.user.id)) });
  if (!item) notFound();
  const variants = await db.query.contentVariants.findMany({ where: eq(schema.contentVariants.contentItemId, id) });
  const posted = variants.filter((x) => x.status === "posted").length;
  const reach = variants.reduce((a, x) => ({ reactions: a.reactions + x.reactions, comments: a.comments + x.comments, dms: a.dms + x.dms, leads: a.leads + x.leads }), { reactions: 0, comments: 0, dms: 0, leads: 0 });
  return (
    <>
      <PageHeader
        title={`Repurpose: ${item.title}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/content/${item.id}`} className="hover:underline">
              ← Back to the post
            </Link>
            <span>
              {posted}/{CHANNEL_SPECS.length} channels posted · 👍 {reach.reactions} · 💬 {reach.comments} · 📨 {reach.dms} DMs · 🆕 {reach.leads} leads
            </span>
          </span>
        }
      />
      <Card title="One post, ten channels">
        <form action={generateVariantsAction} className="space-y-3">
          <input type="hidden" name="contentItemId" value={item.id} />
          <p className="text-sm text-ink-2">Each channel gets its own draft shaped to how that channel is read: no links in other people&apos;s groups, a question first in yours, three frames for stories, a subject line and P.S. for email. Posted channels are never overwritten.</p>
          <div className="flex flex-wrap gap-2">
            {CHANNEL_SPECS.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="checkbox" name="channels" value={c.key} defaultChecked />
                {c.icon} {c.label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-accent" type="submit">
              Generate drafts
            </button>
            {aiEnabled() ? (
              <button className="btn btn-soft" type="submit" name="ai" value="1">
                ✨ Generate with Claude
              </button>
            ) : (
              <span className="text-xs text-ink-3">Add ANTHROPIC_API_KEY to let Claude polish each draft in your voice.</span>
            )}
          </div>
        </form>
      </Card>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {CHANNEL_SPECS.map((c) => {
          const var_ = variants.find((x) => x.channel === c.key);
          return (
            <Card key={c.key} title={`${c.icon} ${c.label}`} action={var_ ? <Badge tone={var_.status === "posted" ? "good" : var_.status === "scheduled" ? "accent" : "neutral"}>{var_.status}</Badge> : <span className="text-xs text-ink-3">not generated</span>}>
              <p className="mb-2 text-xs text-ink-3">{c.why}</p>
              {var_ ? (
                <form action={updateVariantAction} className="space-y-2">
                  <input type="hidden" name="id" value={var_.id} />
                  {c.key === "email" ? (
                    <Field label="Subject">
                      <input className="field" name="subject" defaultValue={var_.subject ?? ""} />
                    </Field>
                  ) : null}
                  <textarea className="field min-h-40 text-sm" name="body" defaultValue={var_.body} />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-ink-3 tabular">
                      {var_.body.length}/{c.maxChars}
                    </span>
                    <CopyButton text={c.key === "email" && var_.subject ? `Subject: ${var_.subject}\n\n${var_.body}` : var_.body} label="Copy" className="btn btn-ghost btn-xs" />
                    <select className="field w-auto py-1 text-xs" name="status" defaultValue={var_.status}>
                      <option value="draft">Draft</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="posted">Posted ✓</option>
                      <option value="skipped">Skip</option>
                    </select>
                    <input className="field w-40 py-1 text-xs" name="postUrl" placeholder="Post URL" defaultValue={var_.postUrl ?? ""} />
                    <button className="btn btn-primary btn-xs" type="submit">
                      Save
                    </button>
                  </div>
                  {var_.status === "posted" ? (
                    <div className="grid grid-cols-4 gap-2">
                      {(["reactions", "comments", "dms", "leads"] as const).map((k) => (
                        <label key={k} className="block">
                          <span className="label">{k}</span>
                          <input className="field tabular py-1 text-xs" name={k} type="number" min={0} defaultValue={var_[k]} />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </form>
              ) : (
                <p className="text-sm text-ink-3">Generate drafts above.</p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
