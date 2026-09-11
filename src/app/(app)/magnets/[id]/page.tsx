import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { MAGNET_TYPES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { hasAiKey } from "@/lib/ai";
import { appUrl } from "@/lib/branded-email";
import { buildMagnetPdfAction, deleteMagnetAction, generateMagnetAction, removeMagnetFileAction, updateMagnetAction } from "@/lib/actions/magnets";
import { HIT_SOURCES, MAGNET_TYPE_INFO, QUESTION_WARNING, canvaHandoff, contentToText, endsWithQuestion, magnetText, primaryTarget } from "@/lib/engine/lead-magnet";
import { STORAGE_UNCONFIGURED, publicUrls, storageConfigured } from "@/lib/storage";
import { MagnetUpload } from "@/components/magnet-upload";
import { AiFormStatus } from "@/components/ai-status";
import { AiPromise } from "@/components/ai-promise";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Field, PageHeader } from "@/components/ui";

export const metadata = { title: "Lead magnet" };

/**
 * One lead magnet: the brief, the content in a plain shape, the formats and which one the tracked link opens, the typeset
 * PDF, an uploaded file, the copy-outs (text, Canva hand-off, the two hand-overs), and the tracked link with its counts.
 */
export default async function MagnetEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const m = await db.query.leadMagnets.findFirst({ where: and(eq(schema.leadMagnets.id, id), eq(schema.leadMagnets.userId, v.user.id)) });
  if (!m) {
    return (
      <p className="text-sm">
        Not found. <Link href="/magnets" className="underline">Back to lead magnets</Link>
      </p>
    );
  }
  const [ai, offers, membership, hits, urlOf] = await Promise.all([
    hasAiKey(),
    db.query.offers.findMany({ where: eq(schema.offers.userId, v.user.id) }),
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.workspaceId, v.workspace.id), eq(schema.memberships.userId, v.user.id)) }),
    db.select({ src: schema.leadMagnetHits.src, n: sql<number>`count(*)` }).from(schema.leadMagnetHits).where(eq(schema.leadMagnetHits.magnetId, m.id)).groupBy(schema.leadMagnetHits.src),
    publicUrls([m.pdfKey, m.fileKey]),
  ]);
  const storage = storageConfigured();
  const bySrc = new Map(hits.map((h) => [h.src, Number(h.n)]));
  const total = hits.reduce((s, h) => s + Number(h.n), 0);
  const base = appUrl();
  const link = `${base}/g/${m.slug}`;
  const target = primaryTarget(m, urlOf);
  const pdfUrl = m.pdfKey ? urlOf(m.pdfKey) : null;
  const fileUrl = m.fileKey ? urlOf(m.fileKey) : null;
  const text = magnetText(m);
  const canva = canvaHandoff({ ...m, businessName: membership?.businessName });
  const info = MAGNET_TYPE_INFO[m.type];
  // Craft, not truth: a DM or chatbot answer that ends without a question is warned on the field and on the summary, and the block opens so it is seen.
  const handoverWarnings = [m.personalDm, m.chatbotAnswer].filter((t) => t && !endsWithQuestion(t)).length;
  return (
    <>
      <PageHeader
        title={m.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/magnets" className="hover:underline">← Lead magnets</Link>
            <Badge tone="accent">{m.keyword}</Badge>
            <span>{info.label} · {m.generatedBy === "claude" ? "drafted by AI" : m.generatedBy === "scaffold" ? "skeleton, fill the blanks" : m.generatedBy}</span>
          </span>
        }
        action={
          <form action={deleteMagnetAction}>
            <input type="hidden" name="id" value={m.id} />
            <button className="btn btn-ghost btn-sm" type="submit">Delete</button>
          </form>
        }
      />
      {sp.error ? (
        <p className="mb-4 rounded-xl border border-danger bg-danger-soft p-3 text-sm" data-testid="magnet-error" role="alert">{sp.error}</p>
      ) : null}
      {sp.saved ? <p className="mb-4 rounded-xl bg-good-soft p-3 text-sm" data-testid="magnet-saved">Saved.</p> : null}
      {sp.pdf ? <p className="mb-4 rounded-xl bg-good-soft p-3 text-sm" data-testid="magnet-pdf-built">PDF built. It is live at the link below.</p> : null}
      {sp.uploaded ? <p className="mb-4 rounded-xl bg-good-soft p-3 text-sm" data-testid="magnet-uploaded">File uploaded. It is live at the link below.</p> : null}
      {sp.stripped && m.notes ? <p className="mb-4 rounded-xl bg-warn-soft p-3 text-sm whitespace-pre-wrap" data-testid="magnet-stripped">{m.notes}</p> : null}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <Card title="The magnet">
            <form action={updateMagnetAction} className="space-y-3" data-testid="magnet-form">
              <input type="hidden" name="id" value={m.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title">
                  <input className="field" name="title" defaultValue={m.title} required />
                </Field>
                <Field label="Type">
                  <select className="field" name="type" defaultValue={m.type}>
                    {MAGNET_TYPES.map((t) => (
                      <option key={t} value={t}>{MAGNET_TYPE_INFO[t].label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Promise">
                  <input className="field" name="promise" defaultValue={m.promise} />
                </Field>
                <Field label="Who it's for">
                  <input className="field" name="audience" defaultValue={m.audience} />
                </Field>
                <Field label="Keyword" hint="Never shared between two magnets. A ladder that offers this magnet uses it in the final rung.">
                  <input className="field uppercase" name="keyword" defaultValue={m.keyword} maxLength={24} required />
                </Field>
                <Field label="Offer it leads to">
                  <select className="field" name="offerId" defaultValue={m.offerId ?? ""}>
                    <option value="">None yet</option>
                    {offers.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Content" hint={`"## Heading" starts a section, "- " an item${m.type === "guide" ? ', "why:" and "how:" fill a section' : ""}; text before the first heading is the intro; "---" starts the closing. ${info.itemsLabel}.`}>
                <textarea className="field font-mono text-sm" name="content" rows={16} defaultValue={contentToText(m.content)} data-testid="magnet-content" />
              </Field>
              <fieldset className="grid gap-2 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-medium">Formats</legend>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="f_page" defaultChecked={m.formats.page} /> Hosted page at /m/{m.slug}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="f_pdf" defaultChecked={m.formats.pdf} /> Typeset PDF (built below)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="f_copy" defaultChecked={m.formats.copy} /> Plain text to paste anywhere</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="f_canva" defaultChecked={m.formats.canva} /> Canva hand-off</label>
              </fieldset>
              <Field label="The tracked link opens" hint="A format that is off can't be the target; the link falls back to the page, then the PDF, then the file.">
                <select className="field" name="primary" defaultValue={m.primary} data-testid="magnet-primary">
                  <option value="page">The hosted page</option>
                  <option value="pdf">The PDF</option>
                  <option value="file">The uploaded file</option>
                </select>
              </Field>
              <details className="rounded-lg border border-line p-3" open={handoverWarnings > 0}>
                <summary className="cursor-pointer text-sm font-medium">
                  Hand-over messages{handoverWarnings ? <span className="ml-2 text-xs font-normal text-warn" data-testid="handover-warnings">{handoverWarnings === 1 ? "one ends without a question" : "both end without a question"}</span> : null}
                </summary>
                <p className="mt-2 text-xs text-ink-2">Personal profile: comment automation can&apos;t fire, so you reply and DM by hand. Business page: the Community Loyalty chatbot answers, delivers and asks. Every line is yours to write or edit.</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <Field label="Your public reply (personal profile)" hint="Moves them off the thread. Short, no link.">
                    <textarea className="field text-sm" name="personalReply" rows={2} defaultValue={m.personalReply ?? ""} />
                  </Field>
                  <Field label="Your DM with the link (personal profile)" hint="Deliver, then one question that invites a reply.">
                    <textarea className="field text-sm" name="personalDm" rows={2} defaultValue={m.personalDm ?? ""} />
                    {m.personalDm && !endsWithQuestion(m.personalDm) ? <span className="mt-1 block text-xs text-warn" data-testid="dm-question-warning">{QUESTION_WARNING}</span> : null}
                  </Field>
                  <Field label="Chatbot answer (business page)" hint="Deliver, then the first qualifying question.">
                    <textarea className="field text-sm" name="chatbotAnswer" rows={2} defaultValue={m.chatbotAnswer ?? ""} />
                    {m.chatbotAnswer && !endsWithQuestion(m.chatbotAnswer) ? <span className="mt-1 block text-xs text-warn" data-testid="chatbot-question-warning">{QUESTION_WARNING}</span> : null}
                  </Field>
                  <Field label="Chatbot delivery message (business page)" hint="What arrives with the file: one line on what to do with it first.">
                    <textarea className="field text-sm" name="chatbotDelivery" rows={2} defaultValue={m.chatbotDelivery ?? ""} />
                  </Field>
                </div>
                <Field label="Chatbot questions, one per line (up to five)">
                  <textarea className="field text-sm" name="chatbotQuestions" rows={3} defaultValue={m.chatbotQuestions.join("\n")} />
                </Field>
              </details>
              <Field label="Notes">
                <textarea className="field text-sm" name="notes" rows={2} defaultValue={m.notes ?? ""} />
              </Field>
              <button className="btn btn-primary" type="submit" data-testid="magnet-save">Save</button>
            </form>
          </Card>
          <Card title="Write it with AI">
            <form action={generateMagnetAction} className="space-y-2">
              <input type="hidden" name="id" value={m.id} />
              <AiPromise enabled={ai}>Writes the sections in the {info.label.toLowerCase()} shape plus the hand-over messages, from your Big Promise, your audience, the offer, approved proof and confirmed evidence. Replaces the content; your other fields stay.</AiPromise>
              <button className="btn btn-accent btn-sm" type="submit" disabled={!ai} data-testid="magnet-generate">✨ Write it</button>
              <AiFormStatus feature="lead_magnet" enabled={ai} />
            </form>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Tracked link">
            <p className="break-all font-mono text-sm" data-testid="magnet-link">{link}</p>
            <p className="mt-1 text-xs text-ink-2">Add <code>?src=chatbot</code>, <code>?src=dm</code>, <code>?src=email</code> or <code>?src=rung</code> to see where clicks come from. Nothing about the reader rides on it.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyButton text={link} label="Copy link" />
              <CopyButton text={`${link}?src=chatbot`} label="Copy for the chatbot" />
              <CopyButton text={`${link}?src=dm`} label="Copy for a DM" />
            </div>
            <p className="mt-3 text-sm" data-testid="magnet-target">
              Opens: {target ? <a className="underline" href={target}>{target}</a> : <span className="text-danger">nothing yet: turn a format on, build the PDF or upload a file</span>}
            </p>
            <table className="mt-3 w-full text-sm" data-testid="magnet-hits">
              <tbody>
                {HIT_SOURCES.map((s) => (
                  <tr key={s} data-src={s}>
                    <td className="py-0.5 text-ink-2">{s}</td>
                    <td className="py-0.5 text-right tabular-nums">{bySrc.get(s) ?? 0}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-medium">
                  <td className="py-0.5">all</td>
                  <td className="py-0.5 text-right tabular-nums" data-testid="magnet-hits-total">{total}</td>
                </tr>
              </tbody>
            </table>
            {m.formats.page ? (
              <p className="mt-3 text-sm">
                Hosted page: <a className="underline" href={`/m/${m.slug}`} target="_blank" rel="noreferrer" data-testid="magnet-page-link">{base}/m/{m.slug}</a>
              </p>
            ) : null}
          </Card>
          <Card title="PDF">
            <p className="text-xs text-ink-2">A typeset document from the content above: title over the gold band, the sections, your name at the foot. Build it again after editing.</p>
            {!storage ? <p className="mt-2 text-xs text-warn" data-testid="magnet-storage-off">{STORAGE_UNCONFIGURED}</p> : null}
            <form action={buildMagnetPdfAction} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={m.id} />
              <button className="btn btn-soft btn-sm" type="submit" disabled={!storage} data-testid="magnet-build-pdf">{pdfUrl ? "Rebuild the PDF" : "Build the PDF"}</button>
              {pdfUrl ? <a className="text-sm underline" href={pdfUrl} target="_blank" rel="noreferrer" data-testid="magnet-pdf-url">Open the PDF</a> : null}
            </form>
          </Card>
          <Card title="Upload a file">
            <MagnetUpload magnetId={m.id} slug={m.slug} enabled={storage} why={STORAGE_UNCONFIGURED} />
            {fileUrl ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <a className="underline" href={fileUrl} target="_blank" rel="noreferrer" data-testid="magnet-file-url">{m.fileName}</a>
                <form action={removeMagnetFileAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="btn btn-ghost btn-xs" type="submit">Remove</button>
                </form>
              </div>
            ) : null}
          </Card>
          <Card title="Copy-outs">
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Plain text</span>
                  <CopyButton text={text} />
                </div>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs" data-testid="magnet-text">{text}</pre>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Canva hand-off</span>
                  <CopyButton text={canva} />
                </div>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs" data-testid="magnet-canva">{canva}</pre>
              </div>
              {[
                ["Public reply", m.personalReply],
                ["DM", m.personalDm],
                ["Chatbot answer", m.chatbotAnswer],
                ["Chatbot delivery", m.chatbotDelivery],
                ["Chatbot questions", m.chatbotQuestions.join("\n")],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span>{label}{value ? "" : <span className="text-ink-3"> (not written yet)</span>}</span>
                  <CopyButton text={value ?? ""} disabled={!value} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
