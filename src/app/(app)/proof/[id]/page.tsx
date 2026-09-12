import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { PROOF_TYPES } from "@/db/schema";
import { requireViewer } from "@/lib/auth";
import { approveProofAction, deleteProofAction, proofToContentAction, unapproveProofAction, updateProofAction } from "@/lib/actions/proofs";
import { attribution, withAttribution } from "@/lib/engine/fathom";
import { CopyButton } from "@/components/copy-button";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { ProofUpload } from "@/components/proof-upload";
import { deleteProofAttachmentAction, moveAttachmentFirstAction, updateAttachmentAltAction } from "@/lib/actions/proof-attachments";
import { MAX_PER_PROOF, attachmentsBlockApproval, consentAnswered, likenessSentence, mb } from "@/lib/engine/proof-attachments";
import { AttachmentConsentForm } from "@/components/attachment-consent-form";
import { attachmentsFor, storageQuota } from "@/lib/queries/proof-attachments";
import { PROOF_STORAGE_UNCONFIGURED, proofStorageConfigured } from "@/lib/proof-storage";

const TYPE_LABEL: Record<string, string> = { result: "Result", testimonial: "Testimonial", screenshot: "Screenshot", case_study: "Case study", stat: "Stat", story: "Story" };
const SHAPE_LABEL: Record<string, string> = { shortVersion: "short version", longVersion: "long version" };

export default async function ProofDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notVerbatim?: string; needsPermission?: string; needsAttachmentConsent?: string; error?: string; attached?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const sp = await searchParams;
  const p = await db.query.proofs.findFirst({ where: and(eq(schema.proofs.id, id), eq(schema.proofs.userId, v.user.id)) });
  if (!p) notFound();
  const harvested = Boolean(p.quote);
  const oneLiner = p.shortVersion ?? p.resultAfter ?? p.name;
  const slide = [p.who ? `${p.who}` : "", p.problemBefore ? `Before: ${p.problemBefore}` : "", p.resultAfter ? `After: ${p.resultAfter}` : "", p.shift ? `The shift: ${p.shift}` : ""].filter(Boolean).join("\n");
  // The quote's own versions carry the name; hook and punchline are the client's framing and are copied as their own words.
  const shapes = [
    { key: "short", label: "Short version", text: p.shortVersion },
    { key: "long", label: "Long version", text: p.longVersion },
  ].filter((s): s is { key: string; label: string; text: string } => Boolean(s.text));
  const frames = [
    { key: "hook", label: "Hook", text: p.hook },
    { key: "punchline", label: "Punchline", text: p.punchline },
  ].filter((s): s is { key: string; label: string; text: string } => Boolean(s.text));
  const grandfathered = p.status === "approved" && !p.permissionAt;
  const speakerName = p.who ?? p.name;
  const [attachments, storage] = await Promise.all([attachmentsFor(p.id), storageQuota(v.workspace.id)]);
  const held = attachmentsBlockApproval(attachments);
  const storageOn = proofStorageConfigured();
  const attUrl = (a: (typeof attachments)[number], display = false) => `/api/proofs/attachments/${a.id}${display && a.displayKey ? "?display=1" : ""}`;
  // The page's own sentences, chosen by a code: nothing arriving in the address bar is printed as the app's word.
  const ERRORS: Record<string, string> = {
    deleteRefused: "That file couldn't be removed from storage just now, so it is still here. Try again in a minute.",
    proofDeleteRefused: "An attached file couldn't be removed from storage just now, so the proof is still here. Try again in a minute.",
    consent: "Write the person's name and tick the sentence to record their permission.",
  };
  const errorLine = sp.error ? ERRORS[sp.error] : null;
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={<Link href="/proof" className="hover:underline">← Proof Bank</Link>}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={p.status === "approved" ? "good" : "neutral"}>{p.status}</Badge>
            {p.status === "approved" ? (
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
      {errorLine ? (
        <p className="mb-4 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="proof-error" role="alert">{errorLine}</p>
      ) : null}
      {sp.attached ? <p className="mb-4 rounded-lg bg-good-soft p-3 text-sm" data-testid="attached">Attached.</p> : null}
      {sp.needsAttachmentConsent && held ? (
        <p className="mb-4 rounded-lg border border-danger bg-danger-soft p-3 text-sm" data-testid="needs-attachment-consent" role="alert">
          {held} Record it below, or remove the file, before approving.
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
              {p.speakerLabel && p.speakerLabel !== p.who ? <p className="mt-2 text-xs text-ink-3" data-testid="speaker-label">Transcript label: {p.speakerLabel}</p> : null}
              <p className="mt-2 text-xs text-ink-3">These words are theirs. The short and long versions below are trims of this quote, never a rewrite. The hook, the punchline and the frame are yours.</p>
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
                {harvested && p.status === "approved" ? (
                  <Field label="Who" hint="Fixed once approved: the permission was given under this name.">
                    <input className="field" value={p.who ?? ""} readOnly aria-readonly="true" data-testid="who-readonly" />
                  </Field>
                ) : (
                  <Field label="Who" hint={harvested ? "As the transcript labelled them. Correct it here (an email to a name, say) before approving." : undefined}>
                    <input className="field" name="who" defaultValue={p.who ?? ""} data-testid="who" />
                  </Field>
                )}
              </div>
              {harvested ? <div className="label pt-1">Their words, trimmed only</div> : null}
              <Field label={harvested ? "Short version (trim)" : "One-liner (for a slide or a comment)"} hint={harvested ? "An excerpt of the quote, an ellipsis for what you cut." : "Leave blank and it's built from before and after."}>
                <input className="field" name="shortVersion" defaultValue={p.shortVersion ?? ""} data-testid="short-version" />
              </Field>
              <Field label={harvested ? "Long version (trim)" : "Long version (the full story)"}>
                <textarea className="field min-h-32" name="longVersion" defaultValue={p.longVersion ?? ""} />
              </Field>
              {harvested ? <div className="label pt-1">The frame, in your words</div> : null}
              <Field label="Hook" hint={harvested ? "How you deploy it, in your words. Not attributed to them." : undefined}>
                <input className="field" name="hook" defaultValue={p.hook ?? ""} placeholder={harvested ? undefined : "She said she'd quit by week three. Week six: down 11."} data-testid="hook" />
              </Field>
              <Field label="Punchline">
                <input className="field" name="punchline" defaultValue={p.punchline ?? ""} />
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
          <Card title="Permission to use it" action={<Badge tone={p.status === "approved" ? "good" : "neutral"}>{p.status}</Badge>}>
              {p.status === "approved" ? (
                <>
                  {grandfathered ? (
                    <p className="text-sm" data-testid="grandfathered">Approved before the permission tick existed. It stays approved; the tick applies to approvals from now on.</p>
                  ) : (
                    <p className="text-sm" data-testid="permission-record">
                      {speakerName} has given me permission to use what they said here in my marketing.
                      {p.permissionAt ? <span className="block text-xs text-ink-3">Ticked {formatDateTime(p.permissionAt, v.tz)}.</span> : null}
                    </p>
                  )}
                  <form action={unapproveProofAction} className="mt-3">
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-xs underline" type="submit">Back to draft</button>
                  </form>
                </>
              ) : (
                <form action={approveProofAction} className="space-y-3">
                  <input type="hidden" name="id" value={p.id} />
                  <label className="flex items-start gap-2 text-sm" data-testid="permission-tick">
                    <input type="checkbox" name="permission" className="mt-1" />
                    <span>{speakerName} has given me permission to use what they said here in my marketing.</span>
                  </label>
                  <button className="btn btn-primary btn-sm" type="submit" data-testid="approve">Approve</button>
                  <p className="text-xs text-ink-3">A draft is invisible to every AI feature and every picker until it is approved here.</p>
                </form>
              )}
            </Card>
          <Card title="Attachments" action={<Badge tone={attachments.length ? "accent" : "neutral"}>{attachments.length} of {MAX_PER_PROOF}</Badge>}>
            <p className="mb-3 text-xs text-ink-2">A screenshot, a photo, a video or a PDF: evidence beside the words, on the same proof. A Fathom recording is a link, not an upload. The first one is the thumbnail.</p>
            {attachments.length ? (
              <ul className="space-y-3" data-testid="attachments">
                {attachments.map((a, i) => {
                  const needsConsent = !consentAnswered(a);
                  return (
                    <li key={a.id} id={`att-${a.id}`} className="rounded-lg border border-line p-2" data-testid="attachment" data-kind={a.kind} data-result={a.showsAResult ? "1" : "0"} data-person={a.showsAPerson ? "1" : "0"} data-consent={needsConsent ? "open" : "answered"}>
                      <div className="flex items-start gap-3">
                        <div className="w-28 shrink-0">
                          {a.kind === "image" ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element -- served by an authenticated route; next/image would fetch it without the session */}
                              <img src={attUrl(a, true)} alt={a.altText ?? ""} className="max-h-28 w-full rounded object-cover" data-testid="attachment-image" />
                            </>
                          ) : a.kind === "video" ? (
                            <video src={attUrl(a)} controls preload="metadata" className="max-h-28 w-full rounded" data-testid="attachment-video" />
                          ) : (
                            <a href={attUrl(a)} target="_blank" rel="noreferrer" className="block rounded bg-surface-2 p-3 text-center text-xs underline" data-testid="attachment-document">PDF</a>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 text-xs">
                          <div className="truncate font-medium" title={a.originalFilename}>{i === 0 ? "★ " : ""}{a.originalFilename}</div>
                          <div className="text-ink-3">{a.kind} · {mb(a.bytes)}{a.width && a.height ? ` · ${a.width}×${a.height}` : ""}{a.durationSeconds ? ` · ${Math.round(a.durationSeconds)}s` : ""}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {a.showsAResult ? <Badge tone="warn">shows a result</Badge> : null}
                            {a.showsAPerson ? <Badge tone={needsConsent ? "danger" : "good"}>{needsConsent ? "permission needed" : "permission recorded"}</Badge> : null}
                          </div>
                          {a.showsAPerson && !needsConsent ? (
                            <p className="mt-1 text-ink-2" data-testid="attachment-consent-record">{likenessSentence(a.consentName!, a.kind)} <span className="text-ink-3">Ticked {formatDateTime(a.consentRecordedAt!, v.tz)}.</span></p>
                          ) : null}
                          {needsConsent ? <AttachmentConsentForm id={a.id} kind={a.kind} initialName={a.consentName ?? ""} /> : null}
                          {a.kind === "image" ? (
                            <form action={updateAttachmentAltAction} className="mt-2 flex gap-1">
                              <input type="hidden" name="id" value={a.id} />
                              <input className="field text-xs" name="altText" defaultValue={a.altText ?? ""} placeholder="Alt text (a screen reader's line)" data-testid="attachment-alt" />
                              <button className="btn btn-ghost btn-xs" type="submit">Save</button>
                            </form>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <a className="btn btn-ghost btn-xs" href={`${attUrl(a)}${attUrl(a).includes("?") ? "&" : "?"}download=1`} data-testid="attachment-download">Download</a>
                            {i > 0 ? (
                              <form action={moveAttachmentFirstAction}>
                                <input type="hidden" name="id" value={a.id} />
                                <button className="btn btn-ghost btn-xs" type="submit" data-testid="attachment-first">Make it the thumbnail</button>
                              </form>
                            ) : null}
                            <form action={deleteProofAttachmentAction}>
                              <input type="hidden" name="id" value={a.id} />
                              <button className="btn btn-ghost btn-xs text-danger" type="submit" data-testid="attachment-delete">{a.showsAPerson ? "Withdraw permission and delete" : "Delete"}</button>
                            </form>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-3" data-testid="no-attachments">Nothing attached yet.</p>
            )}
            <div className="mt-3">
              <ProofUpload proofId={p.id} workspaceId={v.workspace.id} enabled={storageOn} why={PROOF_STORAGE_UNCONFIGURED} full={storage.blocked ? storage.line : attachments.length >= MAX_PER_PROOF ? `This proof already carries ${MAX_PER_PROOF} files. Delete one you no longer need before adding another.` : null} quotaLine={storage.line} />
            </div>
          </Card>
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
            {frames.length ? (
              <ul className="mt-3 space-y-2" data-testid="copy-frame">
                {frames.map((s) => (
                  <li key={s.key} className="flex items-start gap-2 rounded-lg border border-dashed p-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] uppercase tracking-wide text-ink-3">{s.label} · your words</span>
                      <span className="block">{s.text}</span>
                    </span>
                    <CopyButton text={s.text} label="Copy" className="btn btn-ghost btn-xs" />
                  </li>
                ))}
              </ul>
            ) : null}
            {attachments.length ? (
              <ul className="mt-3 space-y-1" data-testid="copy-out-files">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-2 text-sm">
                    <span className="min-w-0 truncate">{a.originalFilename}</span>
                    <a className="btn btn-ghost btn-xs" href={`${attUrl(a)}${attUrl(a).includes("?") ? "&" : "?"}download=1`}>Download</a>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-ink-3">For a website, a funnel or a landing page. The name{attribution(p.who) ? ` (${attribution(p.who)})` : ""} travels with their words; your hook and punchline are copied as yours.</p>
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
